import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { Department } from '../departments/department.entity';
import { Permission } from 'src/permissions/permission.entity';


@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.EMPLOYEE })
  role: UserRole;

  @ManyToOne(() => Company, (company) => company.users, { onDelete: 'CASCADE' })
  company: Company;

  @ManyToOne(() => Department, (dept) => dept.users, { nullable: true })
  department?: Department;

  @OneToMany(() => Department, (dept) => dept.manager)
  managedDepartments: Department[];

  @Column({ nullable: true })
  position?: string;

  @Column({ type: 'date', nullable: true })
  hireDate?: Date;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  // 🔽 Employee-level policy overrides (optional sahələr)

  // Bu işçinin illik məzuniyyət günləri (əgər null-dursa, company default)
  @Column({ type: 'int', nullable: true })
  customAnnualLeaveDaysPerYear?: number | null;

  // Bu işçiyə remote ümumiyyətlə icazə verilir?
  // null → şirkətin hasRemoteWork dəyərinə bax
  @Column({ type: 'bool', nullable: true })
  customHasRemoteWork?: boolean | null;

  // Bu işçiyə ayda neçə remote gün icazə var? (null → company default)
  @Column({ type: 'int', nullable: true })
  customMaxRemoteDaysPerMonth?: number | null;

  // Short leave üçün fərdi limit (null → company default)
  @Column({ type: 'int', nullable: true })
  customMaxShortLeaveHoursPerMonth?: number | null;

  @Column({ type: 'varchar', nullable: true })
  refreshToken?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  refreshTokenExpires?: Date | null;

  @Column({ nullable: true })
  fcmToken?: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Permission, (perm) => perm.employee)
  permissions: Permission[];

  @OneToMany(() => Department, (dept) => dept.headOfDepartment)
  headedDepartments: Department[];
}