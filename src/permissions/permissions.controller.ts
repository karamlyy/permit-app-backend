import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { ApprovePermissionDto } from './dto/approve-permission.dto';
import { RejectPermissionDto } from './dto/reject-permission.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@ApiTags('permissions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  // Employee özün üçün icazə yaradır
  @Post()
  @Roles(
    UserRole.EMPLOYEE,
    UserRole.MANAGER,
    UserRole.HR,
    UserRole.COMPANY_ADMIN,
  )
  @ApiOperation({ summary: 'Hazırkı istifadəçi üçün yeni icazə yaradır' })
  @ApiCreatedResponse({ description: 'İcazə yaradıldı' })
  create(
    @CurrentUser() user: any,
    @Body() dto: CreatePermissionDto,
  ) {
    return this.permissionsService.createForEmployee(
      { userId: user.userId, companyId: user.companyId },
      dto,
    );
  }

  // Öz icazələrini gör
  @Get('me')
  @Roles(
    UserRole.EMPLOYEE,
    UserRole.MANAGER,
    UserRole.HR,
    UserRole.COMPANY_ADMIN,
  )
  @ApiOperation({ summary: 'Hazırkı istifadəçinin bütün icazələrini qaytarır' })
  @ApiOkResponse({ description: 'İcazələr siyahısı qaytarıldı' })
  findMy(@CurrentUser() user: any) {
    return this.permissionsService.findMyPermissions({
      userId: user.userId,
    });
  }

  // Approver-lər üçün şirkət icazələri
  @Get('company')
  @Roles(
    UserRole.COMPANY_ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
  )
  @ApiOperation({
    summary:
      'Şirkət üçün icazə siyahısı (Admin & HR bütün, Manager yalnız öz departamenti',
  })
  @ApiOkResponse({ description: 'İcazələr siyahısı qaytarıldı' })
  findForCompany(@CurrentUser() user: any) {
    return this.permissionsService.findCompanyPermissionsForApprover({
      userId: user.userId,
      companyId: user.companyId,
      role: user.role,
    });
  }

  // APPROVE
  @Post(':id/approve')
  @Roles(
    UserRole.COMPANY_ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
  )
  @ApiOperation({ summary: 'İcazəni təsdiqləyir' })
  @ApiOkResponse({ description: 'İcazə təsdiqləndi' })
  approve(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApprovePermissionDto,
  ) {
    return this.permissionsService.approve(
      {
        userId: user.userId,
        companyId: user.companyId,
        role: user.role,
      },
      id,
      dto,
    );
  }

  // REJECT
  @Post(':id/reject')
  @Roles(
    UserRole.COMPANY_ADMIN,
    UserRole.HR,
    UserRole.MANAGER,
  )
  @ApiOperation({ summary: 'İcazəni rədd edir' })
  @ApiOkResponse({ description: 'İcazə rədd edildi' })
  reject(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectPermissionDto,
  ) {
    return this.permissionsService.reject(
      {
        userId: user.userId,
        companyId: user.companyId,
        role: user.role,
      },
      id,
      dto,
    );
  }
}