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
import { Company } from 'src/companies/company.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    //@InjectRepository(Company)
    //private readonly companyRepo: Repository<Company>,
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
    // HR COMPANY_ADMIN yarada bilməsin
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

    const hashed = await bcrypt.hash(dto.password, 10);

    // 🟢 Burda TypeORM üçün single obyekt create edirik
    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      password: hashed,
      role: dto.role,
      position: dto.position,
      hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      company: { id: currentUser.companyId } as any,
      department, // Department | undefined – null yoxdur
    });

    // 🟢 save(user) – array yox, tək obyekt
    const saved = await this.usersRepo.save(user);

    // ⭐ Əgər MANAGER-dirsə və department varsa → departamentin manager-i et
    if (saved.role === UserRole.MANAGER && department) {
      department.manager = saved;
      await this.deptRepo.save(department);
    }

    return this.toUserResponse(saved);
  }

  async deactivateUser(
    currentUser: { companyId: number; role: UserRole },
    userId: number,
  ): Promise<UserResponseDto> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['company'],
    });

    if (!user || user.company.id !== currentUser.companyId) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    // HR başqa COMPANY_ADMIN-i deaktiv edə bilməsin
    if (
      currentUser.role === UserRole.HR &&
      user.role === UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'HR Company Admin istifadəçisini deaktiv edə bilməz',
      );
    }

    // Özünü deaktiv etməyə icazə verib-verməmək sənə qalır, istəsən qadağan edə bilərik
    // if (currentUser.userId === user.id) { ... }

    user.status = UserStatus.INACTIVE;
    const saved = await this.usersRepo.save(user);

    return this.toUserResponse(saved);
  }

  async activateUser(
    currentUser: { companyId: number; role: UserRole },
    userId: number,
  ): Promise<UserResponseDto> {
    const user = await this.usersRepo.findOne({
      where: { id: userId },
      relations: ['company'],
    });

    if (!user || user.company.id !== currentUser.companyId) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    // HR yenə də COMPANY_ADMIN üzərində əməliyyat edə bilməsin
    if (
      currentUser.role === UserRole.HR &&
      user.role === UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'HR Company Admin istifadəçisini aktiv edə bilməz',
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
    // COMPANY_ADMIN və HR icazə verilir
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
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

    // HR Company Admin-i dəyişə bilməsin (istəsən, bunu da qoy)
    if (
      currentUser.role === UserRole.HR &&
      user.role === UserRole.COMPANY_ADMIN
    ) {
      throw new ForbiddenException(
        'HR Company Admin istifadəçisinin policy-sini dəyişə bilməz',
      );
    }

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
    // Kimlər axtarış edə bilər? HR & Admin üçün açıq saxlayaq
    if (
      ![UserRole.COMPANY_ADMIN, UserRole.HR].includes(currentUser.role)
    ) {
      throw new ForbiddenException('İstifadəçilər üzrə axtarış üçün səlahiyyət yoxdur');
    }

    const qb = this.usersRepo
      .createQueryBuilder('user')
      .leftJoin('user.company', 'company')
      .leftJoinAndSelect('user.department', 'department')
      .where('company.id = :companyId', { companyId: currentUser.companyId });

    // 🔹 Role-a görə filter (əsas hissə)
    if (dto.role) {
      qb.andWhere('user.role = :role', { role: dto.role });
    }

    // 🔹 Status filter (optional)
    if (dto.status) {
      qb.andWhere('user.status = :status', { status: dto.status });
    }

    // 🔹 Text search: name və email
    if (dto.q) {
      qb.andWhere(
        '(LOWER(user.name) LIKE LOWER(:q) OR LOWER(user.email) LIKE LOWER(:q))',
        { q: `%${dto.q}%` },
      );
    }

    // İstəsən orderBy əlavə edə bilərsən
    qb.orderBy('user.createdAt', 'DESC');

    return qb.getMany();
  }
}