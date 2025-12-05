import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PermissionDetailsDto, PermissionApprovalStepDto, PermissionChainStepDto, PermissionEmployeeDto } from './dto/permission-details.dto';
import { PermissionStatus } from '../common/enums/permission-status.enum';
import { PermissionChainService } from './permission-chain.service';

@Injectable()
export class PermissionQueryService {
  constructor(
    @InjectRepository(Permission)
    private readonly permRepo: Repository<Permission>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly chainService: PermissionChainService,
  ) {}

  async findMyPermissions(currentUser: {
    userId: number;
  }): Promise<Permission[]> {
    return this.permRepo.find({
      where: { employee: { id: currentUser.userId } },
      relations: ['employee', 'approvedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async findCompanyPermissionsForApprover(
    currentUser: { userId: number; companyId: number; role: UserRole },
  ): Promise<Permission[]> {
    // 1) Bütün şirkəti görə bilən rollar: COMPANY_ADMIN, HR, HEAD_OF_HR
    if (
      currentUser.role === UserRole.COMPANY_ADMIN ||
      currentUser.role === UserRole.HR ||
      currentUser.role === UserRole.HEAD_OF_HR
    ) {
      return this.permRepo.find({
        where: { company: { id: currentUser.companyId } },
        relations: ['employee', 'approvedBy'],
        order: { createdAt: 'DESC' },
      });
    }

    // 2) HEAD_OF_DEPARTMENT → yalnız öz departamentindəki işçilər
    if (currentUser.role === UserRole.HEAD_OF_DEPARTMENT) {
      const head = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['headedDepartments'],
      });

      if (!head) {
        throw new ForbiddenException('Head of Department tapılmadı');
      }

      const headedDeptIds = (head.headedDepartments || []).map((d) => d.id);

      if (headedDeptIds.length === 0) {
        // hec bir departamentə head təyin olunmayıbsa, görəcəyi icazə yoxdur
        return [];
      }

      return this.permRepo
        .createQueryBuilder('perm')
        .leftJoinAndSelect('perm.employee', 'employee')
        .leftJoinAndSelect('perm.approvedBy', 'approvedBy')
        .leftJoin('employee.department', 'department')
        .leftJoin('perm.company', 'company')
        .where('company.id = :companyId', {
          companyId: currentUser.companyId,
        })
        .andWhere('department.id IN (:...deptIds)', {
          deptIds: headedDeptIds,
        })
        .orderBy('perm.createdAt', 'DESC')
        .getMany();
    }

    // 3) MANAGER → yalnız öz idarə etdiyi departamentlər
    if (currentUser.role === UserRole.MANAGER) {
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

      return this.permRepo
        .createQueryBuilder('perm')
        .leftJoinAndSelect('perm.employee', 'employee')
        .leftJoinAndSelect('perm.approvedBy', 'approvedBy')
        .leftJoin('employee.department', 'department')
        .leftJoin('perm.company', 'company')
        .where('company.id = :companyId', {
          companyId: currentUser.companyId,
        })
        .andWhere('department.id IN (:...deptIds)', {
          deptIds: managedDeptIds,
        })
        .orderBy('perm.createdAt', 'DESC')
        .getMany();
    }

    // 4) Qalan bütün rollar üçün qadağandır
    throw new ForbiddenException('Bu əməliyyat üçün icazən yoxdur');
  }

  async findOneInCompanyOrThrow(
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

  async getPermissionDetails(
    currentUser: { userId: number; companyId: number; role: UserRole },
    permissionId: number,
  ): Promise<PermissionDetailsDto> {
    // 1) İcazəni şirkət scope-u ilə tap
    const perm = await this.permRepo.findOne({
      where: { id: permissionId },
      relations: ['company', 'employee', 'employee.department', 'approvedBy'],
    });

    if (!perm || perm.company.id !== currentUser.companyId) {
      throw new NotFoundException('İcazə tapılmadı');
    }

    // 2) Access control:
    const isOwner = perm.employee.id === currentUser.userId;

    const approverRoles: UserRole[] = [
      UserRole.COMPANY_ADMIN,
      UserRole.HR,
      UserRole.HEAD_OF_HR,
      UserRole.MANAGER,
      UserRole.HEAD_OF_DEPARTMENT,
    ];

    const isApproverRole = approverRoles.includes(currentUser.role);

    if (!isOwner && !isApproverRole) {
      throw new ForbiddenException(
        'Bu icazənin detallarını görməyə səlahiyyətin yoxdur',
      );
    }

    // Manager / Head_of_Department üçün departament scope check
    if (
      isApproverRole &&
      (currentUser.role === UserRole.MANAGER ||
        currentUser.role === UserRole.HEAD_OF_DEPARTMENT)
    ) {
      const viewer = await this.usersRepo.findOne({
        where: { id: currentUser.userId },
        relations: ['managedDepartments', 'headedDepartments'],
      });

      if (!viewer) {
        throw new ForbiddenException('İstifadəçi tapılmadı');
      }

      const managedDeptIds =
        (viewer.managedDepartments || []).map((d) => d.id);

      const headedDeptIds = (viewer.headedDepartments || []).map((d) => d.id);

      const allowedDeptIds = [...managedDeptIds, ...headedDeptIds];

      const employeeDeptId = perm.employee.department?.id;

      if (!employeeDeptId || !allowedDeptIds.includes(employeeDeptId)) {
        throw new ForbiddenException(
          'Bu icazə üzrə bu istifadəçi üçün detala baxmağa səlahiyyətin yoxdur (başqa departament).',
        );
      }
    }

    // 3) Chain + history
    const chainRoles = await this.chainService.getApprovalChainForPermission(
      perm.company.id,
      perm.employee,
      perm.type,
    );

    const history = await this.chainService.getApprovalHistory(perm.id); // PermissionApproval[] ASC

    const approvals: PermissionApprovalStepDto[] = history.map((h) => ({
      stepNumber: h.stepNumber,
      role: h.role,
      status: h.status,
      approverName: h.approver?.name,
      approverEmail: h.approver?.email,
      comment: h.comment ?? undefined,
      // Entity-də createdAt TS tərəfdə deklarasiya olunmayıbsa:
      actedAt: (h as any).createdAt ?? undefined,
    }));

    const chain: PermissionChainStepDto[] = chainRoles.map((role, index) => ({
      stepNumber: index + 1,
      role,
      isCompleted: history.some((h) => h.stepNumber === index + 1),
    }));

    // 4) Hazırkı holder rolu (son step tamam olmayıbsa)
    const isFinished =
      perm.status === PermissionStatus.APPROVED ||
      perm.status === PermissionStatus.REJECTED;

    let currentHolderRole: UserRole | null = null;

    if (!isFinished) {
      const nextStepIndex = history.length; // 0-based
      currentHolderRole = chainRoles[nextStepIndex] ?? null;
    }

    // 5) Employee DTO
    const employeeDto: PermissionEmployeeDto = {
      id: perm.employee.id,
      name: perm.employee.name,
      email: perm.employee.email,
      departmentName: perm.employee.department?.name,
    };

    // 6) Final approver (ancaq APPROVED üçün)
    const finalApproverName =
      perm.status === PermissionStatus.APPROVED && perm.approvedBy
        ? perm.approvedBy.name
        : undefined;

    const finalApproverEmail =
      perm.status === PermissionStatus.APPROVED && perm.approvedBy
        ? perm.approvedBy.email
        : undefined;

    // 7) Nəticə DTO
    const details = new PermissionDetailsDto();
    details.id = perm.id;
    details.type = perm.type;
    details.status = perm.status;
    details.createdAt = perm.createdAt;
    details.decidedAt = perm.decidedAt ?? undefined;
    details.startDate = perm.startDate;
    details.endDate = perm.endDate ?? undefined;
    details.startTime = perm.startTime ?? undefined;
    details.endTime = perm.endTime ?? undefined;
    details.reason = perm.reason ?? undefined;
    details.comment = perm.comment ?? undefined;
    details.employee = employeeDto;
    details.finalApproverName = finalApproverName;
    details.finalApproverEmail = finalApproverEmail;
    details.currentHolderRole = currentHolderRole;
    details.chain = chain;
    details.approvals = approvals;

    return details;
  }
}

