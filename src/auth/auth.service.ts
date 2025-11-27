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

  private buildAuthResponse(user: User, accessToken: string): AuthResponseDto {
    const res = new AuthResponseDto();
    res.user = this.toUserResponse(user);
    res.accessToken = accessToken;
    return res;
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

    const token = await this.signAccessToken(adminUser);

    return this.buildAuthResponse(adminUser, token);
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

    const token = await this.signAccessToken(user);
    return this.buildAuthResponse(user, token);
  }
}