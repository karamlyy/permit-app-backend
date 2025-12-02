import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Company } from '../companies/company.entity';

@Entity('branches')
export class Branch {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Company, (company) => company.branches, {
    onDelete: 'CASCADE',
  })
  company: Company;

  @Column()
  name: string; // Filial adı: "Bakı baş ofis", "Gəncə filialı" və s.

  @Column({ nullable: true })
  code?: string; // Məs: "BAKU01"

  @Column({ nullable: true })
  country?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  addressLine?: string;

  @Column({ nullable: true })
  postalCode?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  timezone?: string;

  @Column({ type: 'boolean', default: false })
  isHeadOffice: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}