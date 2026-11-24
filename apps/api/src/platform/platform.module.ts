import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PartnerApplicationsService, PlatformPartnersController, PublicPartnerController } from './partner-applications';
import { PartnerBillingController, PartnerBillingService } from './partner-billing';

/** Vòng 3.1: đăng ký & duyệt đối tác, gói và phí đối tác */
@Module({
  imports: [FilesModule],
  controllers: [PublicPartnerController, PlatformPartnersController, PartnerBillingController],
  providers: [PartnerApplicationsService, PartnerBillingService],
})
export class PlatformModule {}
