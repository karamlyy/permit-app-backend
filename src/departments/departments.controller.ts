import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@ApiTags('departments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({ summary: 'Şirkət üçün yeni departament yaradır' })
  @ApiCreatedResponse({ description: 'Departament yaradıldı' })
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departmentsService.createForCompany(user.companyId, dto);
  }

  @Get()
  @Roles(
    UserRole.COMPANY_ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
    UserRole.EMPLOYEE,
  )
  @ApiOperation({ summary: 'Hazırkı şirkətin bütün departamentlərini qaytarır' })
  @ApiOkResponse({ description: 'Departamentlər siyahısı qaytarıldı' })
  findAll(@CurrentUser() user: any) {
    return this.departmentsService.findAllForCompany(user.companyId);
  }
}