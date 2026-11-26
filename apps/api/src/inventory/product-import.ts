import { BadRequestException, ConflictException, Controller, Get, Header, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { searchKey } from '@cardiy/shared';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Request } from 'express';
import type { Access } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { reserveNumbers } from '../crm/counters';
import type { Issue } from '../imports/appsheet';
import { PrismaService } from '../prisma/prisma.service';
import { analyzeProductWorkbook, type Cell, type ProductImportPlan, type SheetRow } from './product-import-rules';
import { applyMovement } from './stock';

const norm = (s: string) => s.normalize('NFC').trim().toUpperCase();
const ISSUE_PREVIEW = 300;

/** Giá trị ô Excel: công thức lấy kết quả, chữ định dạng lấy phần chữ, ô lỗi coi như trống */
function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return null;
}

/** Đọc một sheet thành danh sách dòng {tên cột: giá trị}; dòng 1 là tiêu đề */
function readSheet(wb: ExcelJS.Workbook, name: string): SheetRow[] | null {
  const ws = wb.worksheets.find((w) => norm(w.name) === norm(name));
  if (!ws) return null;
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => (v === null || v === undefined ? '' : String(cellValue(v) ?? '').trim()));
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n === 1) return;
    const vals = row.values as ExcelJS.CellValue[];
    const r: SheetRow = {};
    let any = false;
    header.forEach((h, i) => {
      if (!h) return;
      const v = cellValue(vals[i]);
      if (v !== null && v !== '') any = true;
      r[h] = v;
    });
    rows.push(any ? r : {});
  });
  return rows;
}

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(a: Access, file: { buffer: Buffer; originalname: string } | undefined, ip?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Chưa chọn file');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Không đọc được file. Cần file Excel (.xlsx) xuất từ AppSheet / Google Sheets.');
    }
    const sp = readSheet(wb, 'SẢN PHẨM') ?? [];
    const bg = readSheet(wb, 'BANG_GIA_3CN') ?? [];
    const lots = readSheet(wb, 'LO DATE') ?? [];
    if (!sp.length && !bg.length) throw new BadRequestException('Không thấy sheet "SẢN PHẨM" hoặc "BANG_GIA_3CN" trong file');

    const [products, branches] = await Promise.all([
      this.prisma.product.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, select: { id: true, code: true, kind: true, _count: { select: { movements: true } } } }),
      this.prisma.branch.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, select: { code: true } }),
    ]);
    const { plan, summary, issues } = analyzeProductWorkbook(
      sp,
      bg,
      {
        byCode: new Map(products.map((p) => [p.code, { id: p.id, kind: p.kind, hasMoves: p._count.movements > 0 }])),
        branchCodes: new Set(branches.map((b) => b.code)),
      },
      lots,
    );
    if (!plan.products.length) throw new BadRequestException('File không có sản phẩm nào nhập được');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId: a.tenantId,
        kind: 'PRODUCTS',
        fileName: name,
        encoding: 'xlsx',
        summary: summary as unknown as Prisma.InputJsonValue,
        issues: issues as unknown as Prisma.InputJsonValue,
        plan: plan as unknown as Prisma.InputJsonValue,
        createdBy: a.userId,
      },
    });
    await this.audit.log({ tenantId: a.tenantId, actorId: a.userId, action: 'import.previewed', entity: 'import', entityId: batch.id, after: { kind: 'PRODUCTS', fileName: name, ...summary }, ip });
    return this.view(a, batch.id);
  }

  async view(a: Access, id: string) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId: a.tenantId, kind: 'PRODUCTS' } });
    if (!b) throw new NotFoundException('Không tìm thấy lần nhập');
    const issues = b.issues as unknown as Issue[];
    const plan = b.plan as unknown as ProductImportPlan | null;
    return {
      id: b.id,
      status: b.status,
      fileName: b.fileName,
      summary: b.summary,
      groups: plan?.groups ?? [],
      sample: plan?.products.slice(0, 20).map(({ existingId: _e, ...p }) => p) ?? [],
      issues: issues.slice(0, ISSUE_PREVIEW),
      totalIssues: issues.length,
      createdAt: b.createdAt,
      committedAt: b.committedAt,
    };
  }

  /** Danh sách vấn đề đầy đủ dạng CSV (mở được bằng Excel) */
  async issuesCsv(a: Access, id: string) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId: a.tenantId, kind: 'PRODUCTS' } });
    if (!b) throw new NotFoundException('Không tìm thấy lần nhập');
    const level = { error: 'Bỏ qua', warning: 'Cần xem lại', info: 'Thông tin' } as const;
    const esc = (v: string | number | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = (b.issues as unknown as Issue[]).map((i) => [i.row || '', level[i.level], i.message, i.value].map(esc).join(','));
    return '\ufeff' + ['"Dòng","Mức","Nội dung","Mã hàng"', ...lines].join('\r\n');
  }

  /**
   * Ghi dữ liệu (một giao dịch): tạo nhóm hàng còn thiếu, thêm / cập nhật sản phẩm theo mã,
   * rồi mỗi chi nhánh một phiếu kiểm kê "Tồn đầu kỳ AppSheet" đưa tồn về đúng số trong file.
   * Chạy lại cùng file: sản phẩm được cập nhật, tồn đã khớp thì không sinh chênh lệch.
   */
  async commit(a: Access, id: string, ip?: string) {
    const b = await this.prisma.importBatch.findFirst({ where: { id, tenantId: a.tenantId, kind: 'PRODUCTS' } });
    if (!b) throw new NotFoundException('Không tìm thấy lần nhập');
    if (b.status !== 'PREVIEW' || !b.plan) throw new ConflictException('Lần nhập này đã được thực hiện');
    const plan = b.plan as unknown as ProductImportPlan;
    const t = a.tenantId;

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Khoá lần nhập: bấm "Nhập" hai lần cùng lúc chỉ một lần chạy
        const locked = await tx.importBatch.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'DONE', committedAt: new Date() } });
        if (!locked.count) throw new ConflictException('Lần nhập này đã được thực hiện');

        // 1. Nhóm hàng
        const cats = await tx.productCategory.findMany({ where: { tenantId: t }, select: { id: true, name: true, parentId: true } });
        const key = (name: string, parent: string | null) => `${parent ?? ''}|${name.toLocaleLowerCase('vi')}`;
        const catId = new Map(cats.map((c) => [key(c.name, c.parentId), c.id]));
        let newGroups = 0;
        const ensure = async (name: string, parentId: string | null) => {
          const k = key(name, parentId);
          if (!catId.has(k)) {
            const c = await tx.productCategory.create({ data: { tenantId: t, name, parentId } });
            catId.set(k, c.id);
            newGroups++;
          }
          return catId.get(k)!;
        };
        for (const g of plan.groups) {
          const pid = await ensure(g.name, null);
          for (const c of g.children) await ensure(c, pid);
        }
        const categoryOf = (p: ProductImportPlan['products'][number]) => {
          if (!p.group) return null;
          const pid = catId.get(key(p.group, null))!;
          return p.subgroup ? catId.get(key(p.subgroup, pid))! : pid;
        };

        // 2. Sản phẩm: kiểm tra lại theo mã (có thể vừa có người thêm sau khi xem trước)
        const current = new Map(
          (await tx.product.findMany({ where: { tenantId: t, code: { in: plan.products.map((p) => p.code) } }, select: { id: true, code: true, deletedAt: true } })).map((p) => [p.code, p]),
        );
        const data = (p: ProductImportPlan['products'][number]) => ({
          name: p.name,
          kind: p.kind,
          brand: p.brand,
          unit: p.unit,
          salePrice: BigInt(p.salePrice),
          salePriceBd: p.salePriceBd === null ? null : BigInt(p.salePriceBd),
          vatPrice: p.vatPrice === null ? null : BigInt(p.vatPrice),
          ...(p.costPrice ? { costPrice: BigInt(p.costPrice) } : {}),
          minStock: p.minStock === null ? null : new Prisma.Decimal(p.minStock),
          categoryId: categoryOf(p),
          searchText: searchKey(p.code, p.name, p.brand),
        });
        const fresh = plan.products.filter((p) => !current.has(p.code));
        for (let i = 0; i < fresh.length; i += 500) {
          await tx.product.createMany({ data: fresh.slice(i, i + 500).map((p) => ({ tenantId: t, code: p.code, createdBy: a.userId, ...data(p) })) });
        }
        let updated = 0;
        for (const p of plan.products) {
          const ex = current.get(p.code);
          if (!ex) continue;
          await tx.product.update({ where: { id: ex.id }, data: { ...data(p), deletedAt: null, active: true } });
          updated++;
        }

        // 3. Tồn đầu kỳ: mỗi chi nhánh một phiếu kiểm kê
        const ids = new Map((await tx.product.findMany({ where: { tenantId: t, code: { in: plan.stock.map((s) => s.code) } }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
        const branches = await tx.branch.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, code: true } });
        const docs: { branch: string; code: string; lines: number }[] = [];
        for (const br of branches) {
          const lines = plan.stock.filter((s) => s.branchCode === br.code && ids.has(s.code));
          if (!lines.length) continue;
          const have = new Map(
            (await tx.stockLevel.findMany({ where: { branchId: br.id, productId: { in: lines.map((l) => ids.get(l.code)!) } }, select: { productId: true, quantity: true } })).map((s) => [
              s.productId,
              s.quantity,
            ]),
          );
          const changes = lines.map((l) => ({ ...l, productId: ids.get(l.code)!, delta: new Prisma.Decimal(l.qty).minus(have.get(ids.get(l.code)!) ?? 0) })).filter((l) => !l.delta.isZero());
          if (!changes.length) continue;
          const code = `PK${String(await reserveNumbers(tx, t, 'stockdoc.DIEU_CHINH')).padStart(6, '0')}`;
          const d = await tx.stockDocument.create({ data: { tenantId: t, code, type: 'DIEU_CHINH', branchId: br.id, note: `Tồn đầu kỳ nhập từ file AppSheet (${b.fileName})`, createdBy: a.userId } });
          for (const l of changes) {
            await applyMovement(tx, {
              tenantId: t,
              branchId: br.id,
              productId: l.productId,
              kind: 'DIEU_CHINH',
              quantity: l.delta,
              documentId: d.id,
              actorId: a.userId,
              note: `Tồn đầu kỳ AppSheet: ${l.qty}`,
            });
          }
          docs.push({ branch: br.code, code, lines: changes.length });
        }
        return { created: fresh.length, updated, newGroups, documents: docs };
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
    await this.prisma.importBatch.update({ where: { id }, data: { summary: { ...(b.summary as object), result } as unknown as Prisma.InputJsonValue, plan: Prisma.DbNull } });
    await this.audit.log({ tenantId: t, actorId: a.userId, action: 'import.committed', entity: 'import', entityId: id, after: { kind: 'PRODUCTS', fileName: b.fileName, ...result }, ip });
    return result;
  }
}

@Controller('products/import')
export class ProductImportController {
  constructor(private readonly svc: ProductImportService) {}

  @RequirePermissions('inventory.manage')
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024, files: 1 } }))
  preview(@CurrentAuth() auth: RequestAuth, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Req() req: Request) {
    return this.svc.preview(auth.access, file, clientIp(req));
  }

  @RequirePermissions('inventory.manage')
  @Get(':id')
  view(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.view(auth.access, id);
  }

  @RequirePermissions('inventory.manage')
  @Get(':id/issues.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  issues(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.issuesCsv(auth.access, id);
  }

  @RequirePermissions('inventory.manage', 'inventory.adjust.approve')
  @Post(':id/commit')
  commit(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.commit(auth.access, id, clientIp(req));
  }
}
