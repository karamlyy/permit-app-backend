import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionAudit } from './permission-audit.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { Permission } from './permission.entity';
import { PermissionAuditAction } from '../common/enums/permission-audit-action.enum';
import { PermissionAuditResult } from '../common/enums/permission-audit-result.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { PermissionAuditDto, PermissionAuditActorDto } from './dto/permission-audit.dto';

@Injectable()
export class PermissionAuditService {
  constructor(
    @InjectRepository(PermissionAudit)
    private readonly auditRepo: Repository<PermissionAudit>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async logPermissionAction(options: {
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
    companyId: number,
    permissionId: number,
  ): Promise<PermissionAuditDto[]> {
    const audits = await this.auditRepo.find({
      where: {
        company: { id: companyId },
        permission: { id: permissionId },
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

