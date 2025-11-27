import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @ManyToOne(() => Company, (company) => company.departments, {
    onDelete: 'CASCADE',
  })
  company: Company;

  @ManyToOne(() => User, (user) => user.managedDepartments, {
    nullable: true,
  })
  manager?: User;

  @OneToMany(() => User, (user) => user.department)
  users: User[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}