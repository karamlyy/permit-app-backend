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
    if (
      currentUser.role === UserRole.COMPANY_ADMIN ||
      currentUser.role === UserRole.HR
    ) {
      // HR & Admin bütün şirkəti görsün
      return this.permRepo.find({
        where: { company: { id: currentUser.companyId } },
        relations: ['employee', 'approvedBy'],
        order: { createdAt: 'DESC' },
      });
    }

    if (currentUser.role === UserRole.MANAGER) {
      // Manager yalnız öz departamentindəki işçiləri görsün
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

      // Bu departamentlərdə olan işçilərin icazələri
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
        UserRole.HR,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      // audit: icazəsi olmayan biri approve etməyə çalışdı
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
      relations: ['department'],
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

    // 3) Manager üçün: yalnız öz idarə etdiyi departamentdəki employee
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

    // 4) Artıq yekun vəziyyətdədirsə (APPROVED/REJECTED) – block
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

    // 5) Approver user
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

    // 6) Approval chain + step check
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

    // 7) Approval addımı DB-yə yaz
    const approval = this.approvalRepo.create({
      permission: perm,
      approver,
      role: currentUser.role,
      stepNumber: nextStepIndex + 1,
      status: PermissionStatus.APPROVED,
      comment: dto.managerComment,
    });
    await this.approvalRepo.save(approval);

    const isLastStep = nextStepIndex === chain.length - 1;
    const prevStatus = perm.status;

    if (isLastStep) {
      perm.status = PermissionStatus.APPROVED;
      perm.approvedBy = approver;
      perm.managerComment = dto.managerComment;
      perm.decidedAt = new Date();
    } else {
      perm.status = PermissionStatus.IN_PROGRESS;
      perm.managerComment = dto.managerComment ?? perm.managerComment;
    }

    const saved = await this.permRepo.save(perm);

    // 8) SUCCESS audit log
    await this.logPermissionAction({
      companyId: currentUser.companyId,
      permission: saved,
      actorId: currentUser.userId,
      action: PermissionAuditAction.APPROVE,
      result: PermissionAuditResult.SUCCESS,
      previousStatus: prevStatus,
      newStatus: saved.status,
      reason: dto.managerComment,
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
        UserRole.HR,
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
      relations: ['department'],
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

    // 4) Artıq yekun vəziyyətdədirsə – block
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

    // 5) Approver user
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

    // 6) Approval chain + step check
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

    // 7) Approval addımı (REJECT) yaz
    const approval = this.approvalRepo.create({
      permission: perm,
      approver,
      role: currentUser.role,
      stepNumber: nextStepIndex + 1,
      status: PermissionStatus.REJECTED,
      comment: dto.managerComment,
    });
    await this.approvalRepo.save(approval);

    const prevStatus = perm.status;

    perm.status = PermissionStatus.REJECTED;
    perm.approvedBy = approver;
    perm.managerComment = dto.managerComment;
    perm.decidedAt = new Date();

    const saved = await this.permRepo.save(perm);

    // 8) SUCCESS audit log
    await this.logPermissionAction({
      companyId: currentUser.companyId,
      permission: saved,
      actorId: currentUser.userId,
      action: PermissionAuditAction.REJECT,
      result: PermissionAuditResult.SUCCESS,
      previousStatus: prevStatus,
      newStatus: saved.status,
      reason: dto.managerComment,
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
    const requestedHours = (eh + em / 60) - (sh + sm / 60);

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

    // TODO: Burada hər existing short leave üçün saat hesablayıb cəmləmək olar.
    const usedHours = 0;

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

  // Sadə approval chain generator
  // Real həyatda bunu company / department / permissionType üzrə konfiqurable edə bilərsən.
  private async getApprovalChainForPermission(
    companyId: number,
    employee: User,
    type: PermissionType,
  ): Promise<UserRole[]> {
    // Sadə qayda:
    // SHORT_LEAVE & REMOTE_WORK: Manager → HR
    // ANNUAL / SICK / UNPAID / BUSINESS_TRIP: Manager → HR → COMPANY_ADMIN
    const base: UserRole[] = [UserRole.MANAGER, UserRole.HR];

    const longTypes = [
      PermissionType.ANNUAL_LEAVE,
      PermissionType.SICK_LEAVE,
      PermissionType.UNPAID_LEAVE,
      PermissionType.BUSINESS_TRIP,
    ];

    if (longTypes.includes(type)) {
      base.push(UserRole.COMPANY_ADMIN);
    }

    // Əgər employee-nin departamentində manager yoxdursa, chain-dən MANAGER-i çıxara bilərik.
    const relations = await this.usersRepo.findOne({
      where: { id: employee.id },
      relations: ['department', 'department.manager'],
    });

    const hasManager =
      relations?.department && relations.department.manager
        ? true
        : false;

    if (!hasManager) {
      return base.filter((r) => r !== UserRole.MANAGER);
    }

    return base;
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

    // APPROVED icazələr
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

    // 🔥 Pending icazələr də hesablansın (Pending + InProgress)
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

    const remainingDays = Math.max(
      entitlementDays - usedDays - pendingDays,
      0,
    );

    const dto = new LeaveBalanceDto();
    dto.year = targetYear;
    dto.entitlementDays = entitlementDays;
    dto.usedDays = usedDays;
    dto.pendingDays = pendingDays;
    dto.remainingDays = remainingDays;

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
      // Burada da istersen 0 balans qaytara bilərsən, indi daha sərt saxladım
      throw new ForbiddenException(
        'Deaktiv istifadəçi üçün məzuniyyət balansı göstərilə bilməz',
      );
    }

    // COMPANY_ADMIN və HR bütün şirkəti görür
    if (
      currentUser.role === UserRole.COMPANY_ADMIN ||
      currentUser.role === UserRole.HR
    ) {
      return this.calculateLeaveBalance(company, targetUser);
    }

    // MANAGER yalnız öz departamentindəki işçiləri görsün
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
          'Bu istifadəçi üçün məzuniyyət balansına baxmağa səlahiyyətin yoxdur',
        );
      }

      return this.calculateLeaveBalance(company, targetUser);
    }

    // Digər rollar üçün qadağandır
    throw new ForbiddenException(
      'Bu əməliyyat üçün səlahiyyətiniz yoxdur',
    );
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
}