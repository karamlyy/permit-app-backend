import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';
import { CompanySize } from '../common/enums/company-size.enum';
import { CompanySector } from 'src/common/enums/company-sectors.enum';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  // Əsas identity sahələri
  @Column({ unique: true })
  name: string; // "Skillvania LLC"

  @Column({ nullable: true })
  legalName?: string; // "Skillvania Məhdud Məsuliyyətli Cəmiyyəti"

  @Column({ type: 'text', nullable: true })
  description?: string; // Şirkət haqqında qısa info

  @Column({
    type: 'enum',
    enum: CompanySector,
    default: CompanySector.OTHER,
  })
  sector: CompanySector;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  email?: string;

  // Ünvan məlumatları (baş ofis üçün)
  @Column({ nullable: true })
  country?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  addressLine?: string;

  @Column({ nullable: true })
  postalCode?: string;

  @Column({ nullable: true })
  logoUrl?: string;

  // İşçi sayı / ölçü
  @Column({ type: 'int', nullable: true })
  employeeCount?: number;

  @Column({
    type: 'enum',
    enum: CompanySize,
    default: CompanySize.SMALL,
  })
  size: CompanySize;

  // İş saatları və iş günləri ( əvvəldən olan sahələrdən istifadə edirik )
  @Column({ default: 'Asia/Baku' })
  timezone: string;

  @Column('simple-array', { default: '1,2,3,4,5' })
  workingDays: number[]; // 1=Mon, 7=Sun

  @Column({ type: 'time', default: '09:00' })
  workStartTime: string;

  @Column({ type: 'time', default: '18:00' })
  workEndTime: string;

  // ⭐ Policy defaults (səndə artıq var idi, saxlayırıq)
  @Column({ type: 'int', default: 21 })
  annualLeaveDaysPerYear: number;

  @Column({ type: 'bool', default: true })
  hasRemoteWork: boolean;

  @Column({ type: 'int', default: 5 })
  maxRemoteDaysPerMonth: number;

  @Column({ type: 'int', default: 8 })
  maxShortLeaveHoursPerMonth: number;

  @Column({ type: 'bool', default: false })
  allowOverlap: boolean;
  
  @Column({ type: 'int', default: 14 })
  minAdvanceDaysForAnnualLeave: number; // ANNUAL_LEAVE üçün minimal əvvəlcədən xəbərdarlıq (günlə)

  @OneToMany(() => User, (user) => user.company)
  users: User[];

  @OneToMany(() => Department, (dept) => dept.company)
  departments: Department[];

  @OneToMany(() => Permission, (perm) => perm.company)
  permissions: Permission[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}