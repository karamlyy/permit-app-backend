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
import { Department } from '../departments/department.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { ApprovePermissionDto } from './dto/approve-permission.dto';
import { RejectPermissionDto } from './dto/reject-permission.dto';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { PermissionType } from 'src/common/enums/permission-type.enum';
import { PermissionApproval } from './permission-approval.entity';
import { UserStatus } from 'src/common/enums/user-status.enum';
import { LeaveBalanceDto } from './dto/leave-balance.dto';
import { PermissionAudit } from './permission-audit.entity';
import { PermissionAuditAction } from '../common/enums/permission-audit-action.enum';
import { PermissionAuditResult } from '../common/enums/permission-audit-result.enum';
import { PermissionAuditActorDto, PermissionAuditDto } from './dto/permission-audit.dto';
import { PermissionApprovalStepDto, PermissionChainStepDto, PermissionDetailsDto, PermissionEmployeeDto } from './dto/permission-details.dto';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    @InjectRepository(PermissionApproval)
    private readonly approvalRepo: Repository<PermissionApproval>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    @InjectRepository(PermissionAudit)
    private readonly auditRepo: Repository<PermissionAudit>,
  ) { }

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
      relations: ['company'],
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
    await this.validatePolicyForNewPermission(company, employee, dto);

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

    return this.permRepo.save(perm);
  }

  // EMPLOYEE: öz icazələrini gör
  async findMyPermissions(currentUser: {
    userId: number;
  }): Promise<Permission[]> {
    return this.permRepo.find({
      where: { employee: { id: currentUser.userId } },
      relations: ['employee', 'approvedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  // APPROVER: şirkətin icazələrini gör
  async findCompanyPermissionsForApprover(
    currentUser: { userId: number; companyId: number; role: UserRole },
  ): Promise<Permission[]> {
    // 1) Bütün şirkəti görə bilən rollar: COMPANY_ADMIN, HR, HEAD_OF_HR
    if (
      currentUser.role === UserRole.COMPANY_ADMIN ||
      currentUser.role === UserRole.HR ||
      currentUser.role === UserRole.HEAD_OF_HR
    ) {
      return this.permRepo.find({
        where: { company: { id: currentUser.companyId } },
        relations: ['employee', 'approvedBy'],
        order: { createdAt: 'DESC' },
      });
    }

    // 2) HEAD_OF_DEPARTMENT → yalnız öz departamentindəki işçilər
    if (currentUser.role === UserRole.HEAD_OF_DEPARTMENT) {
      const head = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['headedDepartments'],
      });

      if (!head) {
        throw new ForbiddenException('Head of Department tapılmadı');
      }

      const headedDeptIds = (head.headedDepartments || []).map((d) => d.id);

      if (headedDeptIds.length === 0) {
        // hec bir departamentə head təyin olunmayıbsa, görəcəyi icazə yoxdur
        return [];
      }

      return this.permRepo
        .createQueryBuilder('perm')
        .leftJoinAndSelect('perm.employee', 'employee')
        .leftJoinAndSelect('perm.approvedBy', 'approvedBy')
        .leftJoin('employee.department', 'department')
        .leftJoin('perm.company', 'company')
        .where('company.id = :companyId', {
          companyId: currentUser.companyId,
        })
        .andWhere('department.id IN (:...deptIds)', {
          deptIds: headedDeptIds,
        })
        .orderBy('perm.createdAt', 'DESC')
        .getMany();
    }

    // 3) MANAGER → yalnız öz idarə etdiyi departamentlər
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

      if (managedDeptIds.length === 0) {
        return [];
      }

      return this.permRepo
        .createQueryBuilder('perm')
        .leftJoinAndSelect('perm.employee', 'employee')
        .leftJoinAndSelect('perm.approvedBy', 'approvedBy')
        .leftJoin('employee.department', 'department')
        .leftJoin('perm.company', 'company')
        .where('company.id = :companyId', {
          companyId: currentUser.companyId,
        })
        .andWhere('department.id IN (:...deptIds)', {
          deptIds: managedDeptIds,
        })
        .orderBy('perm.createdAt', 'DESC')
        .getMany();
    }

    // 4) Qalan bütün rollar üçün qadağandır
    throw new ForbiddenException('Bu əməliyyat üçün icazən yoxdur');
  }

  private async findOneInCompanyOrThrow(
    companyId: number,
    permissionId: number,
  ): Promise<Permission> {
    const perm = await this.permRepo.findOne({
      where: { id: permissionId },
      relations: ['company', 'employee', 'approvedBy'],
    });

    if (!perm || perm.company.id !== companyId) {
      throw new NotFoundException('İcazə tapılmadı');
    }

    return perm;
  }

  // APPROVE
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
      await this.logPermissionAction({
        companyId: currentUser.companyId,
        action: PermissionAuditAction.APPROVE,
        result: PermissionAuditResult.FAILURE,
        actorId: currentUser.userId,
        reason: 'Bu rolda approve əməliyyatı üçün səlahiyyət yoxdur',
      });

      throw new ForbiddenException('İcazə təsdiqi üçün səlahiyyət yoxdur');
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    // 2) Employee + departament + status
    const employee = await this.usersRepo.findOne({
      where: { id: perm.employee.id },
      relations: ['department', 'department.headOfDepartment'],
    });

    if (!employee) {
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
        await this.logPermissionAction({
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
        await this.logPermissionAction({
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
      const head = await this.findHeadOfDepartmentForEmployee(employee.id);

      if (!head || head.id !== currentUser.userId) {
        await this.logPermissionAction({
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
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
    const chain = await this.getApprovalChainForPermission(
      currentUser.companyId,
      perm.employee,
      perm.type,
    );

    const history = await this.getApprovalHistory(perm.id);
    const nextStepIndex = history.length; // 0-based index
    const expectedRole = chain[nextStepIndex];

    if (!expectedRole) {
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
    await this.logPermissionAction({
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

  // REJECT
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
      await this.logPermissionAction({
        companyId: currentUser.companyId,
        action: PermissionAuditAction.REJECT,
        result: PermissionAuditResult.FAILURE,
        actorId: currentUser.userId,
        reason: 'Bu rolda reject əməliyyatı üçün səlahiyyət yoxdur',
      });

      throw new ForbiddenException('İcazə rəddi üçün səlahiyyət yoxdur');
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    // 2) Employee + departament + status
    const employee = await this.usersRepo.findOne({
      where: { id: perm.employee.id },
      relations: ['department', 'department.headOfDepartment'],
    });
    if (!employee) {
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
        await this.logPermissionAction({
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
        await this.logPermissionAction({
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
      const head = await this.findHeadOfDepartmentForEmployee(employee.id);

      if (!head || head.id !== currentUser.userId) {
        await this.logPermissionAction({
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
      await this.logPermissionAction({
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
      await this.logPermissionAction({
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
    const chain = await this.getApprovalChainForPermission(
      currentUser.companyId,
      perm.employee,
      perm.type,
    );
    const history = await this.getApprovalHistory(perm.id);
    const nextStepIndex = history.length;
    const expectedRole = chain[nextStepIndex];

    if (!expectedRole || currentUser.role !== expectedRole) {
      await this.logPermissionAction({
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
    await this.logPermissionAction({
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

  // Helper: iki tarix arasındakı gün sayı (ən azı 1)
  private countDays(start: Date, end?: Date): number {
    const s = new Date(start);
    const e = new Date(end ?? start);
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    const diffMs = e.getTime() - s.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  }

  // Overlap check
  private async ensureNoOverlap(
    companyId: number,
    employeeId: number,
    startDate: Date,
    endDate: Date | undefined,
  ): Promise<void> {
    const qb = this.permRepo
      .createQueryBuilder('perm')
      .leftJoin('perm.employee', 'employee')
      .leftJoin('perm.company', 'company')
      .where('company.id = :companyId', { companyId })
      .andWhere('employee.id = :employeeId', { employeeId })
      .andWhere('perm.status IN (:...statuses)', {
        statuses: [
          PermissionStatus.PENDING,
          PermissionStatus.IN_PROGRESS,
          PermissionStatus.APPROVED,
        ],
      })
      // tarix interval overlap: (start <= existingEnd) AND (end >= existingStart)
      .andWhere(
        '(perm.startDate <= :endDate) AND ( (perm.endDate IS NULL AND perm.startDate >= :startDate) OR (perm.endDate IS NOT NULL AND perm.endDate >= :startDate) )',
        {
          startDate,
          endDate: endDate ?? startDate,
        },
      );

    const existing = await qb.getOne();
    if (existing) {
      throw new ForbiddenException(
        'Bu tarix intervalında artıq başqa icazən var (overlap).',
      );
    }
  }

  // Annual leave limit (employee + company policy)
  private async ensureAnnualLeaveLimit(
    company: Company,
    employeeId: number,
    startDate: Date,
    endDate: Date | undefined,
    limitDays: number,
  ): Promise<void> {
    const year = startDate.getFullYear();
    const from = new Date(year, 0, 1);
    const to = new Date(year, 11, 31);

    const existing = await this.permRepo
      .createQueryBuilder('perm')
      .leftJoin('perm.employee', 'employee')
      .leftJoin('perm.company', 'company')
      .where('company.id = :companyId', { companyId: company.id })
      .andWhere('employee.id = :employeeId', { employeeId })
      .andWhere('perm.type = :type', {
        type: PermissionType.ANNUAL_LEAVE,
      })
      .andWhere('perm.status = :status', {
        status: PermissionStatus.APPROVED,
      })
      .andWhere('perm.startDate BETWEEN :from AND :to', { from, to })
      .getMany();

    const usedDays = existing.reduce(
      (acc, p) => acc + this.countDays(p.startDate, p.endDate),
      0,
    );

    const requestedDays = this.countDays(startDate, endDate);
    const total = usedDays + requestedDays;

    if (total > limitDays) {
      throw new ForbiddenException(
        `İllik məzuniyyət limitini aşır: istifadə olunmuş ${usedDays} gün, istəyən ${requestedDays} gün, limit ${limitDays} gün.`,
      );
    }
  }

  // Remote limit (employee + company policy)
  private async ensureRemoteLimit(
    company: Company,
    employeeId: number,
    startDate: Date,
    endDate: Date | undefined,
    limitDays: number,
  ): Promise<void> {
    const year = startDate.getFullYear();
    const month = startDate.getMonth(); // 0-based

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    const existing = await this.permRepo
      .createQueryBuilder('perm')
      .leftJoin('perm.employee', 'employee')
      .leftJoin('perm.company', 'company')
      .where('company.id = :companyId', { companyId: company.id })
      .andWhere('employee.id = :employeeId', { employeeId })
      .andWhere('perm.type = :type', {
        type: PermissionType.REMOTE_WORK,
      })
      .andWhere('perm.status IN (:...statuses)', {
        statuses: [PermissionStatus.PENDING, PermissionStatus.APPROVED],
      })
      .andWhere('perm.startDate BETWEEN :from AND :to', {
        from: monthStart,
        to: monthEnd,
      })
      .getMany();

    const usedDays = existing.reduce(
      (acc, p) => acc + this.countDays(p.startDate, p.endDate),
      0,
    );

    const requestedDays = this.countDays(startDate, endDate);
    const total = usedDays + requestedDays;

    if (total > limitDays) {
      throw new ForbiddenException(
        `Bu ay üçün remote limiti aşılır: istifadə olunmuş ${usedDays} gün, istəyən ${requestedDays} gün, limit ${limitDays} gün.`,
      );
    }
  }

  // Short leave limit (saatla) – employee + company policy
  private async ensureShortLeaveLimit(
    company: Company,
    employeeId: number,
    startDate: Date,
    startTime: string | undefined,
    endTime: string | undefined,
    limitHours: number,
  ): Promise<void> {
    if (!startTime || !endTime) {
      return;
    }

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);

    const startHours = sh + (sm || 0) / 60;
    const endHours = eh + (em || 0) / 60;
    const requestedHours = endHours - startHours;

    if (requestedHours <= 0) {
      throw new ForbiddenException(
        'Short leave üçün saat intervalı yanlışdır.',
      );
    }

    const year = startDate.getFullYear();
    const month = startDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    const existing = await this.permRepo
      .createQueryBuilder('perm')
      .leftJoin('perm.employee', 'employee')
      .leftJoin('perm.company', 'company')
      .where('company.id = :companyId', { companyId: company.id })
      .andWhere('employee.id = :employeeId', { employeeId })
      .andWhere('perm.type = :type', {
        type: PermissionType.SHORT_LEAVE,
      })
      .andWhere('perm.status IN (:...statuses)', {
        statuses: [PermissionStatus.PENDING, PermissionStatus.APPROVED],
      })
      .andWhere('perm.startDate BETWEEN :from AND :to', {
        from: monthStart,
        to: monthEnd,
      })
      .getMany();

    let usedHours = 0;

    for (const p of existing) {
      if (!p.startTime || !p.endTime) continue;

      const [esh, esm] = p.startTime.split(':').map(Number);
      const [eeh, eem] = p.endTime.split(':').map(Number);

      const eStartHours = esh + (esm || 0) / 60;
      const eEndHours = eeh + (eem || 0) / 60;
      const hours = Math.max(0, eEndHours - eStartHours);

      usedHours += hours;
    }

    const total = usedHours + requestedHours;
    if (total > limitHours) {
      throw new ForbiddenException(
        `Short leave aylıq saat limiti aşılır: ${total.toFixed(
          1,
        )} saat, limit ${limitHours} saat.`,
      );
    }
  }

  private async validatePolicyForNewPermission(
    company: Company,
    employee: User,
    dto: CreatePermissionDto,
  ): Promise<void> {
    const policy = this.getEffectivePolicy(company, employee);

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;

    if (!policy.allowOverlap) {
      await this.ensureNoOverlap(company.id, employee.id, startDate, endDate);
    }

    if (dto.type === PermissionType.ANNUAL_LEAVE) {
      await this.ensureAnnualLeaveLimit(
        company,
        employee.id,
        startDate,
        endDate,
        policy.annualLeaveDaysPerYear,
      );
    }

    if (dto.type === PermissionType.REMOTE_WORK) {
      if (!policy.hasRemoteWork) {
        throw new ForbiddenException(
          'Bu işçi üçün remote work icazəsinə icazə verilmir',
        );
      }

      await this.ensureRemoteLimit(
        company,
        employee.id,
        startDate,
        endDate,
        policy.maxRemoteDaysPerMonth,
      );
    }

    if (dto.type === PermissionType.SHORT_LEAVE) {
      await this.ensureShortLeaveLimit(
        company,
        employee.id,
        startDate,
        dto.startTime,
        dto.endTime,
        policy.maxShortLeaveHoursPerMonth,
      );
    }
  }

  // Sadə approval chain generator (yeni rollarla)
  // EMPLOYEE / MANAGER / HEAD_OF_DEPARTMENT / HR / HEAD_OF_HR üçün fərqli chain qaytarır
  private async getApprovalChainForPermission(
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
        const head = await this.findHeadOfDepartmentForEmployee(fullEmployee.id);
        if (head) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.HR) {
        const hr = await this.findAnyHr(companyId);
        if (hr) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.HEAD_OF_HR) {
        const headOfHr = await this.findHeadOfHr(companyId);
        if (headOfHr) {
          result.push(role);
        }
        continue;
      }

      if (role === UserRole.COMPANY_ADMIN) {
        const admin = await this.findAnyCompanyAdmin(companyId);
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

  private async getApprovalHistory(
    permissionId: number,
  ): Promise<PermissionApproval[]> {
    return this.approvalRepo.find({
      where: { permission: { id: permissionId } },
      order: { stepNumber: 'ASC' },
      relations: ['approver'],
    });
  }

  private getEffectivePolicy(company: Company, employee: User) {
    const annualLeaveDaysPerYear =
      employee.customAnnualLeaveDaysPerYear ??
      company.annualLeaveDaysPerYear;

    const hasRemoteWork =
      employee.customHasRemoteWork ?? company.hasRemoteWork;

    const maxRemoteDaysPerMonth =
      employee.customMaxRemoteDaysPerMonth ??
      company.maxRemoteDaysPerMonth;

    const maxShortLeaveHoursPerMonth =
      employee.customMaxShortLeaveHoursPerMonth ??
      company.maxShortLeaveHoursPerMonth;

    const allowOverlap = company.allowOverlap;

    return {
      annualLeaveDaysPerYear,
      hasRemoteWork,
      maxRemoteDaysPerMonth,
      maxShortLeaveHoursPerMonth,
      allowOverlap,
    };
  }



  private async calculateLeaveBalance(
    company: Company,
    employee: User,
    year?: number,
  ): Promise<LeaveBalanceDto> {
    const policy = this.getEffectivePolicy(company, employee);
    const targetYear = year ?? new Date().getFullYear();

    const from = new Date(targetYear, 0, 1);
    const to = new Date(targetYear, 11, 31);

    // ─────────────────────────────────────────────
    // 1) İllik məzuniyyət günləri (APPROVED)
    // ─────────────────────────────────────────────
    const approved = await this.permRepo
      .createQueryBuilder('perm')
      .leftJoin('perm.employee', 'employee')
      .leftJoin('perm.company', 'company')
      .where('company.id = :companyId', { companyId: company.id })
      .andWhere('employee.id = :employeeId', { employeeId: employee.id })
      .andWhere('perm.type = :type', {
        type: PermissionType.ANNUAL_LEAVE,
      })
      .andWhere('perm.status = :status', {
        status: PermissionStatus.APPROVED,
      })
      .andWhere('perm.startDate BETWEEN :from AND :to', { from, to })
      .getMany();

    const usedDays = approved.reduce(
      (acc, p) => acc + this.countDays(p.startDate, p.endDate),
      0,
    );

    // ─────────────────────────────────────────────
    // 2) Pending / InProgress illik məzuniyyət günləri
    // ─────────────────────────────────────────────
    const pending = await this.permRepo
      .createQueryBuilder('perm')
      .leftJoin('perm.employee', 'employee')
      .leftJoin('perm.company', 'company')
      .where('company.id = :companyId', { companyId: company.id })
      .andWhere('employee.id = :employeeId', { employeeId: employee.id })
      .andWhere('perm.type = :type', {
        type: PermissionType.ANNUAL_LEAVE,
      })
      .andWhere('perm.status IN (:...statuses)', {
        statuses: [PermissionStatus.PENDING, PermissionStatus.IN_PROGRESS],
      })
      .andWhere('perm.startDate BETWEEN :from AND :to', { from, to })
      .getMany();

    const pendingDays = pending.reduce(
      (acc, p) => acc + this.countDays(p.startDate, p.endDate),
      0,
    );

    const entitlementDays = policy.annualLeaveDaysPerYear;
    const remainingDays = Math.max(entitlementDays - usedDays - pendingDays, 0);

    const dto = new LeaveBalanceDto();
    dto.year = targetYear;
    dto.entitlementDays = entitlementDays;
    dto.usedDays = usedDays;
    dto.pendingDays = pendingDays;
    dto.remainingDays = remainingDays;

    // ─────────────────────────────────────────────
    // 3) Short leave aylıq saat balansı
    // ─────────────────────────────────────────────
    // Əgər şirkətdə short leave limiti konfiqurasiya olunmayıbsa, saatları boş buraxırıq
    if (policy.maxShortLeaveHoursPerMonth != null) {
      const now = new Date();
      const monthYear = now.getFullYear();
      const month = now.getMonth(); // 0-based

      const monthStart = new Date(monthYear, month, 1);
      const monthEnd = new Date(monthYear, month + 1, 0);

      const shortLeaves = await this.permRepo
        .createQueryBuilder('perm')
        .leftJoin('perm.employee', 'employee')
        .leftJoin('perm.company', 'company')
        .where('company.id = :companyId', { companyId: company.id })
        .andWhere('employee.id = :employeeId', { employeeId: employee.id })
        .andWhere('perm.type = :type', {
          type: PermissionType.SHORT_LEAVE,
        })
        .andWhere('perm.status IN (:...statuses)', {
          statuses: [
            PermissionStatus.PENDING,
            PermissionStatus.IN_PROGRESS,
            PermissionStatus.APPROVED,
          ],
        })
        .andWhere('perm.startDate BETWEEN :from AND :to', {
          from: monthStart,
          to: monthEnd,
        })
        .getMany();

      let usedShort = 0;
      let pendingShort = 0;

      for (const p of shortLeaves) {
        if (!p.startTime || !p.endTime) continue;

        const [sh, sm] = p.startTime.split(':').map(Number);
        const [eh, em] = p.endTime.split(':').map(Number);

        const startHours = sh + (sm || 0) / 60;
        const endHours = eh + (em || 0) / 60;
        const hours = Math.max(0, endHours - startHours);

        if (p.status === PermissionStatus.APPROVED) {
          usedShort += hours;
        } else {
          // PENDING və IN_PROGRESS-i pending kimi hesab edirik
          pendingShort += hours;
        }
      }

      dto.usedShortLeaveHoursThisMonth = Number(usedShort.toFixed(1));
      const remainingShort =
        policy.maxShortLeaveHoursPerMonth - usedShort - pendingShort;
      dto.remainingShortLeaveHoursThisMonth = Number(
        Math.max(0, remainingShort).toFixed(1),
      );
    }

    return dto;
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

    return this.calculateLeaveBalance(company, employee);
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
      return this.calculateLeaveBalance(company, targetUser);
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

      return this.calculateLeaveBalance(company, targetUser);
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

      return this.calculateLeaveBalance(company, targetUser);
    }

    // 4) Qalan bütün rollar üçün qadağandır
    throw new ForbiddenException('Bu əməliyyat üçün səlahiyyətiniz yoxdur');
  }


  private async logPermissionAction(options: {
    companyId: number;
    permission?: Permission;
    actorId?: number;
    action: PermissionAuditAction;
    result: PermissionAuditResult;
    previousStatus?: PermissionStatus;
    newStatus?: PermissionStatus;
    reason?: string;
  }): Promise<void> {
    const company = await this.companyRepo.findOne({
      where: { id: options.companyId },
    });
    if (!company) return;

    const actor = options.actorId
      ? (await this.usersRepo.findOne({ where: { id: options.actorId } })) ??
      undefined
      : undefined;

    const audit = this.auditRepo.create({
      company,
      permission: options.permission,
      actor,
      action: options.action,
      result: options.result,
      previousStatus: options.previousStatus,
      newStatus: options.newStatus,
      reason: options.reason,
    } as any);

    await this.auditRepo.save(audit);
  }

  async getPermissionAuditLog(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
  ): Promise<PermissionAuditDto[]> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'Audit logları görmək üçün səlahiyyət yoxdur',
      );
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    const audits = await this.auditRepo.find({
      where: {
        company: { id: currentUser.companyId },
        permission: { id: perm.id },
      },
      relations: ['actor'],
      order: { createdAt: 'ASC' },
    });

    return audits.map((a) => {
      const dto = new PermissionAuditDto();
      dto.id = a.id;
      dto.action = a.action;
      dto.result = a.result;
      dto.previousStatus = a.previousStatus;
      dto.newStatus = a.newStatus;
      dto.reason = a.reason;
      dto.createdAt = a.createdAt;

      if (a.actor) {
        const actorDto = new PermissionAuditActorDto();
        actorDto.id = a.actor.id;
        actorDto.name = a.actor.name;
        actorDto.email = a.actor.email;
        actorDto.role = a.actor.role;
        dto.actor = actorDto;
      } else {
        dto.actor = null;
      }

      return dto;
    });
  }


  async getPermissionDetails(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
  ): Promise<PermissionDetailsDto> {
    // 1) İcazəni şirkət scope-u ilə tap
    const perm = await this.permRepo.findOne({
      where: { id: permissionId },
      relations: ['company', 'employee', 'employee.department', 'approvedBy'],
    });

    if (!perm || perm.company.id !== currentUser.companyId) {
      throw new NotFoundException('İcazə tapılmadı');
    }

    // 2) Access control:
    const isOwner = perm.employee.id === currentUser.userId;

    const approverRoles: UserRole[] = [
      UserRole.COMPANY_ADMIN,
      UserRole.HR,
      UserRole.HEAD_OF_HR,
      UserRole.MANAGER,
      UserRole.HEAD_OF_DEPARTMENT,
    ];

    const isApproverRole = approverRoles.includes(currentUser.role);

    if (!isOwner && !isApproverRole) {
      throw new ForbiddenException(
        'Bu icazənin detallarını görməyə səlahiyyətin yoxdur',
      );
    }

    // Manager / Head_of_Department üçün departament scope check
    if (isApproverRole && (currentUser.role === UserRole.MANAGER || currentUser.role === UserRole.HEAD_OF_DEPARTMENT)) {
      const viewer = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['managedDepartments', 'headedDepartments'],
      });

      if (!viewer) {
        throw new ForbiddenException('İstifadəçi tapılmadı');
      }

      const managedDeptIds =
        (viewer.managedDepartments || []).map((d) => d.id);

      const headedDeptIds =
        (viewer.headedDepartments || []).map((d) => d.id);

      const allowedDeptIds = [...managedDeptIds, ...headedDeptIds];

      const employeeDeptId = perm.employee.department?.id;

      if (!employeeDeptId || !allowedDeptIds.includes(employeeDeptId)) {
        throw new ForbiddenException(
          'Bu icazə üzrə bu istifadəçi üçün detala baxmağa səlahiyyətin yoxdur (başqa departament).',
        );
      }
    }

    // 3) Chain + history
    const chainRoles = await this.getApprovalChainForPermission(
      perm.company.id,
      perm.employee,
      perm.type,
    );

    const history = await this.getApprovalHistory(perm.id); // PermissionApproval[] ASC

    const approvals: PermissionApprovalStepDto[] = history.map((h) => ({
      stepNumber: h.stepNumber,
      role: h.role,
      status: h.status,
      approverName: h.approver?.name,
      approverEmail: h.approver?.email,
      comment: h.comment ?? undefined,
      // Entity-də createdAt TS tərəfdə deklarasiya olunmayıbsa:
      actedAt: (h as any).createdAt ?? undefined,
    }));

    const chain: PermissionChainStepDto[] = chainRoles.map((role, index) => ({
      stepNumber: index + 1,
      role,
      isCompleted: history.some((h) => h.stepNumber === index + 1),
    }));

    // 4) Hazırkı holder rolu (son step tamam olmayıbsa)
    const isFinished =
      perm.status === PermissionStatus.APPROVED ||
      perm.status === PermissionStatus.REJECTED;

    let currentHolderRole: UserRole | null = null;

    if (!isFinished) {
      const nextStepIndex = history.length; // 0-based
      currentHolderRole = chainRoles[nextStepIndex] ?? null;
    }

    // 5) Employee DTO
    const employeeDto: PermissionEmployeeDto = {
      id: perm.employee.id,
      name: perm.employee.name,
      email: perm.employee.email,
      departmentName: perm.employee.department?.name,
    };

    // 6) Final approver (ancaq APPROVED üçün)
    const finalApproverName =
      perm.status === PermissionStatus.APPROVED && perm.approvedBy
        ? perm.approvedBy.name
        : undefined;

    const finalApproverEmail =
      perm.status === PermissionStatus.APPROVED && perm.approvedBy
        ? perm.approvedBy.email
        : undefined;

    // 7) Nəticə DTO
    const details = new PermissionDetailsDto();
    details.id = perm.id;
    details.type = perm.type;
    details.status = perm.status;
    details.createdAt = perm.createdAt;
    details.decidedAt = perm.decidedAt ?? undefined;
    details.startDate = perm.startDate;
    details.endDate = perm.endDate ?? undefined;
    details.startTime = perm.startTime ?? undefined;
    details.endTime = perm.endTime ?? undefined;
    details.reason = perm.reason ?? undefined;
    details.comment = perm.comment ?? undefined;
    details.employee = employeeDto;
    details.finalApproverName = finalApproverName;
    details.finalApproverEmail = finalApproverEmail;
    details.currentHolderRole = currentHolderRole;
    details.chain = chain;
    details.approvals = approvals;

    return details;
  }

  private async findHeadOfDepartmentForEmployee(
    employeeId: number,
  ): Promise<User | null> {
    const employee = await this.usersRepo.findOne({
      where: { id: employeeId },
      relations: ['department', 'department.headOfDepartment'],
    });

    return employee?.department?.headOfDepartment ?? null;
  }

  private async findHeadOfHr(companyId: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: {
        company: { id: companyId },
        role: UserRole.HEAD_OF_HR,
      },
    });
  }

  private async findAnyHr(companyId: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: {
        company: { id: companyId },
        role: UserRole.HR,
      },
    });
  }

  private async findAnyCompanyAdmin(companyId: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: {
        company: { id: companyId },
        role: UserRole.COMPANY_ADMIN,
      },
    });
  }
}