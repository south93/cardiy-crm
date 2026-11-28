import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { JobsController, JobsService } from './jobs';
import { OrderMediaController, OrderMediaService } from './media';
import { OrdersController } from './orders.controller';
import { QuotesController, QuotesService } from './quotes';
import { OrdersService } from './orders.service';
import { PrintController, PrintService } from './print';

@Module({
  imports: [FilesModule],
  controllers: [OrdersController, PrintController, JobsController, QuotesController, OrderMediaController],
  providers: [OrdersService, PrintService, JobsService, QuotesService, OrderMediaService],
  exports: [OrdersService, OrderMediaService],
})
export class OrdersModule {}
