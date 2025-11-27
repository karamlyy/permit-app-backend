import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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
}