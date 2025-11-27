import { Body, Controller, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

@ApiTags('auth')
@Controller('auth')

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-company')
  @ApiOperation({ summary: 'Yeni şirkət + ilk admin istifadəçi qeydiyyatı' })
  @ApiCreatedResponse({
    description: 'Şirkət yaradıldı, admin user üçün access token qaytarıldı',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation xətası və ya email/şirkət artıq mövcuddur',
  })
  registerCompany(@Body() dto: RegisterCompanyDto): Promise<AuthResponseDto> {
    return this.authService.registerCompany(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'İstifadəçi login olub access token almaq' })
  @ApiOkResponse({
    description: 'Login uğurludur, access token qaytarılır',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Email və ya şifrə yanlışdır',
  })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }
}