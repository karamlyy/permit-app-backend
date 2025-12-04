import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
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

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller()
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) { }

  // 👤 İstifadəçinin öz şirkət məlumatı (departments, users ilə)
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
  @Roles(UserRole.COMPANY_ADMIN)
  @ApiOperation({
    summary: 'Şirkət profilini yenilə (ad, haqqında, sektor, ölçü və s.)',
    description: 'Bu əməliyyatı yalnız Company Admin icra edə bilər.',
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
}