import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import type { Prisma } from '@prisma/client';
import type { Access } from '../auth/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SmsService } from '../sms/sms';
import { ZaloService } from '../zalo/zalo';
import { vnToday } from './care-rules';
import { CareService } from './care.service';

const TICK_INTERVAL_MS = 15 * 60_000;

@Injectable()
export class AutoReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoReminderService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly care: CareService,
    private readonly zalo: ZaloService,
    private readonly sms: SmsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.scheduledTick();
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private currentVnHour(): number {
    return new Date(Date.now() + 7 * 3_600_000).getUTCHours();
  }

  private async scheduledTick() {
    try {
      const lock = await this.redis.client.set('care:auto_reminder_tick', '1', 'EX', 600, 'NX').catch(() => null);
      if (lock !== 'OK') return;

      const vnHour = this.currentVnHour();
      const garages = await this.prisma.tenant.findMany({
        where: { type: 'GARAGE', deletedAt: null },
        select: { id: true },
      });
      for (const g of garages) {
        const s = await this.care.settings(g.id);
        if (!s.autoAppEnabled && !s.autoZaloEnabled && !s.autoSmsEnabled) continue;
        if (vnHour < s.sendHourVn) continue;
        await this.runForTenant(g.id);
      }
    } catch (e) {
      this.logger.warn(`Lỗi tiến trình quét nhắc lịch tự động: ${(e as Error).message}`);
    }
  }

  private classifyKind(kind: string, refKey: string): string {
    if (refKey.startsWith('PHU_HIEU:')) return 'PHU_HIEU';
    if (refKey.startsWith('MAINT_ITEM:')) return 'BAO_DUONG_HANG_MUC';
    return kind;
  }

  private fmtDateVn(d: Date): string {
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }

  private async upsertDispatch(data: {
    tenantId: string;
    branchId: string | null;
    customerId: string;
    vehicleId: string | null;
    channel: 'APP' | 'ZALO' | 'SMS';
    kind: string;
    dedupeKey: string;
    title: string;
    body: string;
    status: 'SENT' | 'SIMULATED' | 'FAILED' | 'SKIPPED';
    error?: string | null;
  }) {
    await this.prisma.reminderDispatch.upsert({
      where: { tenantId_dedupeKey: { tenantId: data.tenantId, dedupeKey: data.dedupeKey } },
      create: {
        tenantId: data.tenantId,
        branchId: data.branchId,
        customerId: data.customerId,
        vehicleId: data.vehicleId,
        channel: data.channel,
        kind: data.kind,
        dedupeKey: data.dedupeKey,
        title: data.title,
        body: data.body,
        status: data.status,
        error: data.error?.slice(0, 500) ?? null,
      },
      update: {
        status: data.status,
        body: data.body,
        error: data.error?.slice(0, 500) ?? null,
      },
    });
  }

  /**
   * Quét toàn bộ mốc đến hạn (Đăng kiểm, Bảo hiểm, Phù hiệu xe, Bảo dưỡng theo Km/Thời gian)
   * và tự động gửi thông báo qua các kênh đã bật (App Chủ xe / Zalo ZNS / SMS), chống gửi lặp tuyệt đối.
   */
  async runForTenant(tenantId: string, opts: { branchIds?: string[] | 'ALL' } = {}) {
    await this.care.generate(tenantId, true);
    const s = await this.care.settings(tenantId);
    const today = vnToday();

    const branchFilter: Prisma.CareTaskWhereInput =
      opts.branchIds && opts.branchIds !== 'ALL'
        ? { OR: [{ branchId: null }, { branchId: { in: opts.branchIds } }] }
        : {};

    const tasks = await this.prisma.careTask.findMany({
      where: {
        tenantId,
        status: { in: ['CAN_GOI', 'GOI_LAI'] },
        dueDate: { lte: today },
        OR: [{ kind: { in: ['DANG_KIEM', 'BAO_HIEM', 'BAO_DUONG'] } }, { refKey: { startsWith: 'PHU_HIEU:' } }],
        AND: [branchFilter],
      },
      include: {
        customer: { include: { appLink: { select: { userId: true } } } },
      },
      take: 200,
    });

    if (!tasks.length) {
      return { scanned: 0, appSent: 0, zaloSent: 0, smsSent: 0, skipped: 0 };
    }

    const garageName = await this.sms.garageName(tenantId);
    const vehicleIds = [...new Set(tasks.map((t) => t.vehicleId).filter((x): x is string => !!x))];
    const branchIds = [...new Set(tasks.map((t) => t.branchId).filter((x): x is string => !!x))];

    const [vehicles, branches, sentDispatches] = await Promise.all([
      vehicleIds.length
        ? this.prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, plateNo: true, make: true, model: true } })
        : [],
      branchIds.length
        ? this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, phone: true } })
        : [],
      this.prisma.reminderDispatch.findMany({
        where: { tenantId, status: { in: ['SENT', 'SIMULATED'] } },
        select: { dedupeKey: true },
      }),
    ]);

    const vehMap = new Map(vehicles.map((v) => [v.id, v]));
    const brMap = new Map(branches.map((b) => [b.id, b]));
    const alreadySent = new Set(sentDispatches.map((d) => d.dedupeKey));

    let appSent = 0;
    let zaloSent = 0;
    let smsSent = 0;
    let skipped = 0;

    for (const t of tasks) {
      const veh = t.vehicleId ? vehMap.get(t.vehicleId) : null;
      const br = t.branchId ? brMap.get(t.branchId) : null;
      const plate = veh ? formatPlate(veh.plateNo) : null;
      const dueStr = this.fmtDateVn(t.eventDate ?? t.dueDate);
      const dispatchKind = this.classifyKind(t.kind, t.refKey);

      // 1. Kênh App Chủ xe
      if (s.autoAppEnabled) {
        const appKey = `APP:${t.refKey}`;
        if (alreadySent.has(appKey)) {
          skipped++;
        } else if (t.customer.appLink?.userId) {
          const title = plate ? `Nhắc lịch xe ${plate}` : 'Nhắc lịch chăm sóc xe';
          const body = `${t.title}. Quý khách có thể đặt lịch kiểm tra trực tiếp trên ứng dụng cùng ${garageName}.`;
          await this.prisma.ownerNotification.create({
            data: {
              userId: t.customer.appLink.userId,
              tenantId,
              kind: 'REMINDER',
              title,
              body,
            },
          });
          await this.upsertDispatch({
            tenantId,
            branchId: t.branchId,
            customerId: t.customerId,
            vehicleId: t.vehicleId,
            channel: 'APP',
            kind: dispatchKind,
            dedupeKey: appKey,
            title,
            body,
            status: 'SENT',
          });
          alreadySent.add(appKey);
          appSent++;
        }
      }

      // 2. Kênh Zalo ZNS
      let zaloOk = false;
      if (s.autoZaloEnabled) {
        const zaloKey = `ZALO:${t.refKey}`;
        if (alreadySent.has(zaloKey)) {
          zaloOk = true;
          skipped++;
        } else {
          const res = await this.zalo.send(
            tenantId,
            'CARE_REMINDER',
            t.customer.phone,
            {
              customer_name: t.customer.name,
              plate,
              vehicle: veh ? [veh.make, veh.model].filter(Boolean).join(' ') || null : null,
              care_title: t.title,
              due_date: dueStr,
              branch_name: br?.name ?? null,
              branch_phone: br?.phone ?? null,
              garage_name: garageName,
              app_link: this.zalo.appLink(),
            },
            { refId: t.id },
          );
          if (res.status === 'SENT') {
            zaloOk = true;
            zaloSent++;
            alreadySent.add(zaloKey);
          }
          await this.upsertDispatch({
            tenantId,
            branchId: t.branchId,
            customerId: t.customerId,
            vehicleId: t.vehicleId,
            channel: 'ZALO',
            kind: dispatchKind,
            dedupeKey: zaloKey,
            title: t.title,
            body: `ZNS CARE_REMINDER → ${t.customer.phone ?? ''}`,
            status: res.status === 'SENT' ? 'SENT' : res.status === 'FAILED' ? 'FAILED' : 'SKIPPED',
            error: 'error' in res ? res.error : null,
          });
        }
      }

      // 3. Kênh SMS (bật trực tiếp hoặc dự phòng khi Zalo lỗi)
      const shouldSendSms = s.autoSmsEnabled || (s.smsFallbackWhenZaloFails && s.autoZaloEnabled && !zaloOk);
      if (shouldSendSms) {
        const smsKey = `SMS:${t.refKey}`;
        if (alreadySent.has(smsKey)) {
          skipped++;
        } else {
          const smsRes = await this.sms.send(
            tenantId,
            'CARE_REMINDER',
            t.customer.phone,
            {
              customer_name: t.customer.name,
              plate: plate ?? 'xe cua quy khach',
              vehicle: veh ? [veh.make, veh.model].filter(Boolean).join(' ') : '',
              care_title: t.title,
              due_date: dueStr,
              branch_name: br?.name ?? '',
              branch_phone: br?.phone ?? '',
              garage_name: garageName,
            },
            { refId: t.id },
          );
          if (smsRes.status === 'SENT' || smsRes.status === 'SIMULATED') {
            smsSent++;
            alreadySent.add(smsKey);
          }
          await this.upsertDispatch({
            tenantId,
            branchId: t.branchId,
            customerId: t.customerId,
            vehicleId: t.vehicleId,
            channel: 'SMS',
            kind: dispatchKind,
            dedupeKey: smsKey,
            title: t.title,
            body: smsRes.content ?? `SMS → ${t.customer.phone ?? ''}`,
            status: smsRes.status,
            error: smsRes.error ?? null,
          });
        }
      }
    }

    return { scanned: tasks.length, appSent, zaloSent, smsSent, skipped };
  }

  /** Gửi thông báo nhắc trực tiếp vào hộp thư App Chủ xe cho 1 đầu việc trong Lịch gọi */
  async sendTaskAppNotification(tenantId: string, taskId: string) {
    const t = await this.prisma.careTask.findFirst({
      where: { id: taskId, tenantId },
      include: { customer: { include: { appLink: { select: { userId: true } } } } },
    });
    if (!t) throw new NotFoundException('Không tìm thấy việc chăm sóc');
    const userId = t.customer.appLink?.userId;
    if (!userId) {
      throw new BadRequestException('Khách hàng này chưa kích hoạt tài khoản App Chủ xe');
    }
    const veh = t.vehicleId ? await this.prisma.vehicle.findUnique({ where: { id: t.vehicleId }, select: { plateNo: true } }) : null;
    const garageName = await this.sms.garageName(tenantId);
    const plate = veh ? formatPlate(veh.plateNo) : null;
    const title = plate ? `Nhắc lịch xe ${plate}` : 'Nhắc lịch chăm sóc xe';
    const body = `${t.title}. Quý khách vui lòng đặt lịch hẹn tại ${garageName}.`;

    await this.prisma.ownerNotification.create({
      data: { userId, tenantId, kind: 'REMINDER', title, body },
    });
    await this.upsertDispatch({
      tenantId,
      branchId: t.branchId,
      customerId: t.customerId,
      vehicleId: t.vehicleId,
      channel: 'APP',
      kind: this.classifyKind(t.kind, t.refKey),
      dedupeKey: `APP:${t.refKey}:MANUAL:${Date.now()}`,
      title,
      body,
      status: 'SENT',
    });
    return { status: 'SENT' as const };
  }

  async listLogs(a: Access) {
    const branchWhere: Prisma.ReminderDispatchWhereInput =
      a.branchIds === 'ALL' ? {} : { OR: [{ branchId: null }, { branchId: { in: a.branchIds } }] };
    const rows = await this.prisma.reminderDispatch.findMany({
      where: { tenantId: a.tenantId, AND: [branchWhere] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const custIds = [...new Set(rows.map((r) => r.customerId))];
    const vehIds = [...new Set(rows.map((r) => r.vehicleId).filter((x): x is string => !!x))];
    const [customers, vehicles] = await Promise.all([
      custIds.length ? this.prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true, phone: true } }) : [],
      vehIds.length ? this.prisma.vehicle.findMany({ where: { id: { in: vehIds } }, select: { id: true, plateNo: true } }) : [],
    ]);
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const vehMap = new Map(vehicles.map((v) => [v.id, formatPlate(v.plateNo)]));

    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      kind: r.kind,
      title: r.title,
      body: r.body,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
      customer: custMap.get(r.customerId) ?? null,
      plate: r.vehicleId ? (vehMap.get(r.vehicleId) ?? null) : null,
    }));
  }
}
