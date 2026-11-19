import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentAuth, Public, RequirePermissions } from '../common/auth.decorators';
import { clientIp, type RequestAuth } from '../common/request-auth';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from './files.service';
import { LocalStorage } from './storage';

const HARD_LIMIT_BYTES = 25 * 1024 * 1024;

@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
  ) {}

  /** Tải lên (multipart, trường "file"). */
  @RequirePermissions('file.upload')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1 } }))
  upload(@CurrentAuth() auth: RequestAuth, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    return this.files.upload(auth.tenantId, auth.userId, file, clientIp(req));
  }

  @Get(':id')
  get(@CurrentAuth() auth: RequestAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.getForTenant(id, auth.tenantId);
  }

  /** Chỉ dùng khi lưu cục bộ: phục vụ file qua link có chữ ký + hạn dùng. */
  @Public()
  @Get('raw/:id')
  async raw(@Param('id', ParseUUIDPipe) id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const driver = this.files.driver;
    if (!(driver instanceof LocalStorage)) throw new NotFoundException();
    if (!sig || !driver.verify(id, Number(exp), sig)) throw new ForbiddenException('Link đã hết hạn hoặc không hợp lệ');
    const f = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    const body = await driver.read(f.storageKey);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.send(body);
  }
}
