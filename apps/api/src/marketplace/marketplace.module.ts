import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CatalogController, CatalogService } from './catalog';
import { PublicMarketController, PublicMarketService } from './public-market';
import { RequestsController, RequestsService } from './requests';
import { ReviewsReportsController, ReviewsReportsService } from './reviews-reports';
import { ShopController, ShopService } from './shop';
import { ShopStatsController, ShopStatsService } from './shop-stats';

/** Vòng 3.2–3.5: danh mục chuẩn, gian hàng, tin đăng, yêu cầu đặt hàng, đánh giá, phản ánh & thống kê */
@Module({
  imports: [FilesModule],
  controllers: [
    CatalogController,
    ShopController,
    PublicMarketController,
    RequestsController,
    ReviewsReportsController,
    ShopStatsController,
  ],
  providers: [
    CatalogService,
    ShopService,
    PublicMarketService,
    RequestsService,
    ReviewsReportsService,
    ShopStatsService,
  ],
})
export class MarketplaceModule {}
