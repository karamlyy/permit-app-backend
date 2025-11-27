import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';
  import { User } from '../users/user.entity';
import { PermissionType } from '../common/enums/permission-type.enum';
import { PermissionStatus } from '../common/enums/permission-status.enum';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Company, (company) => company.permissions, {
    onDelete: 'CASCADE',
  })
  company: Company;

  @ManyToOne(() => User, (user) => user.permissions, {
    onDelete: 'CASCADE',
  })
  employee: User;

  @ManyToOne(() => User, { nullable: true })
  approvedBy?: User;

  @Column({ type: 'enum', enum: PermissionType })
  type: PermissionType;

  @Column({ type: 'enum', enum: PermissionStatus, default: PermissionStatus.PENDING })
  status: PermissionStatus;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate?: Date;

  @Column({ type: 'time', nullable: true })
  startTime?: string;

  @Column({ type: 'time', nullable: true })
  endTime?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'text', nullable: true })
  managerComment?: string;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt?: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}