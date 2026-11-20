import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrintController, PrintService } from './print';

@Module({
  controllers: [OrdersController, PrintController],
  providers: [OrdersService, PrintService],
  exports: [OrdersService],
})
export class OrdersModule {}
