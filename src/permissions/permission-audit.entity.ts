import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Company } from '../companies/company.entity';
import { Permission } from './permission.entity';
import { PermissionAuditAction } from '../common/enums/permission-audit-action.enum';
import { PermissionAuditResult } from '../common/enums/permission-audit-result.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';

@Entity('permission_audits')
export class PermissionAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  company: Company;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE', nullable: true })
  permission?: Permission;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  actor?: User;

  @Column({
    type: 'enum',
    enum: PermissionAuditAction,
  })
  action: PermissionAuditAction;

  @Column({
    type: 'enum',
    enum: PermissionAuditResult,
  })
  result: PermissionAuditResult;

  @Column({
    type: 'enum',
    enum: PermissionStatus,
    nullable: true,
  })
  previousStatus?: PermissionStatus;

  @Column({
    type: 'enum',
    enum: PermissionStatus,
    nullable: true,
  })
  newStatus?: PermissionStatus;

  @Column({ type: 'text', nullable: true })
  reason?: string; // Niyə fail oldu, və ya comment

  @CreateDateColumn()
  createdAt: Date;
}