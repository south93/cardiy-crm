import { BookingsModule } from './bookings/bookings.controller';
import { CareModule } from './care/care.controller';
import { DashboardModule } from './dashboard/dashboard';
import { OwnerModule } from './owner/owner';
import { ZaloModule } from './zalo/zalo';
import { FinanceModule } from './finance/finance.controller';
import { InventoryModule } from './inventory/inventory.module';
import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CrmModule } from './crm/crm.module';
import { OrdersModule } from './orders/orders.module';
import { AppConfigModule } from './config/config.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { OrgModule } from './org/org.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    AuthModule,
    FilesModule,
    OrgModule,
    CrmModule,
    OrdersModule,
    InventoryModule,
    BookingsModule,
    CareModule,
    FinanceModule,
    DashboardModule,
    OwnerModule,
    ZaloModule,
    HealthModule,
  ],
})
export class AppModule {}
