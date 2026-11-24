import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CatalogController, CatalogService } from './catalog';
import { ShopController, ShopService } from './shop';

/** Vòng 3.2: danh mục chuẩn của sàn, hồ sơ gian hàng, tin đăng và kiểm duyệt */
@Module({
  imports: [FilesModule],
  controllers: [CatalogController, ShopController],
  providers: [CatalogService, ShopService],
})
export class MarketplaceModule {}
