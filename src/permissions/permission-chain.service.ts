import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { PermissionType } from '../common/enums/permission-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { PermissionApproval } from './permission-approval.entity';
import { PermissionHelpersService } from './permission-helpers.service';

@Injectable()
export class PermissionChainService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(PermissionApproval)
    private readonly approvalRepo: Repository<PermissionApproval>,
    private readonly helpersService: PermissionHelpersService,
  ) {}

  async getApprovalChainForPermission(
    companyId: number,
    employee: User,
    type: PermissionType,
  ): Promise<UserRole[]> {
    // Employee-ni departamenti ilə birlikdə götürək
    const fullEmployee = await this.usersRepo.findOne({
      where: { id: employee.id },
      relations: ['department', 'department.manager'],
    });

    if (!fullEmployee) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    const isShortType =
      type === PermissionType.SHORT_LEAVE ||
      type === PermissionType.REMOTE_WORK;

    let base: UserRole[] = [];

    // 1) Role + permission type-ə görə "ideal" chain
    switch (fullEmployee.role) {
      case UserRole.EMPLOYEE:
        if (isShortType) {
          // EMPLOYEE (qısa icazə) → MANAGER → HEAD_OF_DEPARTMENT → HR
          base = [
            UserRole.MANAGER,
            UserRole.HEAD_OF_DEPARTMENT,
            UserRole.HR,
          ];
        } else {
          // EMPLOYEE (uzun icazə) → MANAGER → HEAD_OF_DEPARTMENT → HEAD_OF_HR → COMPANY_ADMIN
          base = [
            UserRole.MANAGER,
            UserRole.HEAD_OF_DEPARTMENT,
            UserRole.HEAD_OF_HR,
            UserRole.COMPANY_ADMIN,
          ];
        }
        break;

      case UserRole.MANAGER:
        // MANAGER → HEAD_OF_DEPARTMENT → HEAD_OF_HR → COMPANY_ADMIN
        base = [
          UserRole.HEAD_OF_DEPARTMENT,
          UserRole.HEAD_OF_HR,
          UserRole.COMPANY_ADMIN,
        ];
        break;

      case UserRole.HEAD_OF_DEPARTMENT:
        // HEAD_OF_DEPARTMENT → HEAD_OF_HR → COMPANY_ADMIN
        base = [UserRole.HEAD_OF_HR, UserRole.COMPANY_ADMIN];
        break;

      case UserRole.HR:
        // HR → HEAD_OF_HR → COMPANY_ADMIN
        base = [UserRole.HEAD_OF_HR, UserRole.COMPANY_ADMIN];
        break;

      case UserRole.HEAD_OF_HR:
        // HEAD_OF_HR → COMPANY_ADMIN
        base = [UserRole.COMPANY_ADMIN];
        break;

      case UserRole.COMPANY_ADMIN:
        base = [];
        break;

      default:
        base = [];
    }

    // 2) Employee öz rolunu chain-dən çıxar (self-approve olmasın)
    base = base.filter((r) => r !== fullEmployee.role);

    // 3) Helper-lərlə real mövcud step-ləri filtr elə
    const result: UserRole[] = [];

    for (const role of base) {
      if (role === UserRole.MANAGER) {
        const manager = fullEmployee.department?.manager;
        if (manager) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.HEAD_OF_DEPARTMENT) {
        const head =
          await this.helpersService.findHeadOfDepartmentForEmployee(
            fullEmployee.id,
          );
        if (head) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.HR) {
        const hr = await this.helpersService.findAnyHr(companyId);
        if (hr) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.HEAD_OF_HR) {
        const headOfHr = await this.helpersService.findHeadOfHr(companyId);
        if (headOfHr) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.COMPANY_ADMIN) {
        const admin =
          await this.helpersService.findAnyCompanyAdmin(companyId);
        if (admin) {
          result.push(role);
        }
        continue;
      }

      // fallback
      result.push(role);
    }

    return result;
  }

  async getApprovalHistory(
    permissionId: number,
  ): Promise<PermissionApproval[]> {
    return this.approvalRepo.find({
      where: { permission: { id: permissionId } },
      order: { stepNumber: 'ASC' },
      relations: ['approver'],
    });
  }
}

