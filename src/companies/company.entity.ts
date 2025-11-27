import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';




@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ default: 'Asia/Baku' })
  timezone: string;

  @Column('simple-array', { default: '1,2,3,4,5' })
  workingDays: number[];

  @Column({ type: 'time', default: '09:00' })
  workStartTime: string;

  @Column({ type: 'time', default: '18:00' })
  workEndTime: string;

  @Column({ type: 'int', default: 21 })
  annualLeaveDaysPerYear: number;

  // Aylıq remote limiti (günlə)
  @Column({ type: 'int', default: 5 })
  maxRemoteDaysPerMonth: number;

  // Aylıq short-leave limiti (saat ilə)
  @Column({ type: 'int', default: 8 })
  maxShortLeaveHoursPerMonth: number;

  // Eyni tarixdə üst-üstə icazələrə icazə verilsin?
  @Column({ type: 'bool', default: false })
  allowOverlap: boolean;

  @OneToMany(() => User, (user) => user.company)
  users: User[];

  @OneToMany(() => Department, (dept) => dept.company)
  departments: Department[];

  @OneToMany(() => Permission, (perm) => perm.company)
  permissions: Permission[];



  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}