import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { JobsController, JobsService } from './jobs';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrintController, PrintService } from './print';

@Module({
  imports: [FilesModule],
  controllers: [OrdersController, PrintController, JobsController],
  providers: [OrdersService, PrintService, JobsService],
  exports: [OrdersService],
})
export class OrdersModule {}
