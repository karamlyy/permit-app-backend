import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Karam Afandi' })
  name: string;

  @ApiProperty({ example: 'karam@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.COMPANY_ADMIN })
  role: UserRole;

  @ApiProperty({ example: 'Backend Developer', nullable: true })
  position?: string;

  @ApiProperty({ example: '2025-01-01', nullable: true })
  hireDate?: Date;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}