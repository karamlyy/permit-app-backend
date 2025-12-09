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
import { LeaveBalanceDto } from './dto/leave-balance.dto';
import { PermissionAuditDto } from './dto/permission-audit.dto';
import { PermissionDetailsDto } from './dto/permission-details.dto';
import { PermissionListItemDto } from './dto/permission-list-item.dto';

@ApiTags('permissions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) { }

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
    UserRole.HEAD_OF_DEPARTMENT,
    UserRole.HEAD_OF_HR,
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
    UserRole.HEAD_OF_DEPARTMENT,
    UserRole.HEAD_OF_HR,
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
    UserRole.HEAD_OF_HR,
    UserRole.HR,
    UserRole.HEAD_OF_DEPARTMENT,
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
    UserRole.HEAD_OF_HR,
    UserRole.HR,
    UserRole.HEAD_OF_DEPARTMENT,
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


  @Get('me/leave-balance')
  @ApiOperation({
    summary: 'Hazırkı istifadəçi üçün illik məzuniyyət balansı',
  })
  @ApiOkResponse({
    description: 'İllik məzuniyyət balansı qaytarılır',
    type: LeaveBalanceDto,
  })
  getMyLeaveBalance(@CurrentUser() user: any) {
    return this.permissionsService.getMyLeaveBalance({
      userId: user.userId,
      companyId: user.companyId,
    });
  }

  @Get('admin/users/:id/leave-balance')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR, UserRole.MANAGER, UserRole.HEAD_OF_DEPARTMENT, UserRole.HEAD_OF_HR)
  @ApiOperation({
    summary:
      'COMPANY_ADMIN/HEAD_OF_HR/HR/HEAD_OF_DEPARTMENT/MANAGER üçün verilmiş istifadəçinin illik məzuniyyət balansını qaytarır (USER_ID ilə)',
  })
  @ApiOkResponse({
    description: 'İstifadəçinin illik məzuniyyət balansı qaytarılır',
    type: LeaveBalanceDto,
  })
  getUserLeaveBalance(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.permissionsService.getUserLeaveBalanceForAdmin(
      {
        userId: user.userId,
        companyId: user.companyId,
        role: user.role,
      },
      id,
    );
  }

  @Get('admin/:id/audit-log')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR, UserRole.HR)
  @ApiOperation({
    summary:
      'Verilmiş permission üçün bütün audit log tarixçəsini qaytarır (approve/reject cəhdləri, success/fail)',
  })
  @ApiOkResponse({
    description: 'Audit log siyahısı qaytarılır',
    type: PermissionAuditDto,
    isArray: true,
  })
  getPermissionAuditLog(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PermissionAuditDto[]> {
    return this.permissionsService.getPermissionAuditLog(
      {
        userId: user.userId,
        companyId: user.companyId,
        role: user.role,
      },
      id,
    );
  }


  @Get(':id/details')
  @Roles(
    UserRole.EMPLOYEE,
    UserRole.MANAGER,
    UserRole.HEAD_OF_DEPARTMENT,
    UserRole.HR,
    UserRole.HEAD_OF_HR,
    UserRole.COMPANY_ADMIN,
  )
  @ApiOperation({
    summary: 'İcazənin tam detallarını qaytarır (chain, history, hazırda kimdədir)',
  })
  @ApiOkResponse({
    description: 'İcazə detalları qaytarılır',
    type: PermissionDetailsDto,
  })
  getPermissionDetails(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PermissionDetailsDto> {
    return this.permissionsService.getPermissionDetails(
      {
        userId: user.userId,
        companyId: user.companyId,
        role: user.role,
      },
      id,
    );
  }

  @Get('my-approval-queue')
  @Roles(
    UserRole.COMPANY_ADMIN,
    UserRole.HR,
    UserRole.HEAD_OF_HR,
    UserRole.MANAGER,
    UserRole.HEAD_OF_DEPARTMENT,
  )
  @ApiOperation({
    summary:
      'Hazırkı approver üçün hazırda onun növbəsində olan icazələr (approval queue)',
    description:
      'Bu endpoint yalnız sənin roluna görə növbəndə olan icazələri qaytarır. MANAGER/HEAD_OF_DEPARTMENT yalnız öz departament sahəsindəki icazələri görür.',
  })
  @ApiOkResponse({
    description: 'Approval queue qaytarılır',
    type: PermissionListItemDto,
    isArray: true,
  })
  getMyApprovalQueue(@CurrentUser() user: any) {
    return this.permissionsService.getMyApprovalQueue({
      userId: user.userId,
      companyId: user.companyId,
      role: user.role,
    });
  }


}