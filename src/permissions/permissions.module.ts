import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Permission, Company, User, Department])],
  providers: [PermissionsService],
  controllers: [PermissionsController],
})
export class PermissionsModule {}