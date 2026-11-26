import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductImportController, ProductImportService } from './product-import';

@Module({
  controllers: [ProductImportController, InventoryController],
  providers: [InventoryService, ProductImportService],
})
export class InventoryModule {}
