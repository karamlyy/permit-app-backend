import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  Param,
  ParseIntPipe,
  Post,
  Delete,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UpdateCompanyPolicyDto } from './dto/update-company-policy.dto';
import { UserRole } from 'src/common/enums/user-role.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { CreateBranchDto } from '../branches/dto/create-branch.dto';
import { UpdateBranchDto } from '../branches/dto/update-branch.dto';

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller()
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // 👤 İstifadəçinin öz şirkət məlumatı (departments, users, branches ilə)
  @Get('me/company')
  @ApiOperation({ summary: 'Hazırkı istifadəçinin şirkət məlumatını qaytarır' })
  @ApiOkResponse({
    description: 'Şirkət məlumatı qaytarıldı',
  })
  getMyCompany(@CurrentUser() user: any) {
    return this.companiesService.getMyCompanyProfile({
      companyId: user.companyId,
    });
  }

  // 🧩 Şirkət policy-ləri (illik gün, remote limiti və s.)
  @Patch('admin/company/policy')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Şirkət səviyyəsində icazə policy-lərini yenilə' })
  @ApiOkResponse({ description: 'Policy yeniləndi' })
  updatePolicy(
    @CurrentUser() user: any,
    @Body() dto: UpdateCompanyPolicyDto,
  ) {
    return this.companiesService.updateCompanyPolicy(
      { companyId: user.companyId, role: user.role },
      dto,
    );
  }

  // 🏢 Şirkət profilini yeniləmək (ad, haqqında, sektor, ölçü və s.)
  @Patch('admin/company/profile')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'Şirkət profilini yenilə (ad, haqqında, sektor, ölçü və s.)',
  })
  @ApiOkResponse({ description: 'Profil yeniləndi' })
  updateProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateCompanyProfileDto,
  ) {
    return this.companiesService.updateCompanyProfile(
      { companyId: user.companyId, role: user.role },
      dto,
    );
  }

  // 🏬 Filialların siyahısı
  @Get('admin/company/branches')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Şirkətin filiallarını siyahı şəklində qaytar' })
  @ApiOkResponse({ description: 'Filiallar siyahısı qaytarılır' })
  listBranches(@CurrentUser() user: any) {
    return this.companiesService.listBranches({
      companyId: user.companyId,
    });
  }

  // 🏬 Yeni filial yarat
  @Post('admin/company/branches')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Yeni filial yarat' })
  @ApiOkResponse({ description: 'Filial yaradıldı' })
  createBranch(
    @CurrentUser() user: any,
    @Body() dto: CreateBranchDto,
  ) {
    return this.companiesService.createBranch(
      { companyId: user.companyId, role: user.role },
      dto,
    );
  }

  // 🏬 Filial yenilə
  @Patch('admin/company/branches/:id')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Mövcud filialı yenilə' })
  @ApiOkResponse({ description: 'Filial yeniləndi' })
  updateBranch(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.companiesService.updateBranch(
      { companyId: user.companyId, role: user.role },
      id,
      dto,
    );
  }

  // 🗑 Filial sil
  @Delete('admin/company/branches/:id')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Filialı sil' })
  @ApiOkResponse({ description: 'Filial silindi' })
  deleteBranch(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.companiesService.deleteBranch(
      { companyId: user.companyId, role: user.role },
      id,
    );
  }
}