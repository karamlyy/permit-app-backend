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
  

  // Departamentin MANAGER-i (komanda lead və s.)
  @ManyToOne(() => User, (user) => user.managedDepartments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  manager?: User | null;

  // 🔥 Yeni: departamentin rəhbəri (HEAD_OF_DEPARTMENT)
  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  headOfDepartment?: User | null;

  @OneToMany(() => User, (user) => user.department)
  users: User[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
  

  

  

  
}