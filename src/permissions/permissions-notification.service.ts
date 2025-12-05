import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PermissionType } from '../common/enums/permission-type.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { PermissionChainService } from './permission-chain.service';
import { PermissionHelpersService } from './permission-helpers.service';
import { FcmNotificationService } from '../notifications/fcm-notification.service';
import { PermissionApproval } from './permission-approval.entity';

@Injectable()
export class PermissionsNotificationService {
  private readonly logger = new Logger(PermissionsNotificationService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly chainService: PermissionChainService,
    private readonly helpersService: PermissionHelpersService,
    private readonly fcmService: FcmNotificationService,
  ) {}

  async notifyOnPermissionCreated(permission: Permission): Promise<void> {
    try {
      // Permission-i company və employee relation-ları ilə birlikdə fetch et
      const perm = await this.permRepo.findOne({
        where: { id: permission.id },
        relations: ['company', 'employee', 'employee.department'],
      });

      if (!perm || !perm.company || !perm.employee) {
        this.logger.warn(
          `Permission ${permission.id} not found or missing relations`,
        );
        return;
      }

      // Approval chain-i al
      const chainRoles = await this.chainService.getApprovalChainForPermission(
        perm.company.id,
        perm.employee,
        perm.type,
      );

      if (chainRoles.length === 0) {
        this.logger.debug(
          `No approval chain for permission ${perm.id}, skipping notification`,
        );
        return;
      }

      // İlk approver rolunu tap
      const firstRole = chainRoles[0];
      const approvers = await this.findApproversForRole(
        perm.company.id,
        perm.employee,
        firstRole,
      );

      if (approvers.length === 0) {
        this.logger.warn(
          `No approvers found for role ${firstRole} in permission ${perm.id}`,
        );
        return;
      }

      // Permission type-i Azərbaycan dilində
      const permissionTypeLabel = this.getPermissionTypeLabel(perm.type);

      // Notification göndər
      const title = 'Yeni icazə istəyi';
      const body = `${perm.employee.name} ${permissionTypeLabel} üçün icazə istəyib.`;

      const data: Record<string, string> = {
        permissionId: perm.id.toString(),
        type: perm.type,
        employeeName: perm.employee.name,
        employeeId: perm.employee.id.toString(),
      };

      // Bütün approver-lərə notification göndər
      for (const approver of approvers) {
        await this.fcmService.sendToUser(approver, title, body, data);
      }
    } catch (error) {
      this.logger.warn(
        `Error in notifyOnPermissionCreated: ${error.message}`,
        error.stack,
      );
    }
  }

  async notifyOnApprovedStep(
    permission: Permission,
    chainRoles: UserRole[],
    history: PermissionApproval[],
  ): Promise<void> {
    try {
      // Permission-i company və employee relation-ları ilə birlikdə fetch et
      const perm = await this.permRepo.findOne({
        where: { id: permission.id },
        relations: ['company', 'employee', 'employee.department'],
      });

      if (!perm || !perm.company || !perm.employee) {
        this.logger.warn(
          `Permission ${permission.id} not found or missing relations`,
        );
        return;
      }

      const nextStepIndex = history.length;

      // Əgər növbəti addım varsa
      if (nextStepIndex < chainRoles.length) {
        const nextRole = chainRoles[nextStepIndex];
        const approvers = await this.findApproversForRole(
          perm.company.id,
          perm.employee,
          nextRole,
        );

        if (approvers.length > 0) {
          const permissionTypeLabel = this.getPermissionTypeLabel(perm.type);
          const title = 'İcazə istəyi sizə yönləndirildi';
          const body = `${perm.employee.name} tərəfindən ${permissionTypeLabel} üçün icazə istəyi sizə yönləndirildi.`;

          const data: Record<string, string> = {
            permissionId: perm.id.toString(),
            type: perm.type,
            employeeName: perm.employee.name,
            employeeId: perm.employee.id.toString(),
          };

          for (const approver of approvers) {
            await this.fcmService.sendToUser(approver, title, body, data);
          }
        }
      } else if (perm.status === PermissionStatus.APPROVED) {
        // Son addım və icazə təsdiqləndi
        const permissionTypeLabel = this.getPermissionTypeLabel(perm.type);
        const title = 'İcazə təsdiqləndi';
        const body = `${permissionTypeLabel} üçün icazə istəyiniz təsdiqləndi.`;

        const data: Record<string, string> = {
          permissionId: perm.id.toString(),
          type: perm.type,
          status: PermissionStatus.APPROVED,
        };

        await this.fcmService.sendToUser(perm.employee, title, body, data);
      }
    } catch (error) {
      this.logger.warn(
        `Error in notifyOnApprovedStep: ${error.message}`,
        error.stack,
      );
    }
  }

  async notifyOnRejected(
    permission: Permission,
    rejectComment?: string,
  ): Promise<void> {
    try {
      // Permission-i employee relation-ı ilə birlikdə fetch et
      const perm = await this.permRepo.findOne({
        where: { id: permission.id },
        relations: ['employee'],
      });

      if (!perm || !perm.employee) {
        this.logger.warn(
          `Permission ${permission.id} not found or missing employee relation`,
        );
        return;
      }

      const permissionTypeLabel = this.getPermissionTypeLabel(perm.type);
      const title = 'İcazə istəyi rədd edildi';

      let body = `İcazə istəyiniz rədd edildi.`;
      if (rejectComment && rejectComment.trim() !== '') {
        body = `İcazə rədd edildi. Səbəb: ${rejectComment}`;
      }

      const data: Record<string, string> = {
        permissionId: perm.id.toString(),
        type: perm.type,
        status: PermissionStatus.REJECTED,
      };

      if (rejectComment) {
        data.comment = rejectComment;
      }

      await this.fcmService.sendToUser(perm.employee, title, body, data);
    } catch (error) {
      this.logger.warn(
        `Error in notifyOnRejected: ${error.message}`,
        error.stack,
      );
    }
  }

  private async findApproversForRole(
    companyId: number,
    employee: User,
    role: UserRole,
  ): Promise<User[]> {
    // Employee-i department ilə birlikdə fetch et
    const fullEmployee = await this.usersRepo.findOne({
      where: { id: employee.id },
      relations: ['department', 'department.manager'],
    });

    if (!fullEmployee) {
      return [];
    }

    const approvers: User[] = [];

    switch (role) {
      case UserRole.MANAGER:
        if (fullEmployee.department?.manager) {
          approvers.push(fullEmployee.department.manager);
        }
        break;

      case UserRole.HEAD_OF_DEPARTMENT:
        const head = await this.helpersService.findHeadOfDepartmentForEmployee(
          fullEmployee.id,
        );
        if (head) {
          approvers.push(head);
        }
        break;

      case UserRole.HR:
        const hr = await this.helpersService.findAnyHr(companyId);
        if (hr) {
          approvers.push(hr);
        }
        break;

      case UserRole.HEAD_OF_HR:
        const headOfHr = await this.helpersService.findHeadOfHr(companyId);
        if (headOfHr) {
          approvers.push(headOfHr);
        }
        break;

      case UserRole.COMPANY_ADMIN:
        const admin = await this.helpersService.findAnyCompanyAdmin(companyId);
        if (admin) {
          approvers.push(admin);
        }
        break;

      default:
        this.logger.warn(`Unknown role for approver: ${role}`);
    }

    // FcmToken-i olan user-ləri qaytar
    return approvers.filter((u) => u.fcmToken && u.fcmToken.trim() !== '');
  }

  private getPermissionTypeLabel(type: PermissionType): string {
    const labels: Record<PermissionType, string> = {
      [PermissionType.ANNUAL_LEAVE]: 'İllik məzuniyyət',
      [PermissionType.SICK_LEAVE]: 'Xəstəlik məzuniyyəti',
      [PermissionType.UNPAID_LEAVE]: 'Ödənişsiz məzuniyyət',
      [PermissionType.SHORT_LEAVE]: 'Qısa icazə',
      [PermissionType.REMOTE_WORK]: 'Uzaqdan iş',
      [PermissionType.BUSINESS_TRIP]: 'İşgüzar səfər',
    };
    return labels[type] || type;
  }
}
