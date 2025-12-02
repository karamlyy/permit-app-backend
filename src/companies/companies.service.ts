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
import { CreateBranchDto } from '../branches/dto/create-branch.dto';
import { UpdateBranchDto } from '../branches/dto/update-branch.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { Branch } from 'src/branches/branches.entity';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
    @InjectRepository(Branch)
    private readonly branchRepo: Repository<Branch>,
  ) {}

  // Admin üçün istənilən company id ilə məlumat almaq (əvvəlki metod)
  async getCompanyById(id: number): Promise<Company> {
    const company = await this.companiesRepo.findOne({
      where: { id },
      relations: ['departments', 'users', 'branches'],
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
      relations: ['branches', 'departments', 'users'],
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

    Object.assign(company, dto);

    return this.companiesRepo.save(company);
  }

  // 🔹 Filiallar (branches)

  async listBranches(currentUser: {
    companyId: number;
  }): Promise<Branch[]> {
    return this.branchRepo.find({
      where: { company: { id: currentUser.companyId } },
      order: { createdAt: 'DESC' },
    });
  }

  async createBranch(
    currentUser: { companyId: number; role: UserRole },
    dto: CreateBranchDto,
  ): Promise<Branch> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'Filial yaratmaq üçün səlahiyyət yoxdur',
      );
    }

    const company = await this.companiesRepo.findOne({
      where: { id: currentUser.companyId },
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    const branch = this.branchRepo.create({
      ...dto,
      company,
    });

    // Əgər bu filial baş ofis seçilərsə, digərlərinin isHeadOffice-ni false edirik
    if (dto.isHeadOffice) {
      const existingHeadOffices = await this.branchRepo.find({
        where: { company: { id: company.id }, isHeadOffice: true },
      });
      for (const b of existingHeadOffices) {
        b.isHeadOffice = false;
        await this.branchRepo.save(b);
      }
    }

    return this.branchRepo.save(branch);
  }

  async updateBranch(
    currentUser: { companyId: number; role: UserRole },
    branchId: number,
    dto: UpdateBranchDto,
  ): Promise<Branch> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'Filial yeniləmək üçün səlahiyyət yoxdur',
      );
    }

    const branch = await this.branchRepo.findOne({
      where: { id: branchId },
      relations: ['company'],
    });

    if (!branch || branch.company.id !== currentUser.companyId) {
      throw new NotFoundException('Filial tapılmadı');
    }

    Object.assign(branch, dto);

    if (dto.isHeadOffice) {
      const others = await this.branchRepo.find({
        where: {
          company: { id: currentUser.companyId },
          isHeadOffice: true,
        },
      });
      for (const b of others) {
        if (b.id !== branch.id) {
          b.isHeadOffice = false;
          await this.branchRepo.save(b);
        }
      }
    }

    return this.branchRepo.save(branch);
  }

  async deleteBranch(
    currentUser: { companyId: number; role: UserRole },
    branchId: number,
  ): Promise<void> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'Filial silmək üçün səlahiyyət yoxdur',
      );
    }

    const branch = await this.branchRepo.findOne({
      where: { id: branchId },
      relations: ['company'],
    });

    if (!branch || branch.company.id !== currentUser.companyId) {
      throw new NotFoundException('Filial tapılmadı');
    }

    await this.branchRepo.remove(branch);
  }
}