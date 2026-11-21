import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrintController, PrintService } from './print';

@Module({
  imports: [FilesModule],
  controllers: [OrdersController, PrintController],
  providers: [OrdersService, PrintService],
  exports: [OrdersService],
})
export class OrdersModule {}
