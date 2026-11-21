import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { InventoryService } from './inventory.service';

const money = z.coerce.number().int('Tiền là số nguyên (đồng)').min(0).max(1_000_000_000_000);
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const qty = z.union([z.string().max(20), z.number()]);
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

const productSchema = z.object({
  code: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9._\-/]*$/, 'Mã hàng chỉ gồm chữ, số và . _ - /')
    .optional()
    .nullable(),
  name: z.string().trim().min(1, 'Cần nhập tên sản phẩm').max(200),
  kind: z.enum(['PHU_TUNG', 'DICH_VU']),
  categoryId: z.string().uuid().optional().nullable(),
  brand: text(80),
  unit: text(20),
  salePrice: money,
  costPrice: money.optional(),
  vehicleMakes: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
  minStock: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  mfgMonth: z.coerce.number().int().min(1, 'Tháng 1–12').max(12, 'Tháng 1–12').optional().nullable(),
  mfgYear: z.coerce.number().int().min(1990, 'Năm sản xuất không hợp lệ').max(new Date().getFullYear() + 1, 'Năm sản xuất không hợp lệ').optional().nullable(),
  note: text(2000),
  active: z.boolean().optional(),
});
const productCreate = productSchema.refine((v) => !v.mfgMonth || v.mfgYear, { message: 'Có tháng sản xuất thì cần nhập năm', path: ['mfgYear'] });
const listSchema = z.object({
  q: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  kind: z.enum(['PHU_TUNG', 'DICH_VU']).optional(),
  make: z.string().max(40).optional(),
  branchId: z.string().uuid().optional(),
  lowStock: bool.optional(),
  active: bool.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const supplierSchema = z.object({ name: z.string().trim().min(1, 'Cần nhập tên nhà cung cấp').max(150), phone: text(20), address: text(300), taxCode: text(20), note: text(1000) });
const docSchema = z.object({
  type: z.enum(['NHAP', 'CHUYEN', 'DIEU_CHINH']),
  branchId: z.string().uuid(),
  toBranchId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  refNo: text(50),
  note: text(1000),
  lines: z.array(z.object({ productId: z.string().uuid(), quantity: qty.optional(), unitCost: money.optional(), countedQty: qty.optional() })).min(1, 'Phiếu chưa có dòng hàng nào').max(300),
});
const docList = z.object({
  type: z.enum(['NHAP', 'CHUYEN', 'DIEU_CHINH']).optional(),
  branchId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller()
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  // Nhóm sản phẩm
  @RequirePermissions('inventory.view')
  @Get('product-categories')
  categories(@CurrentAuth() auth: RequestAuth) {
    return this.inv.categories(auth.access);
  }

  @RequirePermissions('inventory.manage')
  @Post('product-categories')
  createCategory(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(80), parentId: z.string().uuid().optional().nullable() }))) dto: { name: string; parentId?: string | null }) {
    return this.inv.createCategory(auth.access, dto);
  }

  @RequirePermissions('inventory.manage')
  @Patch('product-categories/:id')
  renameCategory(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(80) }))) dto: { name: string }) {
    return this.inv.renameCategory(auth.access, id, dto.name);
  }

  // Sản phẩm
  @RequirePermissions('inventory.view')
  @Get('products')
  list(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.inv.list(auth.access, q);
  }

  @RequirePermissions('inventory.view')
  @Get('products/vehicle-makes')
  makes(@CurrentAuth() auth: RequestAuth) {
    return this.inv.makes(auth.access);
  }

  @RequirePermissions('inventory.view')
  @Get('products/:id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.inv.get(auth.access, id);
  }

  @RequirePermissions('inventory.manage')
  @Post('products')
  create(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(productCreate)) dto: z.infer<typeof productSchema>, @Req() req: Request) {
    return this.inv.create(auth.access, dto, clientIp(req));
  }

  @RequirePermissions('inventory.manage')
  @Patch('products/:id')
  update(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productSchema.partial())) dto: Partial<z.infer<typeof productSchema>>, @Req() req: Request) {
    return this.inv.update(auth.access, id, dto, clientIp(req));
  }

  @RequirePermissions('inventory.manage')
  @Delete('products/:id')
  remove(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inv.remove(auth.access, id, clientIp(req));
  }

  // Nhà cung cấp
  @RequirePermissions('purchase.manage')
  @Get('suppliers')
  suppliers(@CurrentAuth() auth: RequestAuth, @Query('q') q?: string) {
    return this.inv.suppliers(auth.access, q);
  }

  @RequirePermissions('purchase.manage')
  @Post('suppliers')
  createSupplier(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(supplierSchema)) dto: z.infer<typeof supplierSchema>, @Req() req: Request) {
    return this.inv.saveSupplier(auth.access, null, dto, clientIp(req));
  }

  @RequirePermissions('purchase.manage')
  @Patch('suppliers/:id')
  updateSupplier(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(supplierSchema)) dto: z.infer<typeof supplierSchema>, @Req() req: Request) {
    return this.inv.saveSupplier(auth.access, id, dto, clientIp(req));
  }

  // Phiếu kho (quyền chi tiết theo loại phiếu kiểm tra trong service)
  @RequirePermissions('inventory.view')
  @Get('stock-documents')
  documents(@CurrentAuth() auth: RequestAuth, @Query(new ZodPipe(docList)) q: z.infer<typeof docList>) {
    return this.inv.documents(auth.access, q);
  }

  @RequirePermissions('inventory.view')
  @Get('stock-documents/:id')
  document(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.inv.document(auth.access, id);
  }

  @RequirePermissions('inventory.view')
  @Post('stock-documents')
  createDocument(@CurrentAuth() auth: RequestAuth, @Body(new ZodPipe(docSchema)) dto: z.infer<typeof docSchema>, @Req() req: Request) {
    return this.inv.createDocument(auth.access, dto, clientIp(req));
  }
}
