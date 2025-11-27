import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { Department } from '../departments/department.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
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

  async createUserForCompany(
    currentUser: { companyId: number; role: UserRole },
    dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    if (
      currentUser.role === UserRole.HR &&
      dto.role === UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'HR yeni Company Admin yarada bilməz',
      );
    }

    const existing = await this.usersRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Bu email artıq istifadə olunur');
    }

    // ⭐ Burda typeni Department | null edirik
    let department: Department | null = null;

    if (dto.departmentId) {
      const found = await this.deptRepo.findOne({
        where: {
          id: dto.departmentId,
          company: { id: currentUser.companyId },
        },
        relations: ['company'],
      });

      if (!found) {
        throw new ForbiddenException(
          'Department tapılmadı və ya bu şirkətə aid deyil',
        );
      }

      department = found;
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      password: hashed,
      role: dto.role,
      position: dto.position,
      hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      company: { id: currentUser.companyId } as any,
      // Burda da null-u undefined-ə çeviririk
      department: department ?? undefined,
    });

    const saved = await this.usersRepo.save(user);
    return this.toUserResponse(saved);


    
  }
}