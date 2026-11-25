import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CatalogController, CatalogService } from './catalog';
import { PublicMarketController, PublicMarketService } from './public-market';
import { RequestsController, RequestsService } from './requests';
import { ShopController, ShopService } from './shop';

/** Vòng 3.2: danh mục chuẩn của sàn, hồ sơ gian hàng, tin đăng và kiểm duyệt */
@Module({
  imports: [FilesModule],
  controllers: [CatalogController, ShopController, PublicMarketController, RequestsController],
  providers: [CatalogService, ShopService, PublicMarketService, RequestsService],
})
export class MarketplaceModule {}
