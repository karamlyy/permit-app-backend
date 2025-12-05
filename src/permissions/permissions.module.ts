import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { PermissionApproval } from './permission-approval.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { PermissionAudit } from './permission-audit.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { PermissionHelpersService } from './permission-helpers.service';
import { PermissionChainService } from './permission-chain.service';
import { PermissionPolicyService } from './permission-policy.service';
import { PermissionApprovalService } from './permission-approval.service';
import { PermissionQueryService } from './permission-query.service';
import { PermissionBalanceService } from './permission-balance.service';
import { PermissionAuditService } from './permission-audit.service';

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
  providers: [
    PermissionsService,
    PermissionHelpersService,
    PermissionChainService,
    PermissionPolicyService,
    PermissionApprovalService,
    PermissionQueryService,
    PermissionBalanceService,
    PermissionAuditService,
  ],
  controllers: [PermissionsController],
})
export class PermissionsModule {}