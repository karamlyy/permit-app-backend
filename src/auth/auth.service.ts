import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { LoginDto } from './dto/login.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { UserStatus } from 'src/common/enums/user-status.enum';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  private toUserResponse(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.name = user.name;
    dto.email = user.email;
    dto.role = user.role;
    dto.position = user.position;
    dto.hireDate = user.hireDate;
    dto.status = user.status;
    return dto;
  }

  private signAccessToken(user: User): Promise<string> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company.id,
    };
    return this.jwtService.signAsync(payload);
  }

  private signRefreshToken(user: User): Promise<string> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company.id,
    };

    const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const secret = process.env.JWT_REFRESH_SECRET || 'refresh_secret';

    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: expiresIn as any,
    });
  }

  // JWT_REFRESH_EXPIRES_IN-ə görə DB üçün expiry hesablayırıq (optional)
  private calcRefreshExpiry(): Date {
    const raw = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    const now = Date.now();
    let ms = 0;

    if (typeof raw === 'string' && raw.endsWith('d')) {
      const days = parseInt(raw.slice(0, -1), 10) || 7;
      ms = days * 24 * 60 * 60 * 1000;
    } else if (typeof raw === 'string' && raw.endsWith('s')) {
      const seconds = parseInt(raw.slice(0, -1), 10) || 0;
      ms = seconds * 1000;
    } else {
      const seconds = Number(raw) || 0;
      ms = seconds * 1000;
    }

    return new Date(now + ms);
  }

  private async persistRefreshToken(user: User, rawToken: string): Promise<void> {
    const hash = await bcrypt.hash(rawToken, 10);
    user.refreshToken = hash;
    user.refreshTokenExpires = this.calcRefreshExpiry();
    await this.usersRepo.save(user);
  }

  private async buildAuthResponseWithTokens(
    user: User,
  ): Promise<AuthResponseDto> {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user);

    // ⭐ refresh token-i DB-də hash ilə saxla
    await this.persistRefreshToken(user, refreshToken);

    const res = new AuthResponseDto();
    res.user = this.toUserResponse(user);
    res.accessToken = accessToken;
    res.refreshToken = refreshToken;

    return res;
  }

  async registerCompany(dto: RegisterCompanyDto): Promise<AuthResponseDto> {
    const existingUser = await this.usersRepo.findOne({
      where: { email: dto.adminEmail },
    });
    if (existingUser) {
      throw new BadRequestException('Bu email artıq istifadə olunur');
    }

    const existingCompany = await this.companiesRepo.findOne({
      where: { name: dto.companyName },
    });
    if (existingCompany) {
      throw new BadRequestException('Bu adda şirkət artıq mövcuddur');
    }

    const company = this.companiesRepo.create({
      name: dto.companyName,
      timezone: dto.timezone,
    });
    await this.companiesRepo.save(company);

    const hashedPassword = await bcrypt.hash(dto.adminPassword, 10);

    const adminUser = this.usersRepo.create({
      name: dto.adminName,
      email: dto.adminEmail,
      password: hashedPassword,
      role: UserRole.COMPANY_ADMIN,
      company,
    });

    await this.usersRepo.save(adminUser);

    return this.buildAuthResponseWithTokens(adminUser);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersRepo.findOne({
      where: { email: dto.email },
      relations: ['company'],
    });

    if (!user) {
      throw new UnauthorizedException('Email və ya şifrə yanlışdır');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Email və ya şifrə yanlışdır');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        'İstifadəçi deaktiv edilib, sistemə giriş icazəsi yoxdur',
      );
    }

    // login zamanı da refresh token rotate olunur
    return this.buildAuthResponseWithTokens(user);
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token təqdim edilməyib');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      });
    } catch (error) {
      throw new UnauthorizedException(
        'Refresh token yanlışdır və ya vaxtı bitib',
      );
    }

    const user = await this.usersRepo.findOne({
      where: { id: payload.sub },
      relations: ['company'],
    });

    if (!user) {
      throw new UnauthorizedException('İstifadəçi tapılmadı');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        'İstifadəçi deaktiv edilib, sistemə giriş icazəsi yoxdur',
      );
    }

    // ⭐ DB-də saxlanan hash-lə müqayisə
    if (!user.refreshToken) {
      throw new UnauthorizedException('Refresh token artıq etibarlı deyil');
    }

    const isSame = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!isSame) {
      // Burada istəsən "token reuse" detection loglaya bilərsən
      throw new UnauthorizedException('Refresh token artıq etibarlı deyil');
    }

    if (user.refreshTokenExpires && user.refreshTokenExpires < new Date()) {
      throw new UnauthorizedException(
        'Refresh token müddəti bitib (DB expiry).',
      );
    }

    // Burada rotation edirik: yeni access + yeni refresh + DB-də hash yenilənir
    return this.buildAuthResponseWithTokens(user);
  }

  async logout(userId: number): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) return;
    user.refreshToken = null;
    user.refreshTokenExpires = null;
    await this.usersRepo.save(user);
  }
}