import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './department.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async createForCompany(
    companyId: number,
    dto: CreateDepartmentDto,
  ): Promise<Department> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    // ⭐ Burda typeni User | null edirik
    let manager: User | null = null;

    if (dto.managerId) {
      const found = await this.usersRepo.findOne({
        where: { id: dto.managerId },
        relations: ['company'],
      });

      if (!found || found.company.id !== companyId) {
        throw new ForbiddenException(
          'Manager bu şirkətə aid deyil və ya tapılmadı',
        );
      }

      manager = found;
    }

    const dept = this.deptRepo.create({
      name: dto.name,
      company,
      // null-u undefined-ə çeviririk ki, type uyğun gəlsin
      manager: manager ?? undefined,
    });

    return this.deptRepo.save(dept);
  }

  async findAllForCompany(companyId: number): Promise<Department[]> {
    return this.deptRepo.find({
      where: { company: { id: companyId } },
      relations: ['manager'],
      order: { createdAt: 'ASC' },
    });
  }
}