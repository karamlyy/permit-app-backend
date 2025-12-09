import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { ApprovePermissionDto } from './dto/approve-permission.dto';
import { RejectPermissionDto } from './dto/reject-permission.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { LeaveBalanceDto } from './dto/leave-balance.dto';
import { PermissionAuditDto } from './dto/permission-audit.dto';
import { PermissionDetailsDto } from './dto/permission-details.dto';
import { PermissionQueryService } from './permission-query.service';
import { PermissionApprovalService } from './permission-approval.service';
import { PermissionPolicyService } from './permission-policy.service';
import { PermissionBalanceService } from './permission-balance.service';
import { PermissionAuditService } from './permission-audit.service';
import { PermissionsNotificationService } from './permissions-notification.service';
import { PermissionListItemDto } from './dto/permission-list-item.dto';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly queryService: PermissionQueryService,
    private readonly approvalService: PermissionApprovalService,
    private readonly policyService: PermissionPolicyService,
    private readonly balanceService: PermissionBalanceService,
    private readonly auditService: PermissionAuditService,
    private readonly notificationService: PermissionsNotificationService,
  ) {}

  // EMPLOYEE: özün üçün icazə yarat
  async createForEmployee(
    currentUser: { userId: number; companyId: number },
    dto: CreatePermissionDto,
  ): Promise<Permission> {
    const company = await this.companyRepo.findOne({
      where: { id: currentUser.companyId },
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    const employee = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
      relations: ['company', 'department'],
    });
    if (!employee || employee.company.id !== currentUser.companyId) {
      throw new ForbiddenException('İstifadəçi bu şirkətə aid deyil');
    }

    if (employee.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(
        'Deaktiv istifadəçi üçün icazə yaradıla bilməz',
      );
    }

    // ⭐ Policy check – company + employee birgə nəzərə alınır
    await this.policyService.validatePolicyForNewPermission(
      company,
      employee,
      dto,
    );

    const perm = this.permRepo.create({
      company,
      employee,
      type: dto.type,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      startTime: dto.startTime,
      endTime: dto.endTime,
      reason: dto.reason,
      status: PermissionStatus.PENDING,
    });

    const saved = await this.permRepo.save(perm);

    // Notification göndər (async, error-lar log olunur)
    this.notificationService
      .notifyOnPermissionCreated(saved)
      .catch((error) => {
        // Error-lar notification service-də log olunur, burada sadəcə catch edirik
      });

    return saved;
  }

  // EMPLOYEE: öz icazələrini gör
  async findMyPermissions(currentUser: {
    userId: number;
  }): Promise<Permission[]> {
    return this.queryService.findMyPermissions(currentUser);
  }

  // APPROVER: şirkətin icazələrini gör
  async findCompanyPermissionsForApprover(
    currentUser: { userId: number; companyId: number; role: UserRole },
  ): Promise<Permission[]> {
    return this.queryService.findCompanyPermissionsForApprover(currentUser);
  }

  // APPROVE
  async approve(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: ApprovePermissionDto,
  ): Promise<Permission> {
    return this.approvalService.approve(currentUser, permissionId, dto);
  }

  // REJECT
  async reject(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: RejectPermissionDto,
  ): Promise<Permission> {
    return this.approvalService.reject(currentUser, permissionId, dto);
  }

  async getMyLeaveBalance(currentUser: {
    userId: number;
    companyId: number;
  }): Promise<LeaveBalanceDto> {
    const company = await this.companyRepo.findOne({
      where: { id: currentUser.companyId },
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    const employee = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
      relations: ['company'],
    });
    if (!employee || employee.company.id !== currentUser.companyId) {
      throw new ForbiddenException('İstifadəçi bu şirkətə aid deyil');
    }

    if (employee.status !== UserStatus.ACTIVE) {
      // İstəsən burada Forbidden yerine da 200 qaytarıb 0 balans da göstərə bilərsən.
      throw new ForbiddenException(
        'Deaktiv istifadəçi üçün məzuniyyət balansı göstərilə bilməz',
      );
    }

    return this.balanceService.calculateLeaveBalance(company, employee);
  }

  async getUserLeaveBalanceForAdmin(
    currentUser: { userId: number; companyId: number; role: UserRole },
    targetUserId: number,
  ): Promise<LeaveBalanceDto> {
    const company = await this.companyRepo.findOne({
      where: { id: currentUser.companyId },
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    const targetUser = await this.usersRepo.findOne({
      where: { id: targetUserId },
      relations: ['company', 'department'],
    });
    if (!targetUser || targetUser.company.id !== currentUser.companyId) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    if (targetUser.status !== UserStatus.ACTIVE) {
      // İstəsən burda 0 balans da qaytara bilərsən, indi sərt saxlayırıq
      throw new ForbiddenException(
        'Deaktiv istifadəçi üçün məzuniyyət balansı göstərilə bilməz',
      );
    }

    // 1) Bütün şirkəti görə bilən rollar:
    // COMPANY_ADMIN, HR, HEAD_OF_HR
    if (
      currentUser.role === UserRole.COMPANY_ADMIN ||
      currentUser.role === UserRole.HR ||
      currentUser.role === UserRole.HEAD_OF_HR
    ) {
      return this.balanceService.calculateLeaveBalance(company, targetUser);
    }

    // 2) HEAD_OF_DEPARTMENT → yalnız öz headedDepartments-dəki işçilər
    if (currentUser.role === UserRole.HEAD_OF_DEPARTMENT) {
      const head = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['headedDepartments'],
      });

      if (!head) {
        throw new ForbiddenException('Head of Department tapılmadı');
      }

      const headedDeptIds = (head.headedDepartments || []).map((d) => d.id);

      if (
        !targetUser.department ||
        !headedDeptIds.includes(targetUser.department.id)
      ) {
        throw new ForbiddenException(
          'Bu istifadəçi üçün məzuniyyət balansına baxmağa səlahiyyətin yoxdur (başqa departament).',
        );
      }

      return this.balanceService.calculateLeaveBalance(company, targetUser);
    }

    // 3) MANAGER → yalnız öz managedDepartments-dəki işçilər
    if (currentUser.role === UserRole.MANAGER) {
      const manager = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['managedDepartments'],
      });

      if (!manager) {
        throw new ForbiddenException('Manager tapılmadı');
      }

      const managedDeptIds = (manager.managedDepartments || []).map(
        (d) => d.id,
      );

      if (
        !targetUser.department ||
        !managedDeptIds.includes(targetUser.department.id)
      ) {
        throw new ForbiddenException(
          'Bu istifadəçi üçün məzuniyyət balansına baxmağa səlahiyyətin yoxdur (başqa departament).',
        );
      }

      return this.balanceService.calculateLeaveBalance(company, targetUser);
    }

    // 4) Qalan bütün rollar üçün qadağandır
    throw new ForbiddenException('Bu əməliyyat üçün səlahiyyətiniz yoxdur');
  }

  async getPermissionAuditLog(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
  ): Promise<PermissionAuditDto[]> {
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HEAD_OF_HR,
        UserRole.HR,
      ].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'Audit logları görmək üçün səlahiyyət yoxdur',
      );
    }

    await this.queryService.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    return this.auditService.getPermissionAuditLog(
      currentUser.companyId,
      permissionId,
    );
  }

  async getPermissionDetails(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
  ): Promise<PermissionDetailsDto> {
    return this.queryService.getPermissionDetails(currentUser, permissionId);
  }

  async getMyApprovalQueue(currentUser: {
    userId: number;
    companyId: number;
    role: UserRole;
  }): Promise<PermissionListItemDto[]> {
    return this.queryService.getMyApprovalQueue(currentUser);
  }
}
