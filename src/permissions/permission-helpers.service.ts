import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

@Injectable()
export class PermissionHelpersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async findHeadOfDepartmentForEmployee(
    employeeId: number,
  ): Promise<User | null> {
    const employee = await this.usersRepo.findOne({
      where: { id: employeeId },
      relations: ['department', 'department.headOfDepartment'],
    });

    return employee?.department?.headOfDepartment ?? null;
  }

  async findHeadOfHr(companyId: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: {
        company: { id: companyId },
        role: UserRole.HEAD_OF_HR,
      },
    });
  }

  async findAnyHr(companyId: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: {
        company: { id: companyId },
        role: UserRole.HR,
      },
    });
  }

  async findAnyCompanyAdmin(companyId: number): Promise<User | null> {
    return this.usersRepo.findOne({
      where: {
        company: { id: companyId },
        role: UserRole.COMPANY_ADMIN,
      },
    });
  }
}

