import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { PermissionType } from '../common/enums/permission-type.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';

@Injectable()
export class PermissionPolicyService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
  ) {}

  // Helper: iki tarix arasındakı gün sayı (ən azı 1)
  countDays(start: Date, end?: Date): number {
    const s = new Date(start);
    const e = new Date(end ?? start);
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    const diffMs = e.getTime() - s.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  }

  // Overlap check
  async ensureNoOverlap(
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
  async ensureAnnualLeaveLimit(
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
  async ensureRemoteLimit(
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
  async ensureShortLeaveLimit(
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

  getEffectivePolicy(company: Company, employee: User) {
    const annualLeaveDaysPerYear =
      employee.customAnnualLeaveDaysPerYear ??
      company.annualLeaveDaysPerYear;

    const hasRemoteWork =
      employee.customHasRemoteWork ?? company.hasRemoteWork;

    const maxRemoteDaysPerMonth =
      employee.customMaxRemoteDaysPerMonth ?? company.maxRemoteDaysPerMonth;

    const maxShortLeaveHoursPerMonth =
      employee.customMaxShortLeaveHoursPerMonth ??
      company.maxShortLeaveHoursPerMonth;

    const allowOverlap = company.allowOverlap;

    const minAdvanceDaysForAnnualLeave =
      company.minAdvanceDaysForAnnualLeave ?? 14; // default 14 gün

    return {
      annualLeaveDaysPerYear,
      hasRemoteWork,
      maxRemoteDaysPerMonth,
      maxShortLeaveHoursPerMonth,
      allowOverlap,
      minAdvanceDaysForAnnualLeave,
    };
  }

  ensureAnnualLeaveAdvanceNotice(
    minDays: number,
    startDate: Date,
  ): void {
    if (!minDays || minDays <= 0) {
      // 0 və ya undefined → məhdudiyyət yoxdur
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const diffMs = start.getTime() - today.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < minDays) {
      throw new ForbiddenException(
        `ANNUAL_LEAVE üçün ən azı ${minDays} gün əvvəl müraciət edilməlidir. ` +
          `Seçilmiş tarix: ${start.toISOString().slice(0, 10)}.`,
      );
    }
  }

  async validatePolicyForNewPermission(
    company: Company,
    employee: User,
    dto: CreatePermissionDto,
  ): Promise<void> {
    const policy = this.getEffectivePolicy(company, employee);

    const startDate = new Date(dto.startDate);
    const endDate = dto.endDate ? new Date(dto.endDate) : undefined;

    // 🔹 Overlap yoxlanışı
    if (!policy.allowOverlap) {
      await this.ensureNoOverlap(company.id, employee.id, startDate, endDate);
    }

    // 🔹 ANNUAL_LEAVE üçün advance notice + illik limit
    if (dto.type === PermissionType.ANNUAL_LEAVE) {
      // 1) Əvvəlcədən xəbərdarlıq (minAdvanceDaysForAnnualLeave)
      this.ensureAnnualLeaveAdvanceNotice(
        policy.minAdvanceDaysForAnnualLeave,
        startDate,
      );

      // 2) İllik limit (entitlementDays)
      await this.ensureAnnualLeaveLimit(
        company,
        employee.id,
        startDate,
        endDate,
        policy.annualLeaveDaysPerYear,
      );
    }

    // 🔹 REMOTE_WORK üçün şirkət + user policy
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

    // 🔹 SHORT_LEAVE üçün aylıq saat limiti
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
}

