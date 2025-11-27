import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Permission } from './permission.entity';
import { User } from '../users/user.entity';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { UserRole } from '../common/enums/user-role.enum';

@Entity('permission_approvals')
export class PermissionApproval {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Permission, (perm) => perm.approvals, {
    onDelete: 'CASCADE',
  })
  permission: Permission;

  @ManyToOne(() => User, { nullable: true })
  approver?: User;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ type: 'int' })
  stepNumber: number;

  @Column({ type: 'enum', enum: PermissionStatus })
  status: PermissionStatus; // APPROVED və ya REJECTED

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  decidedAt: Date;
}