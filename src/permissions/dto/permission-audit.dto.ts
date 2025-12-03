import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/user-role.enum';
import { PermissionAuditAction } from '../../common/enums/permission-audit-action.enum';
import { PermissionAuditResult } from '../../common/enums/permission-audit-result.enum';
import { PermissionStatus } from '../../common/enums/permission-status.enum';

export class PermissionAuditActorDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Ali Məmmədov' })
  name: string;

  @ApiProperty({ example: 'ali@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.MANAGER })
  role: UserRole;
}

export class PermissionAuditDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: PermissionAuditAction, example: PermissionAuditAction.APPROVE })
  action: PermissionAuditAction;

  @ApiProperty({ enum: PermissionAuditResult, example: PermissionAuditResult.SUCCESS })
  result: PermissionAuditResult;

  @ApiProperty({
    enum: PermissionStatus,
    nullable: true,
    example: PermissionStatus.PENDING,
  })
  previousStatus?: PermissionStatus | null;

  @ApiProperty({
    enum: PermissionStatus,
    nullable: true,
    example: PermissionStatus.APPROVED,
  })
  newStatus?: PermissionStatus | null;

  @ApiProperty({
    example: 'Manager başqa departament üçün approve etməyə cəhd etdi',
    nullable: true,
  })
  reason?: string | null;

  @ApiProperty({ type: String, example: '2025-11-27T12:34:56.000Z' })
  createdAt: Date;

  @ApiProperty({
    type: () => PermissionAuditActorDto,
    nullable: true,
    description: 'Əməliyyatı edən istifadəçi (actor)',
  })
  actor?: PermissionAuditActorDto | null;
}