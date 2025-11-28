import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './company.entity';
import { UpdateCompanyPolicyDto } from './dto/update-company-policy.dto';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../common/enums/user-role.enum';
@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
  ) {}

  async getCompanyById(id: number) {
    const company = await this.companiesRepo.findOne({
      where: { id },
      relations: ['departments', 'users'],
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }
    return company;
  }


  async updateCompanyPolicy(
    currentUser: { companyId: number; role: UserRole },
    dto: UpdateCompanyPolicyDto,
  ): Promise<Company> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException('Bu əməliyyat üçün səlahiyyət yoxdur');
    }

    const company = await this.companiesRepo.findOne({
      where: { id: currentUser.companyId },
    });

    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    if (dto.annualLeaveDaysPerYear !== undefined) {
      company.annualLeaveDaysPerYear = dto.annualLeaveDaysPerYear;
    }
    if (dto.hasRemoteWork !== undefined) {
      company.hasRemoteWork = dto.hasRemoteWork;
    }
    if (dto.maxRemoteDaysPerMonth !== undefined) {
      company.maxRemoteDaysPerMonth = dto.maxRemoteDaysPerMonth;
    }
    if (dto.maxShortLeaveHoursPerMonth !== undefined) {
      company.maxShortLeaveHoursPerMonth = dto.maxShortLeaveHoursPerMonth;
    }
    if (dto.allowOverlap !== undefined) {
      company.allowOverlap = dto.allowOverlap;
    }

    return this.companiesRepo.save(company);
  }
}