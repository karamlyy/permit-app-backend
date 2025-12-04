// src/users/users.controller.ts
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPolicyDto } from './dto/update-user-policy.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  // ─────────────────────────────────────────────
  //  POST /admin/users → şirkət daxilində yeni user yarat
  // ─────────────────────────────────────────────
  @Post('admin/users')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR)
  @ApiOperation({
    summary: 'Şirkət daxilində yeni istifadəçi yarat',
    description: `
COMPANY_ADMIN və HEAD_OF_HR bu endpoint vasitəsilə aşağıdakı rolları yarada bilər:

- EMPLOYEE
- MANAGER
- HEAD_OF_DEPARTMENT
- HR
- HEAD_OF_HR

Qeyd: COMPANY_ADMIN bu endpoint ilə COMPANY_ADMIN yarada bilməz.
  `,
  })
  @ApiCreatedResponse({
    description: 'İstifadəçi uğurla yaradıldı',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Validation xətası, email artıq istifadə olunur və ya role/departament uyğun deyil',
  })
  @ApiForbiddenResponse({
    description: 'Səlahiyyət yoxdur',
  })
  createUser(
    @CurrentUser() currentUser: any,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.createUserForCompany(
      { companyId: currentUser.companyId, role: currentUser.role },
      dto,
    );
  }

  // ─────────────────────────────────────────────
  //  PATCH /admin/users/:id/deactivate → user-i soft deactivate
  // ─────────────────────────────────────────────
  @Patch('admin/users/:id/deactivate')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR)
  @ApiOperation({
    summary: 'İstifadəçini deaktiv et (soft delete)',
    description:
      'Status INACTIVE olur və bu istifadəçi artıq login ola bilmir.',
  })
  @ApiOkResponse({
    description: 'İstifadəçi deaktiv edildi',
    type: UserResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'COMPANY_ADMIN və ya HEAD_OF_HR olmayan istifadəçi bu əməliyyatı edə bilməz',
  })
  deactivateUser(
    @CurrentUser() currentUser: any,
    @Param('id', ParseIntPipe) userId: number,
  ): Promise<UserResponseDto> {
    return this.usersService.deactivateUser(
      { companyId: currentUser.companyId, role: currentUser.role },
      userId,
    );
  }

  // ─────────────────────────────────────────────
  //  PATCH /admin/users/:id/activate → user-i yenidən aktiv et
  // ─────────────────────────────────────────────
  @Patch('admin/users/:id/activate')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR)
  @ApiOperation({
    summary: 'Deaktiv istifadəçini yenidən aktiv et',
  })
  @ApiOkResponse({
    description: 'İstifadəçi aktiv edildi',
    type: UserResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'COMPANY_ADMIN və ya HEAD_OF_HR olmayan istifadəçi bu əməliyyatı edə bilməz',
  })
  activateUser(
    @CurrentUser() currentUser: any,
    @Param('id', ParseIntPipe) userId: number,
  ): Promise<UserResponseDto> {
    return this.usersService.activateUser(
      { companyId: currentUser.companyId, role: currentUser.role },
      userId,
    );
  }

  // ─────────────────────────────────────────────
  //  PATCH /admin/users/:id/policy → user üçün fərdi leave/remote policy
  // ─────────────────────────────────────────────
  @Patch('admin/users/:id/policy')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR, UserRole.HEAD_OF_HR)
  @ApiOperation({
    summary: 'Konkret istifadəçi üçün fərdi icazə policy-lərini yenilə',
    description: `
Bu endpoint ilə user səviyyəsində aşağıdakı limitlər override olunur:
- illik məzuniyyət günlərinin sayı (annual leave)
- aylıq remote gün limiti
- aylıq short leave saat limiti

Səlahiyyətli rollar:
- COMPANY_ADMIN
- HEAD_OF_HR
- HR

Qeyd: Company Admin istifadəçisinin policy-sini yalnız Company Admin dəyişə bilər (service səviyyəsində yoxlanılır).
`,
  })
  @ApiOkResponse({
    description: 'İstifadəçi policy-si yeniləndi',
    type: UserResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'COMPANY_ADMIN, HEAD_OF_HR və ya HR olmayan istifadəçi bu əməliyyatı edə bilməz',
  })
  updateUserPolicy(
    @CurrentUser() currentUser: any,
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserPolicyDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateUserPolicy(
      { companyId: currentUser.companyId, role: currentUser.role },
      userId,
      dto,
    );
  }

  // ─────────────────────────────────────────────
  //  GET /admin/users/search → HR/Admin üçün axtarış
  // ─────────────────────────────────────────────
  @Get('admin/users/search')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'Şirkət daxilində istifadəçilər üzrə axtarış',
    description: `
Filter-lər:
- role (EMPLOYEE, MANAGER, HR, və s.)
- status (ACTIVE / INACTIVE)
- q → ad və ya email üzrə text search`,
  })
  @ApiOkResponse({
    description: 'Axtarış nəticəsi',
  })
  @ApiForbiddenResponse({
    description: 'HR / Company Admin olmayan istifadəçi axtarış edə bilməz',
  })
  searchUsers(
    @CurrentUser() currentUser: any,
    @Query() dto: SearchUsersDto,
  ) {
    return this.usersService.searchUsers(
      {
        userId: currentUser.userId,
        companyId: currentUser.companyId,
        role: currentUser.role,
      },
      dto,
    );
  }
}