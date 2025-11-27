import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { Company } from '../companies/company.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { ApprovePermissionDto } from './dto/approve-permission.dto';
import { RejectPermissionDto } from './dto/reject-permission.dto';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { UserRole } from '../common/enums/user-role.enum';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
  ) {}

  // EMPLOYEE: özün üçün icazə yarat
  async createForEmployee(
    currentUser: { userId: number; companyId: number },
    dto: CreatePermissionDto,
  ): Promise<Permission> {
    const company = await this.companyRepo.findOne({
      where: { id: currentUser.companyId },
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }

    const employee = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
      relations: ['company'],
    });
    if (!employee || employee.company.id !== currentUser.companyId) {
      throw new ForbiddenException('İstifadəçi bu şirkətə aid deyil');
    }

    const perm = this.permRepo.create({
      company,
      employee,
      type: dto.type,
      startDate: dto.startDate,
      endDate: dto.endDate,
      startTime: dto.startTime,
      endTime: dto.endTime,
      reason: dto.reason,
      status: PermissionStatus.PENDING,
    });

    return this.permRepo.save(perm);
  }

  // EMPLOYEE: öz icazələrini gör
  async findMyPermissions(currentUser: { userId: number }): Promise<Permission[]> {
    return this.permRepo.find({
      where: { employee: { id: currentUser.userId } },
      relations: ['employee', 'approvedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  // APPROVER: şirkətin icazələrini gör
  async findCompanyPermissionsForApprover(
    currentUser: { userId: number; companyId: number; role: UserRole },
  ): Promise<Permission[]> {
    if (
      currentUser.role === UserRole.COMPANY_ADMIN ||
      currentUser.role === UserRole.HR
    ) {
      // HR & Admin bütün şirkəti görsün
      return this.permRepo.find({
        where: { company: { id: currentUser.companyId } },
        relations: ['employee', 'approvedBy'],
        order: { createdAt: 'DESC' },
      });
    }

    if (currentUser.role === UserRole.MANAGER) {
      // Manager yalnız öz departamentindəki işçiləri görsün
      const manager = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['managedDepartments'],
      });

      if (!manager) {
        throw new ForbiddenException('Manager tapılmadı');
      }

      const managedDeptIds = (manager.managedDepartments || []).map(
        (d) => d.id,
      );
      if (managedDeptIds.length === 0) {
        return [];
      }

      // Bu departamentlərdə olan işçilərin icazələri
      return this.permRepo
        .createQueryBuilder('perm')
        .leftJoinAndSelect('perm.employee', 'employee')
        .leftJoinAndSelect('perm.approvedBy', 'approvedBy')
        .leftJoin('employee.department', 'department')
        .leftJoin('perm.company', 'company')
        .where('company.id = :companyId', { companyId: currentUser.companyId })
        .andWhere('department.id IN (:...deptIds)', {
          deptIds: managedDeptIds,
        })
        .orderBy('perm.createdAt', 'DESC')
        .getMany();
    }

    throw new ForbiddenException('Bu əməliyyat üçün icazən yoxdur');
  }

  private async findOneInCompanyOrThrow(
    companyId: number,
    permissionId: number,
  ): Promise<Permission> {
    const perm = await this.permRepo.findOne({
      where: { id: permissionId },
      relations: ['company', 'employee', 'approvedBy'],
    });

    if (!perm || perm.company.id !== companyId) {
      throw new NotFoundException('İcazə tapılmadı');
    }

    return perm;
  }

  // APPROVE
  async approve(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: ApprovePermissionDto,
  ): Promise<Permission> {
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HR,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      throw new ForbiddenException('İcazə təsdiqi üçün səlahiyyət yoxdur');
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    if (perm.status !== PermissionStatus.PENDING) {
      throw new ForbiddenException(
        'Yalnız PENDING statusunda olan icazə təsdiqlənə bilər',
      );
    }

    const approver = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
    });

    perm.status = PermissionStatus.APPROVED;
    perm.approvedBy = approver ?? undefined;
    perm.managerComment = dto.managerComment;
    perm.decidedAt = new Date();

    return this.permRepo.save(perm);
  }

  // REJECT
  async reject(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
    dto: RejectPermissionDto,
  ): Promise<Permission> {
    if (
      ![
        UserRole.COMPANY_ADMIN,
        UserRole.HR,
        UserRole.MANAGER,
      ].includes(currentUser.role)
    ) {
      throw new ForbiddenException('İcazə rəddi üçün səlahiyyət yoxdur');
    }

    const perm = await this.findOneInCompanyOrThrow(
      currentUser.companyId,
      permissionId,
    );

    if (perm.status !== PermissionStatus.PENDING) {
      throw new ForbiddenException(
        'Yalnız PENDING statusunda olan icazə rədd edilə bilər',
      );
    }

    const approver = await this.usersRepo.findOne({
      where: { id: currentUser.userId },
    });

    perm.status = PermissionStatus.REJECTED;
    perm.approvedBy = approver ?? undefined;
    perm.managerComment = dto.managerComment;
    perm.decidedAt = new Date();

    return this.permRepo.save(perm);
  }
}