import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserPolicyDto } from './dto/update-user-policy.dto';
import { SearchUsersDto } from './dto/search-users.dto';

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary:
      'HR və ya Company Admin şirkət daxilində yeni istifadəçi (HR/MANAGER/EMPLOYEE) yaradır',
  })
  @ApiCreatedResponse({
    description: 'İstifadəçi yaradıldı',
    type: UserResponseDto,
  })
  create(
    @CurrentUser() currentUser: any,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createUserForCompany(currentUser, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'İstifadəçini soft delete (status = INACTIVE) edir',
  })
  @ApiOkResponse({
    description: 'İstifadəçi deaktiv edildi',
    type: UserResponseDto,
  })
  deactivate(
    @CurrentUser() currentUser: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.deactivateUser(
      { companyId: currentUser.companyId, role: currentUser.role },
      id,
    );
  }

  @Patch(':id/activate')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'İstifadəçini yenidən aktiv (status = ACTIVE) edir',
  })
  @ApiOkResponse({
    description: 'İstifadəçi aktiv edildi',
    type: UserResponseDto,
  })
  activate(
    @CurrentUser() currentUser: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.activateUser(
      { companyId: currentUser.companyId, role: currentUser.role },
      id,
    );
  }


  @Patch(':id/policy')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary:
      'İşçi üçün fərdi icazə policy-lərini (illik məzuniyyət, remote limiti və s.) override et',
  })
  @ApiOkResponse({
    description: 'İstifadəçinin policy-si yeniləndi',
    type: UserResponseDto,
  })
  updatePolicy(
    @CurrentUser() currentUser: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserPolicyDto,
  ) {
    return this.usersService.updateUserPolicy(
      { companyId: currentUser.companyId, role: currentUser.role },
      id,
      dto,
    );
  }

  @Get('admin/search')
  @Roles(UserRole.COMPANY_ADMIN, UserRole.HR)
  @ApiOperation({
    summary: 'User search (role, status, ad/email üzrə axtarış)',
  })
  @ApiOkResponse({
    description: 'Filtrlənmiş istifadəçi siyahısı qaytarılır',
  })
  searchUsers(
    @CurrentUser() user: any,
    @Query() query: SearchUsersDto,
  ) {
    return this.usersService.searchUsers(
      {
        userId: user.userId,
        companyId: user.companyId,
        role: user.role,
      },
      query,
    );
  }
  
}