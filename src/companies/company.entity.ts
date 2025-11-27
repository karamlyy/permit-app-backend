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

  @OneToMany(() => User, (user) => user.company)
  users: User[];

  @OneToMany(() => Department, (dept) => dept.company)
  departments: Department[];

  @OneToMany(() => Permission, (perm) => perm.company)
  permissions: Permission[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}