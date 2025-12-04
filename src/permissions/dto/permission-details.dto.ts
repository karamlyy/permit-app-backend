import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionType } from '../../common/enums/permission-type.enum';
import { PermissionStatus } from '../../common/enums/permission-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';

export class PermissionEmployeeDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    name: string;

    @ApiProperty()
    email: string;

    @ApiPropertyOptional()
    departmentName?: string;
}

export class PermissionApprovalStepDto {
    @ApiProperty({ example: 1 })
    stepNumber: number;

    @ApiProperty({ enum: UserRole })
    role: UserRole;

    @ApiProperty({ enum: PermissionStatus })
    status: PermissionStatus;

    @ApiPropertyOptional()
    approverName?: string;

    @ApiPropertyOptional()
    approverEmail?: string;

    @ApiPropertyOptional()
    comment?: string;

    @ApiPropertyOptional()
    actedAt?: Date;
}

export class PermissionChainStepDto {
    @ApiProperty({ example: 1 })
    stepNumber: number;

    @ApiProperty({ enum: UserRole })
    role: UserRole;

    @ApiProperty()
    isCompleted: boolean;
}

export class PermissionDetailsDto {
    @ApiProperty()
    id: number;

    @ApiProperty({ enum: PermissionType })
    type: PermissionType;

    @ApiProperty({ enum: PermissionStatus })
    status: PermissionStatus;

    @ApiProperty()
    createdAt: Date;

    @ApiPropertyOptional()
    decidedAt?: Date;

    @ApiProperty()
    startDate: Date;

    @ApiPropertyOptional()
    endDate?: Date;

    @ApiPropertyOptional({
        description: 'SHORT_LEAVE üçün başlanğıc saatı, hh:mm formatında',
    })
    startTime?: string;

    @ApiPropertyOptional({
        description: 'SHORT_LEAVE üçün bitmə saatı, hh:mm formatında',
    })
    endTime?: string;

    @ApiPropertyOptional()
    reason?: string;

    @ApiPropertyOptional()
    comment?: string;

    @ApiProperty({ type: () => PermissionEmployeeDto })
    employee: PermissionEmployeeDto;

    @ApiPropertyOptional({
        description: 'Əgər icazə yekun təsdiq olunubsa, son approver',
    })
    finalApproverName?: string;

    @ApiPropertyOptional()
    finalApproverEmail?: string;

    @ApiPropertyOptional({ enum: UserRole, description: 'Hazırda növbə kimdədir (rol olaraq)' })
    currentHolderRole?: UserRole | null;

    @ApiProperty({
        type: () => PermissionChainStepDto,
        isArray: true,
        description: 'Approval chain (step-lər və rollar)',
    })
    chain: PermissionChainStepDto[];

    @ApiProperty({
        type: () => PermissionApprovalStepDto,
        isArray: true,
        description: 'İndiyə qədər tamamlanmış approval addımları',
    })
    approvals: PermissionApprovalStepDto[];
}