import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './company.entity';
import { UpdateCompanyPolicyDto } from './dto/update-company-policy.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { UserRole } from '../common/enums/user-role.enum';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
  ) { }

  // Admin üçün istənilən company id ilə məlumat almaq (əvvəlki metod)
  async getCompanyById(id: number): Promise<Company> {
    const company = await this.companiesRepo.findOne({
      where: { id },
      relations: ['departments', 'users'],
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }
    return company;
  }

  // Login olmuş istifadəçinin öz şirkətini gətirmək (me/company üçün)
  async getMyCompanyProfile(currentUser: {
    companyId: number;
  }): Promise<Company> {
    const company = await this.companiesRepo.findOne({
      where: { id: currentUser.companyId },
      relations: ['departments', 'users'],
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }
    return company;
  }

  // Şirkətin policy-lərini yeniləmək (illik gün, remote limit və s.) — sənin əvvəlki kodun
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
      company.maxShortLeaveHoursPerMonth =
        dto.maxShortLeaveHoursPerMonth;
    }
    if (dto.allowOverlap !== undefined) {
      company.allowOverlap = dto.allowOverlap;
    }

    return this.companiesRepo.save(company);
  }

  // Şirkət profilini (ad, haqqında, sektor, ölçü və s.) yeniləmək
  async updateCompanyProfile(
    currentUser: { companyId: number; role: UserRole },
    dto: UpdateCompanyProfileDto,
  ): Promise<Company> {
    if (currentUser.role !== UserRole.COMPANY_ADMIN) {
      throw new ForbiddenException(
        'Şirkət profilini yalnız Company Admin yeniləyə bilər',
      );
    }

    const company = await this.companiesRepo.findOne({
      where: { id: currentUser.companyId },
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    Object.assign(company, dto);

    return this.companiesRepo.save(company);
  }
}