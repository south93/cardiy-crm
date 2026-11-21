import { Module } from '@nestjs/common';
import { ImportsController } from '../imports/imports.controller';
import { ImportsService } from '../imports/imports.service';
import { CustomersController, LookupController, VehiclesController } from './crm.controllers';
import { CustomersService } from './customers.service';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [CustomersController, VehiclesController, LookupController, ImportsController],
  providers: [CustomersService, VehiclesService, ImportsService],
})
export class CrmModule {}
