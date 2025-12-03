import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { PermissionApproval } from './permission-approval.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { PermissionAudit } from './permission-audit.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      PermissionApproval,
      Company,
      User,
      Department,
      PermissionAudit,
    ]),
  ],
  providers: [PermissionsService],
  controllers: [PermissionsController],
})
export class PermissionsModule {}