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
      relations: ['company'],
    });
    if (!employee || employee.company.id !== currentUser.companyId) {
      throw new ForbiddenException('İstifadəçi bu şirkətə aid deyil');
    }

    // ⭐ Policy check
    await this.validatePolicyForNewPermission(
      company,
      employee.id,
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

    return this.permRepo.save(perm);
  }

  // EMPLOYEE: öz icazələrini gör
  async findMyPermissions(currentUser: { userId: number }): Promise<Permission[]> {
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
        .where('company.id = :companyId', { companyId: currentUser.companyId })
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
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HR,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      throw new ForbiddenException('İcazə təsdiqi üçün səlahiyyət yoxdur');
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    if (
      [PermissionStatus.APPROVED, PermissionStatus.REJECTED].includes(
        perm.status,
      )
    ) {
      throw new ForbiddenException(
        'Bu icazə artıq yekun vəziyyətdədir (APPROVED/REJECTED).',
      );
    }

    const approver = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
      relations: ['department', 'department.manager'],
    });
    if (!approver) {
      throw new ForbiddenException('Approver tapılmadı');
    }

    const chain = await this.getApprovalChainForPermission(
      currentUser.companyId,
      perm.employee,
      perm.type,
    );

    const history = await this.getApprovalHistory(perm.id);
    const nextStepIndex = history.length; // 0-based index
    const expectedRole = chain[nextStepIndex];

    if (!expectedRole) {
      // artıq bütün step-lər işlənib – bu halda approve etməyə çalışmaq səhvdir
      throw new ForbiddenException('Bu icazə artıq təsdiq zəncirini tamamlayıb.');
    }

    if (currentUser.role !== expectedRole) {
      throw new ForbiddenException(
        `Bu addım üçün gözlənilən rol: ${expectedRole}, səndə isə: ${currentUser.role}.`,
      );
    }

    // Tarixçəyə addım əlavə et
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

    if (isLastStep) {
      perm.status = PermissionStatus.APPROVED;
      perm.approvedBy = approver;
      perm.managerComment = dto.managerComment;
      perm.decidedAt = new Date();
    } else {
      perm.status = PermissionStatus.IN_PROGRESS;
      perm.managerComment = dto.managerComment ?? perm.managerComment;
    }

    return this.permRepo.save(perm);
  }

  // REJECT
    async reject(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: RejectPermissionDto,
  ): Promise<Permission> {
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HR,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      throw new ForbiddenException('İcazə rəddi üçün səlahiyyət yoxdur');
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    if (
      [PermissionStatus.APPROVED, PermissionStatus.REJECTED].includes(
        perm.status,
      )
    ) {
      throw new ForbiddenException(
        'Bu icazə artıq yekun vəziyyətdədir (APPROVED/REJECTED).',
      );
    }

    const approver = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
    });
    if (!approver) {
      throw new ForbiddenException('Approver tapılmadı');
    }

    const chain = await this.getApprovalChainForPermission(
      currentUser.companyId,
      perm.employee,
      perm.type,
    );
    const history = await this.getApprovalHistory(perm.id);
    const nextStepIndex = history.length;
    const expectedRole = chain[nextStepIndex];

    if (!expectedRole || currentUser.role !== expectedRole) {
      throw new ForbiddenException(
        `Bu addım üçün gözlənilən rol: ${expectedRole}, səndə isə: ${currentUser.role}.`,
      );
    }

    const approval = this.approvalRepo.create({
      permission: perm,
      approver,
      role: currentUser.role,
      stepNumber: nextStepIndex + 1,
      status: PermissionStatus.REJECTED,
      comment: dto.managerComment,
    });
    await this.approvalRepo.save(approval);

    perm.status = PermissionStatus.REJECTED;
    perm.approvedBy = approver;
    perm.managerComment = dto.managerComment;
    perm.decidedAt = new Date();

    return this.permRepo.save(perm);
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

  // Annual leave limit
  private async ensureAnnualLeaveLimit(
    company: Company,
    employeeId: number,
    startDate: Date,
    endDate?: Date,
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
      .andWhere('perm.type = :type', { type: PermissionType.ANNUAL_LEAVE })
      .andWhere('perm.status = :status', { status: PermissionStatus.APPROVED })
      .andWhere('perm.startDate BETWEEN :from AND :to', { from, to })
      .getMany();

    const usedDays = existing.reduce(
      (acc, p) => acc + this.countDays(p.startDate, p.endDate),
      0,
    );

    const requestedDays = this.countDays(startDate, endDate);
    const total = usedDays + requestedDays;

    if (total > company.annualLeaveDaysPerYear) {
      throw new ForbiddenException(
        `İllik məzuniyyət limitini aşır: istifadə olunmuş ${usedDays} gün, istəyən ${requestedDays} gün, limit ${company.annualLeaveDaysPerYear} gün.`,
      );
    }
  }

  // Remote limit (sadə variant — hər permission 1 gün kimi sayılır və ya date range qədər)
  private async ensureRemoteLimit(
    company: Company,
    employeeId: number,
    startDate: Date,
    endDate?: Date,
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
      .andWhere('perm.type = :type', { type: PermissionType.REMOTE_WORK })
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

    if (total > company.maxRemoteDaysPerMonth) {
      throw new ForbiddenException(
        `Bu ay üçün remote limiti aşılır: istifadə olunmuş ${usedDays} gün, istəyən ${requestedDays} gün, limit ${company.maxRemoteDaysPerMonth} gün.`,
      );
    }
  }

  // Short leave limit (saatla) – sadə: hər permission üçün (endTime-startTime) hesablanır
  private async ensureShortLeaveLimit(
    company: Company,
    employeeId: number,
    startDate: Date,
    startTime?: string,
    endTime?: string,
  ): Promise<void> {
    if (!startTime || !endTime) {
      return;
    }

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const requestedHours = (eh + eh / 60) - (sh + sm / 60);
    if (requestedHours <= 0) {
      throw new ForbiddenException('Short leave üçün saat intervalı yanlışdır.');
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
      .andWhere('perm.type = :type', { type: PermissionType.SHORT_LEAVE })
      .andWhere('perm.status IN (:...statuses)', {
        statuses: [PermissionStatus.PENDING, PermissionStatus.APPROVED],
      })
      .andWhere('perm.startDate BETWEEN :from AND :to', {
        from: monthStart,
        to: monthEnd,
      })
      .getMany();

    // Sadə variant: hər short leave üçün 2 saatlıq default qəbul edə bilərsən,
    // amma daha real üçün hər birinin saat aralığını entity-yə əlavə edib hesablamaq lazımdır.
    // Burda assume edək ki, gələcəkdə saxlanıb.
    const usedHours = 0; // TODO: detallaşdırmaq olar

    const total = usedHours + requestedHours;
    if (total > company.maxShortLeaveHoursPerMonth) {
      throw new ForbiddenException(
        `Short leave aylıq saat limiti aşılır: ${total.toFixed(
          1,
        )} saat, limit ${company.maxShortLeaveHoursPerMonth} saat.`,
      );
    }
  }

  private async validatePolicyForNewPermission(
    company: Company,
    employeeId: number,
    dto: CreatePermissionDto,
  ): Promise<void> {
    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;

    if (!company.allowOverlap) {
      await this.ensureNoOverlap(company.id, employeeId, startDate, endDate);
    }

    if (dto.type === PermissionType.ANNUAL_LEAVE) {
      await this.ensureAnnualLeaveLimit(company, employeeId, startDate, endDate);
    }

    if (dto.type === PermissionType.REMOTE_WORK) {
      await this.ensureRemoteLimit(company, employeeId, startDate, endDate);
    }

    if (dto.type === PermissionType.SHORT_LEAVE) {
      await this.ensureShortLeaveLimit(
        company,
        employeeId,
        startDate,
        dto.startTime,
        dto.endTime,
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


  
}