import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  FUEL_LEVELS,
  ORDER_PHOTO_STAGES,
  type FuelLevel,
  type OrderIntakeData,
  type OrderPhotoItem,
  type OrderPhotoStage,
} from '@cardiy/shared';
import type { OrderIntake, OrderPhoto, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AccessService, type Access } from '../auth/access.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { intakeUpdateError, photoDeleteError, photoUploadError, type OrderStatus } from './order-rules';

const URL_TTL_SECONDS = 60 * 60;
const MAX_PHOTOS_PER_STAGE = 30;

export const intakeInputSchema = z.object({
  fuelLevel: z.enum(FUEL_LEVELS).nullable().optional(),
  warningLights: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  exteriorNote: z.string().trim().max(1000).nullable().optional(),
  belongings: z.string().trim().max(500).nullable().optional(),
  hasSpareAndTool: z.boolean().nullable().optional(),
});

export const photoInputItemSchema = z.object({
  fileId: z.string().uuid(),
  tag: z.string().trim().max(60).nullable().optional(),
  caption: z.string().trim().max(300).nullable().optional(),
});

export const addPhotosSchema = z.object({
  stage: z.enum(ORDER_PHOTO_STAGES),
  photos: z.array(photoInputItemSchema).min(1, 'Chọn ít nhất 1 hình ảnh').max(12, 'Mỗi lần tải tối đa 12 hình ảnh'),
});

export type IntakeInput = z.infer<typeof intakeInputSchema>;
export type PhotoInputItem = z.infer<typeof photoInputItemSchema>;

export interface OrderPhotoView extends OrderPhotoItem {
  uploaderId: string | null;
}

@Injectable()
export class OrderMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private branchWhere(a: Access): Prisma.RepairOrderWhereInput {
    return a.branchIds === 'ALL' ? {} : { branchId: { in: a.branchIds } };
  }

  private async loadOrder(
    a: Access,
    orderId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const o = await tx.repairOrder.findFirst({
      where: { id: orderId, tenantId: a.tenantId, ...this.branchWhere(a) },
    });
    if (!o) throw new NotFoundException('Không tìm thấy đơn hàng');
    return o;
  }

  private throwRule(err: { kind: 'conflict' | 'forbidden'; message: string }) {
    if (err.kind === 'conflict') throw new ConflictException(err.message);
    throw new ForbiddenException(err.message);
  }

  /** Xác thực tất cả fileId đều là ảnh thuộc đúng tenant */
  async assertOwnedImages(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    fileIds: string[],
  ) {
    const unique = [...new Set(fileIds)];
    if (!unique.length) return;
    const rows = await tx.fileObject.findMany({
      where: { id: { in: unique }, tenantId },
      select: { id: true, mime: true },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException('Có hình ảnh không hợp lệ hoặc không thuộc garage');
    }
    if (rows.some((r) => !r.mime.startsWith('image/'))) {
      throw new BadRequestException('Chỉ cho phép đính kèm file ảnh (JPG, PNG, WEBP)');
    }
  }

  /** Ghi thông tin hiện trạng & ảnh tiếp nhận ngay trong giao dịch tạo đơn mới */
  async attachOnCreate(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      orderId: string;
      userId: string;
      intake?: IntakeInput | null;
      intakePhotos?: PhotoInputItem[] | null;
    },
  ) {
    const { tenantId, orderId, userId, intake, intakePhotos } = params;
    if (intake) {
      const hasAny =
        intake.fuelLevel != null ||
        (intake.warningLights?.length ?? 0) > 0 ||
        !!intake.exteriorNote?.trim() ||
        !!intake.belongings?.trim() ||
        intake.hasSpareAndTool != null;
      if (hasAny) {
        await tx.orderIntake.create({
          data: {
            tenantId,
            orderId,
            fuelLevel: intake.fuelLevel ?? null,
            warningLights: [...new Set((intake.warningLights ?? []).map((x) => x.trim()).filter(Boolean))],
            exteriorNote: intake.exteriorNote?.trim() || null,
            belongings: intake.belongings?.trim() || null,
            hasSpareAndTool: intake.hasSpareAndTool ?? null,
            updatedBy: userId,
          },
        });
      }
    }
    if (intakePhotos?.length) {
      if (intakePhotos.length > MAX_PHOTOS_PER_STAGE) {
        throw new BadRequestException(`Tối đa ${MAX_PHOTOS_PER_STAGE} ảnh hiện trạng tiếp nhận`);
      }
      await this.assertOwnedImages(
        tx,
        tenantId,
        intakePhotos.map((p) => p.fileId),
      );
      await tx.orderPhoto.createMany({
        data: intakePhotos.map((p) => ({
          tenantId,
          orderId,
          fileId: p.fileId,
          stage: 'TIEP_NHAN',
          tag: p.tag?.trim() || null,
          caption: p.caption?.trim() || null,
          uploadedBy: userId,
        })),
      });
    }
  }

  /** Chuyển bản ghi DB thành dữ liệu trả về kèm link ảnh có chữ ký */
  async serialize(
    tenantId: string,
    intake: OrderIntake | null,
    photos: OrderPhoto[],
  ): Promise<{ intake: OrderIntakeData | null; photos: OrderPhotoView[] }> {
    const userIds = [
      ...new Set(
        [intake?.updatedBy, ...photos.map((p) => p.uploadedBy)].filter((x): x is string => !!x),
      ),
    ];
    const fileIds = [...new Set(photos.map((p) => p.fileId))];
    const [users, fileRows] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
        : Promise.resolve([]),
      fileIds.length
        ? this.prisma.fileObject.findMany({
            where: { id: { in: fileIds }, tenantId },
            select: { id: true, storageKey: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u.fullName]));
    const urlPairs = await Promise.all(
      fileRows.map(async (f) => [f.id, await this.files.driver.signedUrl(f.storageKey, f.id, URL_TTL_SECONDS)] as const),
    );
    const urlMap = new Map(urlPairs);

    const intakeView: OrderIntakeData | null = intake
      ? {
          fuelLevel: (intake.fuelLevel as FuelLevel | null) ?? null,
          warningLights: intake.warningLights ?? [],
          exteriorNote: intake.exteriorNote,
          belongings: intake.belongings,
          hasSpareAndTool: intake.hasSpareAndTool,
          updatedAt: intake.updatedAt.toISOString(),
          updatedBy: intake.updatedBy ? (userMap.get(intake.updatedBy) ?? null) : null,
        }
      : null;

    const photoViews: OrderPhotoView[] = photos
      .filter((p) => urlMap.has(p.fileId))
      .map((p) => ({
        id: p.id,
        fileId: p.fileId,
        url: urlMap.get(p.fileId)!,
        stage: p.stage as OrderPhotoStage,
        tag: p.tag,
        caption: p.caption,
        uploadedBy: p.uploadedBy ? (userMap.get(p.uploadedBy) ?? null) : null,
        uploaderId: p.uploadedBy,
        createdAt: p.createdAt.toISOString(),
      }));

    return { intake: intakeView, photos: photoViews };
  }

  async getMedia(a: Access, orderId: string) {
    const o = await this.loadOrder(a, orderId);
    const [intake, photos] = await Promise.all([
      this.prisma.orderIntake.findUnique({ where: { orderId } }),
      this.prisma.orderPhoto.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const perms = new Set(a.permissions);
    const status = o.status as OrderStatus;
    const serialized = await this.serialize(a.tenantId, intake, photos);
    return {
      orderId,
      status: o.status,
      ...serialized,
      permissions: {
        canEditIntake: intakeUpdateError(status, perms) === null,
        canUploadIntake:
          photoUploadError({
            status,
            stage: 'TIEP_NHAN',
            permissions: perms,
            technicianId: o.technicianId,
            membershipId: a.membershipId || null,
          }) === null,
        canUploadTech:
          photoUploadError({
            status,
            stage: 'HOAN_TAT',
            permissions: perms,
            technicianId: o.technicianId,
            membershipId: a.membershipId || null,
          }) === null,
        currentUserId: a.userId,
        isManager: AccessService.has(a, 'ro.manage'),
      },
    };
  }

  async saveIntake(a: Access, orderId: string, dto: IntakeInput, ip?: string) {
    const perms = new Set(a.permissions);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const o = await this.loadOrder(a, orderId, tx);
      const err = intakeUpdateError(o.status as OrderStatus, perms);
      if (err) this.throwRule(err);
      const data = {
        fuelLevel: dto.fuelLevel ?? null,
        warningLights: [...new Set((dto.warningLights ?? []).map((x) => x.trim()).filter(Boolean))],
        exteriorNote: dto.exteriorNote?.trim() || null,
        belongings: dto.belongings?.trim() || null,
        hasSpareAndTool: dto.hasSpareAndTool ?? null,
        updatedBy: a.userId,
      };
      await tx.orderIntake.upsert({
        where: { orderId },
        create: { tenantId: a.tenantId, orderId, ...data },
        update: data,
      });
      await this.audit.log(
        { tenantId: a.tenantId, actorId: a.userId, action: 'order.intake', entity: 'order', entityId: orderId, after: data, ip },
        tx,
      );
    });
    return this.getMedia(a, orderId);
  }

  async addPhotos(a: Access, orderId: string, dto: z.infer<typeof addPhotosSchema>, ip?: string) {
    const perms = new Set(a.permissions);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const o = await this.loadOrder(a, orderId, tx);
      const err = photoUploadError({
        status: o.status as OrderStatus,
        stage: dto.stage,
        permissions: perms,
        technicianId: o.technicianId,
        membershipId: a.membershipId || null,
      });
      if (err) this.throwRule(err);

      const currentCount = await tx.orderPhoto.count({ where: { orderId, stage: dto.stage } });
      if (currentCount + dto.photos.length > MAX_PHOTOS_PER_STAGE) {
        throw new BadRequestException(`Mỗi giai đoạn lưu tối đa ${MAX_PHOTOS_PER_STAGE} hình ảnh`);
      }
      await this.assertOwnedImages(
        tx,
        a.tenantId,
        dto.photos.map((p) => p.fileId),
      );

      // KTV chụp ảnh kiểm tra / hoàn tất trên đơn chưa có KTV thì tự nhận đơn (giống luồng lưu phiếu kiểm tra)
      if (!o.technicianId && !AccessService.has(a, 'ro.manage') && a.membershipId) {
        await tx.repairOrder.update({ where: { id: orderId }, data: { technicianId: a.membershipId } });
      }

      await tx.orderPhoto.createMany({
        data: dto.photos.map((p) => ({
          tenantId: a.tenantId,
          orderId,
          fileId: p.fileId,
          stage: dto.stage,
          tag: p.tag?.trim() || null,
          caption: p.caption?.trim() || null,
          uploadedBy: a.userId,
        })),
      });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'order.photos.added',
          entity: 'order',
          entityId: orderId,
          after: { stage: dto.stage, count: dto.photos.length },
          ip,
        },
        tx,
      );
    });
    return this.getMedia(a, orderId);
  }

  async removePhoto(a: Access, orderId: string, photoId: string, ip?: string) {
    const perms = new Set(a.permissions);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM repair_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const o = await this.loadOrder(a, orderId, tx);
      const p = await tx.orderPhoto.findFirst({ where: { id: photoId, orderId, tenantId: a.tenantId } });
      if (!p) throw new NotFoundException('Không tìm thấy hình ảnh');
      const err = photoDeleteError({
        status: o.status as OrderStatus,
        stage: p.stage as OrderPhotoStage,
        permissions: perms,
        technicianId: o.technicianId,
        membershipId: a.membershipId || null,
        uploadedBy: p.uploadedBy,
        userId: a.userId,
      });
      if (err) this.throwRule(err);

      await tx.orderPhoto.delete({ where: { id: photoId } });
      await this.audit.log(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'order.photos.removed',
          entity: 'order',
          entityId: orderId,
          before: { photoId, stage: p.stage, tag: p.tag },
          ip,
        },
        tx,
      );
    });
    return this.getMedia(a, orderId);
  }
}

@Controller('orders')
export class OrderMediaController {
  constructor(private readonly media: OrderMediaService) {}

  @RequirePermissions('ro.view')
  @Get(':id/media')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.getMedia(auth.access, id);
  }

  @RequirePermissions('ro.manage')
  @Put(':id/intake')
  saveIntake(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(intakeInputSchema)) dto: IntakeInput,
    @Req() req: Request,
  ) {
    return this.media.saveIntake(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('ro.view', 'file.upload')
  @Post(':id/photos')
  addPhotos(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addPhotosSchema)) dto: z.infer<typeof addPhotosSchema>,
    @Req() req: Request,
  ) {
    return this.media.addPhotos(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('ro.view')
  @Delete(':id/photos/:photoId')
  removePhoto(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Req() req: Request,
  ) {
    return this.media.removePhoto(auth.access, id, photoId, clientIp(req));
  }
}
