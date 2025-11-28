import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller()
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('me/company')
  @ApiOperation({ summary: 'Hazırkı istifadəçinin şirkət məlumatını qaytarır' })
  @ApiOkResponse({
    description: 'Şirkət məlumatı qaytarıldı',
  })
  getMyCompany(@CurrentUser() user: any) {
    return this.companiesService.getCompanyById(user.companyId);
  }


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
}