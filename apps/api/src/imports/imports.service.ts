import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatPlate } from '@cardiy/shared';
import type { Prisma } from '@prisma/client';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { customerCode, reserveNumbers } from '../crm/counters';
import { customerSearchText } from '../crm/customers.service';
import { vehicleSearchText } from '../crm/vehicles.service';
import { PrismaService } from '../prisma/prisma.service';
import { analyzeCustomers, analyzeVehicles, decodeFile, detectKind, parseTable, type ExistingData, type ImportPlan, type Issue } from './appsheet';

const CHUNK = 1000;
const ISSUE_PREVIEW = 300;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async loadExisting(tenantId: string): Promise<ExistingData> {
    const [customers, vehicles, branches] = await Promise.all([
      this.prisma.customer.findMany({ where: { tenantId, deletedAt: null, phone: { not: null } }, select: { id: true, phone: true } }),
      this.prisma.vehicle.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, plateNo: true, make: true, model: true, year: true, color: true, vin: true, tireSize: true, fuel: true, transmission: true, note: true, ownerships: { where: { toDate: null }, select: { customerId: true } } },
      }),
      this.prisma.branch.findMany({ where: { tenantId, deletedAt: null }, select: { code: true } }),
    ]);
    return {
      customersByPhone: new Map(customers.map((c) => [c.phone!, c.id])),
      vehiclesByPlate: new Map(
        vehicles.map(({ id, plateNo, ownerships, ...filled }) => [plateNo, { id, ownerCustomerId: ownerships[0]?.customerId ?? null, filled }]),
      ),
      branchCodes: new Set(branches.map((b) => b.code)),
    };
  }

  /** Bước 1: đọc file, phân tích, lưu kết quả xem trước. Chưa ghi dữ liệu khách / xe. */
  async preview(actor: Access, file: { buffer: Buffer; originalname: string } | undefined, ip?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Chưa chọn file');
    const decoded = decodeFile(file.buffer);
    if (decoded.lossy) {
      throw new BadRequestException(
        'File được lưu bằng bảng mã cũ nên đã mất dấu tiếng Việt (chữ bị thay bằng "?"). Hãy xuất lại: Google Sheets → Tệp → Tải xuống → CSV, hoặc Excel → Lưu thành "CSV UTF-8".',
      );
    }
    const { headers, rows } = parseTable(decoded.text);
    const kind = detectKind(headers);
    if (!kind) throw new BadRequestException('Không nhận ra file. Cần file khách hàng (có cột "Tên khách hàng", "Điện thoại") hoặc file xe (có cột "Biển số", "Thông tin khách hàng").');
    if (!rows.length) throw new BadRequestException('File không có dòng dữ liệu nào');

    const existing = await this.loadExisting(actor.tenantId);
    const result = kind === 'CUSTOMERS' ? analyzeCustomers(headers, rows, existing) : analyzeVehicles(headers, rows, existing);
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId: actor.tenantId,
        kind,
        fileName: name,
        encoding: decoded.encoding,
        summary: { ...result.summary, missingBranchCodes: result.plan.missingBranchCodes } as unknown as Prisma.InputJsonValue,
        issues: result.issues as unknown as Prisma.InputJsonValue,
        plan: result.plan as unknown as Prisma.InputJsonValue,
        createdBy: actor.userId,
      },
    });
    await this.audit.log({ tenantId: actor.tenantId, actorId: actor.userId, action: 'import.previewed', entity: 'import', entityId: batch.id, after: { kind, fileName: name, ...result.summary }, ip });
    return this.view(batch.id, actor);
  }

  async view(id: string, actor: Access) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!b) throw new NotFoundException('Không tìm thấy lần nhập');
    const issues = b.issues as unknown as Issue[];
    return {
      id: b.id,
      kind: b.kind,
      status: b.status,
      fileName: b.fileName,
      encoding: b.encoding,
      summary: b.summary,
      issues: issues.slice(0, ISSUE_PREVIEW),
      totalIssues: issues.length,
      createdAt: b.createdAt,
      committedAt: b.committedAt,
    };
  }

  list(actor: Access) {
    return this.prisma.importBatch.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, kind: true, status: true, fileName: true, summary: true, createdAt: true, committedAt: true },
    });
  }

  /** Danh sách vấn đề đầy đủ dạng CSV (mở được bằng Excel, có BOM UTF-8). */
  async issuesCsv(id: string, actor: Access): Promise<string> {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!b) throw new NotFoundException('Không tìm thấy lần nhập');
    const level = { error: 'Lỗi (bỏ qua)', warning: 'Cần xem lại', info: 'Thông tin' } as const;
    const esc = (s: string | number | undefined) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = (b.issues as unknown as Issue[]).map((i) => [i.row, level[i.level], i.message, i.value].map(esc).join(','));
    return '﻿' + ['"Dòng trong file","Mức","Nội dung","Giá trị"', ...lines].join('\r\n');
  }

  /** Bước 2: ghi dữ liệu theo kết quả xem trước (một giao dịch: lỗi giữa chừng thì không ghi gì). */
  async commit(actor: Access, id: string, opts: { createMissingBranches: boolean; branchMap?: Record<string, string> }, ip?: string) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!b) throw new NotFoundException('Không tìm thấy lần nhập');
    if (b.status !== 'PREVIEW' || !b.plan) throw new ConflictException('Lần nhập này đã được thực hiện');
    const plan = b.plan as unknown as ImportPlan;
    const tenantId = actor.tenantId;

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Dữ liệu thay đổi sau khi xem trước (có người vừa thêm khách / xe trùng)?
        const phones = plan.newCustomers.map((c) => c.phone).filter((p): p is string => !!p);
        const plates = plan.newVehicles.map((v) => v.plateNo);
        const [dupPhone, dupPlate] = await Promise.all([
          phones.length ? tx.customer.count({ where: { tenantId, phone: { in: phones } } }) : 0,
          plates.length ? tx.vehicle.count({ where: { tenantId, plateNo: { in: plates } } }) : 0,
        ]);
        if (dupPhone || dupPlate) throw new ConflictException('Dữ liệu đã thay đổi kể từ lúc xem trước. Hãy tải file lên lại để xem trước lần nữa.');

        // Chi nhánh
        const branchByCode = new Map((await tx.branch.findMany({ where: { tenantId, deletedAt: null } })).map((x) => [x.code, x.id]));
        const branchIds = new Set(branchByCode.values());
        let createdBranches = 0;
        // Mã lạ gộp vào chi nhánh đã có (vd. CN5 cũ → CN1)
        for (const [code, target] of Object.entries(opts.branchMap ?? {})) {
          if (!branchIds.has(target)) throw new BadRequestException(`Chi nhánh gộp cho ${code} không hợp lệ`);
          if (!branchByCode.has(code)) branchByCode.set(code, target);
        }
        if (opts.createMissingBranches) {
          for (const code of plan.missingBranchCodes) {
            if (branchByCode.has(code)) continue;
            const nb = await tx.branch.create({ data: { tenantId, code, name: `${code} (từ AppSheet, cần đổi tên)` } });
            branchByCode.set(code, nb.id);
            createdBranches++;
          }
        }

        // Khách hàng
        let first = 0;
        if (plan.newCustomers.length) first = await reserveNumbers(tx, tenantId, 'customer', plan.newCustomers.length);
        const now = new Date();
        const customerRows = plan.newCustomers.map((c, i) => {
          const code = customerCode(first + i);
          return {
            id: c.id,
            tenantId,
            code,
            type: c.type,
            name: c.name,
            phone: c.phone,
            email: c.email,
            address: c.address,
            taxCode: c.taxCode,
            representative: c.representative,
            note: c.note,
            source: c.source,
            branchId: c.branchCode ? (branchByCode.get(c.branchCode) ?? null) : null,
            openingDebt: BigInt(c.openingDebt || 0),
            createdAt: c.createdAt ? new Date(c.createdAt) : now,
            createdBy: actor.userId,
            importBatchId: b.id,
            searchText: customerSearchText({ ...c, code }),
          };
        });
        for (const part of chunks(customerRows)) await tx.customer.createMany({ data: part });

        // Xe mới + chủ xe + số km
        const vehicleRows = plan.newVehicles.map((v) => ({
          id: v.id,
          tenantId,
          plateNo: v.plateNo,
          plateValid: v.plateValid,
          vin: v.vin ?? null,
          make: v.make ?? null,
          model: v.model ?? null,
          year: v.year ?? null,
          color: v.color ?? null,
          fuel: v.fuel ?? null,
          transmission: v.transmission ?? null,
          tireSize: v.tireSize ?? null,
          note: v.note ?? null,
          odometerKm: v.km ?? null,
          createdBy: actor.userId,
          importBatchId: b.id,
          searchText: vehicleSearchText({ plateNo: v.plateNo, vin: v.vin, make: v.make, model: v.model }),
        }));
        for (const part of chunks(vehicleRows)) await tx.vehicle.createMany({ data: part });
        const ownerships = plan.newVehicles.filter((v) => v.ownerId).map((v) => ({ vehicleId: v.id, customerId: v.ownerId!, fromDate: now }));
        for (const part of chunks(ownerships)) await tx.vehicleOwnership.createMany({ data: part });
        const readings = plan.newVehicles.filter((v) => v.km).map((v) => ({ vehicleId: v.id, km: v.km!, source: 'IMPORT', recordedBy: actor.userId }));
        for (const part of chunks(readings)) await tx.odometerReading.createMany({ data: part });

        // Bổ sung thông tin xe đã có
        for (const u of plan.vehicleUpdates) {
          const v = await tx.vehicle.findFirst({ where: { id: u.vehicleId, tenantId }, include: { ownerships: { where: { toDate: null } } } });
          if (!v) continue;
          const merged = { plateNo: v.plateNo, vin: u.data.vin ?? v.vin, make: u.data.make ?? v.make, model: u.data.model ?? v.model };
          const km = u.km && (v.odometerKm === null || u.km > v.odometerKm) ? u.km : null;
          await tx.vehicle.update({ where: { id: v.id }, data: { ...u.data, ...(km ? { odometerKm: km } : {}), searchText: vehicleSearchText(merged) } });
          if (km) await tx.odometerReading.create({ data: { vehicleId: v.id, km, source: 'IMPORT', recordedBy: actor.userId } });
          if (u.setOwnerId && !v.ownerships.length) await tx.vehicleOwnership.create({ data: { vehicleId: v.id, customerId: u.setOwnerId, fromDate: now } });
        }

        await tx.importBatch.update({ where: { id: b.id }, data: { status: 'DONE', committedAt: new Date(), plan: undefined } });
        return {
          customers: customerRows.length,
          vehicles: vehicleRows.length,
          updatedVehicles: plan.vehicleUpdates.length,
          createdBranches,
          firstCode: customerRows[0]?.code ?? null,
          samplePlate: vehicleRows[0] ? formatPlate(vehicleRows[0].plateNo) : null,
        };
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    // Xoá kế hoạch (dung lượng lớn) sau khi nhập xong
    await this.prisma.$executeRaw`UPDATE import_batches SET plan = NULL WHERE id = ${b.id}::uuid`;
    await this.audit.log({ tenantId, actorId: actor.userId, action: 'import.committed', entity: 'import', entityId: b.id, after: { kind: b.kind, fileName: b.fileName, ...result }, ip });
    return result;
  }
}
