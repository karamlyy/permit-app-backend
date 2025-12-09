import { ApiProperty } from '@nestjs/swagger';
import { PermissionType } from '../../common/enums/permission-type.enum';
import { PermissionStatus } from '../../common/enums/permission-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';

export class PermissionListItemDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: PermissionType })
  type: PermissionType;

  @ApiProperty({ enum: PermissionStatus })
  status: PermissionStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  employeeName: string;

  @ApiProperty()
  employeeEmail: string;

  @ApiProperty({ required: false, nullable: true })
  employeeDepartmentName?: string;

  @ApiProperty({
    enum: UserRole,
    nullable: true,
    description: 'Hazırda approval chain-də növbəti rol (kimdədir?)',
  })
  currentHolderRole: UserRole | null;

  @ApiProperty({
    description: 'Hazırkı istifadəçi üçün bu icazədə indi hərəkət tələb olunurmu?',
  })
  isMyTurn: boolean;
}