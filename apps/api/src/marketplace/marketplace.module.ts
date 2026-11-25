import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CatalogController, CatalogService } from './catalog';
import { PublicMarketController, PublicMarketService } from './public-market';
import { ShopController, ShopService } from './shop';

/** Vòng 3.2: danh mục chuẩn của sàn, hồ sơ gian hàng, tin đăng và kiểm duyệt */
@Module({
  imports: [FilesModule],
  controllers: [CatalogController, ShopController, PublicMarketController],
  providers: [CatalogService, ShopService, PublicMarketService],
})
export class MarketplaceModule {}
