import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { Department } from '../departments/department.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { UserResponseDto } from './dto/user-response.dto';
import { UserStatus } from 'src/common/enums/user-status.enum';
import { UpdateUserPolicyDto } from './dto/update-user-policy.dto';
import { SearchUsersDto } from './dto/search-users.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
  ) { }

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
    // 0) Kim user yarada bilər? → COMPANY_ADMIN və HEAD_OF_HR
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'İstifadəçi yaratmaq üçün səlahiyyət yoxdur (yalnız COMPANY_ADMIN və HEAD_OF_HR).',
      );
    }

    // Bu endpoint-dən COMPANY_ADMIN yaratmağı qadağan edirik
    if (dto.role === UserRole.COMPANY_ADMIN) {
      throw new ForbiddenException(
        'Company Admin yalnız şirkət qeydiyyatı zamanı yaradıla bilər',
      );
    }

    const existing = await this.usersRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('Bu email artıq istifadə olunur');
    }

    // ⭐ Department: Department | undefined saxlayırıq (null yox!)
    let department: Department | undefined = undefined;

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

    // HEAD_OF_DEPARTMENT üçün departament mütləqdir
    if (dto.role === UserRole.HEAD_OF_DEPARTMENT && !department) {
      throw new BadRequestException(
        'HEAD_OF_DEPARTMENT üçün departmentId mütləq verilməlidir',
      );
    }

    // HEAD_OF_HR üçün → HR departamentində olmalıdır
    if (dto.role === UserRole.HEAD_OF_HR) {
      if (!department) {
        throw new BadRequestException(
          'HEAD_OF_HR üçün HR departamentinin ID-si mütləq verilməlidir',
        );
      }

      const name = department.name.toLowerCase().trim();
      const isHrDept =
        name === 'hr' ||
        name === 'human resources' ||
        name === 'hr department';

      if (!isHrDept) {
        throw new BadRequestException(
          'HEAD_OF_HR yalnız HR departamentinə təyin oluna bilər',
        );
      }
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
      department,
      status: UserStatus.ACTIVE,
    });

    const saved = await this.usersRepo.save(user);

    // MANAGER → departamentin manager-i
    if (saved.role === UserRole.MANAGER && department) {
      department.manager = saved;
      await this.deptRepo.save(department);
    }

    // HEAD_OF_DEPARTMENT → departamentin headOfDepartment-i
    if (saved.role === UserRole.HEAD_OF_DEPARTMENT && department) {
      department.headOfDepartment = saved;
      await this.deptRepo.save(department);
    }

    // HEAD_OF_HR üçün ayrıca department-linkə ehtiyac yoxdur,
    // companyId + role = HEAD_OF_HR ilə tapırsan.

    return this.toUserResponse(saved);
  }

  async deactivateUser(
    currentUser: { companyId: number; role: UserRole },
    userId: number,
  ): Promise<UserResponseDto> {
    // Yalnız COMPANY_ADMIN və HEAD_OF_HR bu servisi çağırmalıdır
    // (Controller-də Roles ilə qoruyuruq, amma burada da əlavə qoruma pis deyil)
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'İstifadəçini deaktiv etmək üçün səlahiyyət yoxdur',
      );
    }

    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['company'],
    });

    if (!user || user.company.id !== currentUser.companyId) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    // ⭐ COMPANY_ADMIN yalnız COMPANY_ADMIN tərəfindən deaktiv oluna bilər
    if (
      user.role === UserRole.COMPANY_ADMIN &&
      currentUser.role !== UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'Company Admin istifadəçisini yalnız Company Admin deaktiv edə bilər',
      );
    }

    user.status = UserStatus.INACTIVE;
    const saved = await this.usersRepo.save(user);

    return this.toUserResponse(saved);
  }

  async activateUser(
    currentUser: { companyId: number; role: UserRole },
    userId: number,
  ): Promise<UserResponseDto> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HEAD_OF_HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'İstifadəçini aktiv etmək üçün səlahiyyət yoxdur',
      );
    }

    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['company'],
    });

    if (!user || user.company.id !== currentUser.companyId) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    // ⭐ COMPANY_ADMIN yalnız COMPANY_ADMIN tərəfindən aktiv oluna bilər
    if (
      user.role === UserRole.COMPANY_ADMIN &&
      currentUser.role !== UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'Company Admin istifadəçisini yalnız Company Admin aktiv edə bilər',
      );
    }

    user.status = UserStatus.ACTIVE;
    const saved = await this.usersRepo.save(user);

    return this.toUserResponse(saved);
  }

  async updateUserPolicy(
    currentUser: { companyId: number; role: UserRole },
    userId: number,
    dto: UpdateUserPolicyDto,
  ): Promise<UserResponseDto> {

    // ⭐ Bu əməliyyatı edə bilən rollar:
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HR,
        UserRole.HEAD_OF_HR
      ].includes(currentUser.role)
    ) {
      throw new ForbiddenException('Bu əməliyyat üçün səlahiyyət yoxdur');
    }

    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['company'],
    });

    if (!user || user.company.id !== currentUser.companyId) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    // ⭐ Company Admin policy-sini yalnız Company Admin dəyişə bilər
    if (
      user.role === UserRole.COMPANY_ADMIN &&
      currentUser.role !== UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'Company Admin istifadəçisinin policy-sini yalnız Company Admin dəyişə bilər',
      );
    }

    // ⭐ Head of HR və HR digər rolların policy-sini dəyişə bilirlər

    if (dto.customAnnualLeaveDaysPerYear !== undefined) {
      user.customAnnualLeaveDaysPerYear = dto.customAnnualLeaveDaysPerYear;
    }
    if (dto.customHasRemoteWork !== undefined) {
      user.customHasRemoteWork = dto.customHasRemoteWork;
    }
    if (dto.customMaxRemoteDaysPerMonth !== undefined) {
      user.customMaxRemoteDaysPerMonth = dto.customMaxRemoteDaysPerMonth;
    }
    if (dto.customMaxShortLeaveHoursPerMonth !== undefined) {
      user.customMaxShortLeaveHoursPerMonth =
        dto.customMaxShortLeaveHoursPerMonth;
    }

    const saved = await this.usersRepo.save(user);
    return this.toUserResponse(saved);
  }

  async searchUsers(
    currentUser: { userId: number; companyId: number; role: UserRole },
    dto: SearchUsersDto,
  ): Promise<User[]> {
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException(
        'İstifadəçilər üzrə axtarış üçün səlahiyyət yoxdur',
      );
    }

    const qb = this.usersRepo
      .createQueryBuilder('user')
      .leftJoin('user.company', 'company')
      .leftJoinAndSelect('user.department', 'department')
      .where('company.id = :companyId', { companyId: currentUser.companyId });

    if (dto.role) {
      qb.andWhere('user.role = :role', { role: dto.role });
    }

    if (dto.status) {
      qb.andWhere('user.status = :status', { status: dto.status });
    }

    if (dto.q) {
      qb.andWhere(
        '(LOWER(user.name) LIKE LOWER(:q) OR LOWER(user.email) LIKE LOWER(:q))',
        { q: `%${dto.q}%` },
      );
    }

    qb.orderBy('user.createdAt', 'DESC');

    return qb.getMany();
  }
}