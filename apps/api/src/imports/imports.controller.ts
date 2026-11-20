import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { ZodPipe } from '../common/zod.pipe';
import { ImportsService } from './imports.service';

/** Nhập dữ liệu từ AppSheet / Excel (CSV): xem trước → xác nhận. Chỉ người có quyền data.import. */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @RequirePermissions('data.import')
  @Get()
  list(@CurrentAuth() auth: RequestAuth) {
    return this.imports.list(auth.access);
  }

  @RequirePermissions('data.import')
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024, files: 1 } }))
  preview(@CurrentAuth() auth: RequestAuth, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    return this.imports.preview(auth.access, file, clientIp(req));
  }

  @RequirePermissions('data.import')
  @Get(':id')
  view(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.view(id, auth.access);
  }

  @RequirePermissions('data.import')
  @Get(':id/issues.csv')
  async issues(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const csv = await this.imports.issuesCsv(id, auth.access);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="van-de-nhap-du-lieu-${id.slice(0, 8)}.csv"`);
    res.send(csv);
  }

  @RequirePermissions('data.import')
  @Post(':id/commit')
  @HttpCode(200)
  commit(
    @CurrentAuth() auth: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ createMissingBranches: z.boolean().default(true) }))) dto: { createMissingBranches: boolean },
    @Req() req: Request,
  ) {
    return this.imports.commit(auth.access, id, dto, clientIp(req));
  }
}
