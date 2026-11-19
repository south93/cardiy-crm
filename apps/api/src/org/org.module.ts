import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { RolesController } from './roles.controller';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  controllers: [StaffController, RolesController, BranchesController],
  providers: [StaffService],
})
export class OrgModule {}
