import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-company')
  @ApiOperation({ summary: 'Yeni şirkət + ilk admin istifadəçi qeydiyyatı' })
  @ApiCreatedResponse({
    description:
      'Şirkət yaradıldı, admin user üçün access + refresh token qaytarıldı',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation xətası və ya email/şirkət artıq mövcuddur',
  })
  registerCompany(@Body() dto: RegisterCompanyDto): Promise<AuthResponseDto> {
    return this.authService.registerCompany(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'İstifadəçi login olub tokenlər almaq' })
  @ApiOkResponse({
    description: 'Login uğurludur, access + refresh token qaytarılır',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Email və ya şifrə yanlışdır',
  })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh token vasitəsilə yeni access və refresh token almaq',
  })
  @ApiOkResponse({
    description: 'Yeni access və refresh token qaytarılır',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token yanlışdır və ya vaxtı bitib',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'İstifadəçini sistemdən çıxar və refresh token-i etibarsız et',
  })
  @ApiOkResponse({ description: 'Uğurla logout olundu' })
  async logout(@CurrentUser() user: any): Promise<void> {
    await this.authService.logout(user.userId);
  }
}