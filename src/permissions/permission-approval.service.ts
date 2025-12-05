import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { PermissionApproval } from './permission-approval.entity';
import { User } from '../users/user.entity';
import { ApprovePermissionDto } from './dto/approve-permission.dto';
import { RejectPermissionDto } from './dto/reject-permission.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { PermissionAuditAction } from '../common/enums/permission-audit-action.enum';
import { PermissionAuditResult } from '../common/enums/permission-audit-result.enum';
import { PermissionChainService } from './permission-chain.service';
import { PermissionAuditService } from './permission-audit.service';
import { PermissionQueryService } from './permission-query.service';
import { PermissionHelpersService } from './permission-helpers.service';

@Injectable()
export class PermissionApprovalService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    @InjectRepository(PermissionApproval)
    private readonly approvalRepo: Repository<PermissionApproval>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly chainService: PermissionChainService,
    private readonly auditService: PermissionAuditService,
    private readonly queryService: PermissionQueryService,
    private readonly helpersService: PermissionHelpersService,
  ) {}

  async approve(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: ApprovePermissionDto,
  ): Promise<Permission> {
    // 1) Rola görə ilkin check
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HEAD_OF_HR,
        UserRole.HR,
        UserRole.HEAD_OF_DEPARTMENT,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        actorId: currentUser.userId,
        reason: 'Bu rolda approve əməliyyatı üçün səlahiyyət yoxdur',
      });

      throw new ForbiddenException('İcazə təsdiqi üçün səlahiyyət yoxdur');
    }

    const perm = await this.queryService.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    // 2) Employee + departament + status
    const employee = await this.usersRepo.findOne({
      where: { id: perm.employee.id },
      relations: ['department', 'department.headOfDepartment'],
    });

    if (!employee) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'İcazə üçün istifadəçi tapılmadı',
      });

      throw new ForbiddenException('İcazə üçün istifadəçi tapılmadı');
    }

    if (employee.status !== UserStatus.ACTIVE) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'Deaktiv edilmiş istifadəçinin icazəsi üzərində əməliyyat cəhdi',
      });

      throw new ForbiddenException(
        'Deaktiv edilmiş istifadəçinin icazəsi üzərində əməliyyat aparıla bilməz',
      );
    }

    // ❌ Self-approve qadağası (heç kim öz icazəsini təsdiq edə bilməz)
    if (currentUser.userId === employee.id) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'İstifadəçi öz icazəsini approve etməyə çalışdı',
      });

      throw new ForbiddenException('Öz icazəni təsdiq edə bilməzsən');
    }

    // 3) MANAGER üçün: yalnız öz idarə etdiyi departamentdəki employee
    if (currentUser.role === UserRole.MANAGER) {
      const manager = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['managedDepartments'],
      });

      if (!manager) {
        await this.auditService.logPermissionAction({
          companyId: currentUser.companyId,
          permission: perm,
          actorId: currentUser.userId,
          action: PermissionAuditAction.APPROVE,
          result: PermissionAuditResult.FAILURE,
          previousStatus: perm.status,
          reason: 'Manager tapılmadı',
        });

        throw new ForbiddenException('Manager tapılmadı');
      }

      const managedDeptIds = (manager.managedDepartments || []).map(
        (d) => d.id,
      );
      const employeeDeptId = employee.department?.id;

      if (!employeeDeptId || !managedDeptIds.includes(employeeDeptId)) {
        await this.auditService.logPermissionAction({
          companyId: currentUser.companyId,
          permission: perm,
          actorId: currentUser.userId,
          action: PermissionAuditAction.APPROVE,
          result: PermissionAuditResult.FAILURE,
          previousStatus: perm.status,
          reason:
            'Manager başqa departamentə aid employee üçün approve etməyə çalışdı',
        });

        throw new ForbiddenException(
          'Bu icazə üçün bu istifadəçini təsdiq etməyə səlahiyyətin yoxdur (başqa departament).',
        );
      }
    }

    // 4) HEAD_OF_DEPARTMENT üçün: yalnız öz departamentinin işçiləri
    if (currentUser.role === UserRole.HEAD_OF_DEPARTMENT) {
      const head =
        await this.helpersService.findHeadOfDepartmentForEmployee(employee.id);

      if (!head || head.id !== currentUser.userId) {
        await this.auditService.logPermissionAction({
          companyId: currentUser.companyId,
          permission: perm,
          actorId: currentUser.userId,
          action: PermissionAuditAction.APPROVE,
          result: PermissionAuditResult.FAILURE,
          previousStatus: perm.status,
          reason:
            'HEAD_OF_DEPARTMENT başqa departamentə aid employee üçün approve etməyə çalışdı',
        });

        throw new ForbiddenException(
          'Bu icazə üçün bu istifadəçini təsdiq etməyə səlahiyyətin yoxdur (başqa departament və ya bu departamentin rəhbəri deyilsən).',
        );
      }
    }

    // 5) Artıq yekun vəziyyətdədirsə – block
    if (
      [PermissionStatus.APPROVED, PermissionStatus.REJECTED].includes(
        perm.status,
      )
    ) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason:
          'Artıq APPROVED/REJECTED vəziyyətində olan icazəni yenidən approve etmə cəhdi',
      });

      throw new ForbiddenException(
        'Bu icazə artıq yekun vəziyyətdədir (APPROVED/REJECTED).',
      );
    }

    // 6) Approver user
    const approver = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
    });
    if (!approver) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'Approver tapılmadı',
      });

      throw new ForbiddenException('Approver tapılmadı');
    }

    // 7) Approval chain + step check
    const chain = await this.chainService.getApprovalChainForPermission(
      currentUser.companyId,
      perm.employee,
      perm.type,
    );

    const history = await this.chainService.getApprovalHistory(perm.id);
    const nextStepIndex = history.length; // 0-based index
    const expectedRole = chain[nextStepIndex];

    if (!expectedRole) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'Artıq bütün approval zənciri tamamlanmış icazə üçün approve cəhdi',
      });

      throw new ForbiddenException(
        'Bu icazə artıq təsdiq zəncirini tamamlayıb.',
      );
    }

    if (currentUser.role !== expectedRole) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: `Approval chain-də gözlənilən rol: ${expectedRole}, amma actor rolu: ${currentUser.role}`,
      });

      throw new ForbiddenException(
        `Bu addım üçün gözlənilən rol: ${expectedRole}, səndə isə: ${currentUser.role}.`,
      );
    }

    // 8) Approval addımı DB-yə yaz
    const approval = this.approvalRepo.create({
      permission: perm,
      approver,
      role: currentUser.role,
      stepNumber: nextStepIndex + 1,
      status: PermissionStatus.APPROVED,
      comment: dto.comment,
    });
    await this.approvalRepo.save(approval);

    const isLastStep = nextStepIndex === chain.length - 1;
    const prevStatus = perm.status;

    if (isLastStep) {
      perm.status = PermissionStatus.APPROVED;
      perm.approvedBy = approver;
      perm.comment = dto.comment;
      perm.decidedAt = new Date();
    } else {
      perm.status = PermissionStatus.IN_PROGRESS;
      perm.comment = dto.comment ?? perm.comment;
    }

    const saved = await this.permRepo.save(perm);

    // 9) SUCCESS audit log
    await this.auditService.logPermissionAction({
      companyId: currentUser.companyId,
      permission: saved,
      actorId: currentUser.userId,
      action: PermissionAuditAction.APPROVE,
      result: PermissionAuditResult.SUCCESS,
      previousStatus: prevStatus,
      newStatus: saved.status,
      reason: dto.comment,
    });

    return saved;
  }

  async reject(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: RejectPermissionDto,
  ): Promise<Permission> {
    // 1) Rola görə ilkin check
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HEAD_OF_HR,
        UserRole.HR,
        UserRole.HEAD_OF_DEPARTMENT,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        actorId: currentUser.userId,
        reason: 'Bu rolda reject əməliyyatı üçün səlahiyyət yoxdur',
      });

      throw new ForbiddenException('İcazə rəddi üçün səlahiyyət yoxdur');
    }

    const perm = await this.queryService.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    // 2) Employee + departament + status
    const employee = await this.usersRepo.findOne({
      where: { id: perm.employee.id },
      relations: ['department', 'department.headOfDepartment'],
    });
    if (!employee) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'İcazə üçün istifadəçi tapılmadı',
      });

      throw new ForbiddenException('İcazə üçün istifadəçi tapılmadı');
    }

    if (employee.status !== UserStatus.ACTIVE) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason:
          'Deaktiv edilmiş istifadəçinin icazəsi üzərində əməliyyat cəhdi',
      });

      throw new ForbiddenException(
        'Deaktiv edilmiş istifadəçinin icazəsi üzərində əməliyyat aparıla bilməz',
      );
    }

    // ❌ Self-reject qadağası (heç kim öz icazəsini rədd edə bilməz)
    if (currentUser.userId === employee.id) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'İstifadəçi öz icazəsini reject etməyə çalışdı',
      });

      throw new ForbiddenException('Öz icazəni rədd edə bilməzsən');
    }

    // 3) Manager üçün: yalnız öz departamentindəki employee
    if (currentUser.role === UserRole.MANAGER) {
      const manager = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['managedDepartments'],
      });

      if (!manager) {
        await this.auditService.logPermissionAction({
          companyId: currentUser.companyId,
          permission: perm,
          actorId: currentUser.userId,
          action: PermissionAuditAction.REJECT,
          result: PermissionAuditResult.FAILURE,
          previousStatus: perm.status,
          reason: 'Manager tapılmadı',
        });

        throw new ForbiddenException('Manager tapılmadı');
      }

      const managedDeptIds = (manager.managedDepartments || []).map(
        (d) => d.id,
      );

      const employeeDeptId = employee.department?.id;

      if (!employeeDeptId || !managedDeptIds.includes(employeeDeptId)) {
        await this.auditService.logPermissionAction({
          companyId: currentUser.companyId,
          permission: perm,
          actorId: currentUser.userId,
          action: PermissionAuditAction.REJECT,
          result: PermissionAuditResult.FAILURE,
          previousStatus: perm.status,
          reason:
            'Manager başqa departamentə aid employee üçün reject etməyə çalışdı',
        });

        throw new ForbiddenException(
          'Bu icazə üçün bu istifadəçini rədd etməyə səlahiyyətin yoxdur (başqa departament).',
        );
      }
    }

    // 4) HEAD_OF_DEPARTMENT üçün: yalnız öz departamentinin işçiləri
    if (currentUser.role === UserRole.HEAD_OF_DEPARTMENT) {
      const head =
        await this.helpersService.findHeadOfDepartmentForEmployee(employee.id);

      if (!head || head.id !== currentUser.userId) {
        await this.auditService.logPermissionAction({
          companyId: currentUser.companyId,
          permission: perm,
          actorId: currentUser.userId,
          action: PermissionAuditAction.REJECT,
          result: PermissionAuditResult.FAILURE,
          previousStatus: perm.status,
          reason:
            'HEAD_OF_DEPARTMENT başqa departamentə aid employee üçün reject etməyə çalışdı',
        });

        throw new ForbiddenException(
          'Bu icazə üçün bu istifadəçini rədd etməyə səlahiyyətin yoxdur (başqa departament və ya bu departamentin rəhbəri deyilsən).',
        );
      }
    }

    // 5) Artıq yekun vəziyyətdədirsə – block
    if (
      [PermissionStatus.APPROVED, PermissionStatus.REJECTED].includes(
        perm.status,
      )
    ) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason:
          'Artıq APPROVED/REJECTED vəziyyətində olan icazəni yenidən reject etmə cəhdi',
      });

      throw new ForbiddenException(
        'Bu icazə artıq yekun vəziyyətdədir (APPROVED/REJECTED).',
      );
    }

    // 6) Approver user
    const approver = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
    });
    if (!approver) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: 'Approver tapılmadı',
      });

      throw new ForbiddenException('Approver tapılmadı');
    }

    // 7) Approval chain + step check
    const chain = await this.chainService.getApprovalChainForPermission(
      currentUser.companyId,
      perm.employee,
      perm.type,
    );
    const history = await this.chainService.getApprovalHistory(perm.id);
    const nextStepIndex = history.length;
    const expectedRole = chain[nextStepIndex];

    if (!expectedRole || currentUser.role !== expectedRole) {
      await this.auditService.logPermissionAction({
        companyId: currentUser.companyId,
        permission: perm,
        actorId: currentUser.userId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        previousStatus: perm.status,
        reason: `Approval chain-də gözlənilən rol: ${expectedRole}, actor rolu: ${currentUser.role}`,
      });

      throw new ForbiddenException(
        `Bu addım üçün gözlənilən rol: ${expectedRole}, səndə isə: ${currentUser.role}.`,
      );
    }

    // 8) Approval addımı (REJECT) yaz
    const approval = this.approvalRepo.create({
      permission: perm,
      approver,
      role: currentUser.role,
      stepNumber: nextStepIndex + 1,
      status: PermissionStatus.REJECTED,
      comment: dto.comment,
    });
    await this.approvalRepo.save(approval);

    const prevStatus = perm.status;

    perm.status = PermissionStatus.REJECTED;
    perm.approvedBy = approver;
    perm.comment = dto.comment;
    perm.decidedAt = new Date();

    const saved = await this.permRepo.save(perm);

    // 9) SUCCESS audit log
    await this.auditService.logPermissionAction({
      companyId: currentUser.companyId,
      permission: saved,
      actorId: currentUser.userId,
      action: PermissionAuditAction.REJECT,
      result: PermissionAuditResult.SUCCESS,
      previousStatus: prevStatus,
      newStatus: saved.status,
      reason: dto.comment,
    });

    return saved;
  }
}

