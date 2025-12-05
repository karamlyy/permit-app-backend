import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { PermissionType } from '../common/enums/permission-type.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { LeaveBalanceDto } from './dto/leave-balance.dto';
import { PermissionPolicyService } from './permission-policy.service';

@Injectable()
export class PermissionBalanceService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    private readonly policyService: PermissionPolicyService,
  ) {}

  async calculateLeaveBalance(
    company: Company,
    employee: User,
    year?: number,
  ): Promise<LeaveBalanceDto> {
    const policy = this.policyService.getEffectivePolicy(company, employee);
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
      (acc, p) =>
        acc + this.policyService.countDays(p.startDate, p.endDate),
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
      (acc, p) =>
        acc + this.policyService.countDays(p.startDate, p.endDate),
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
}

