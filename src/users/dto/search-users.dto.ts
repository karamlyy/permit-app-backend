import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

export class SearchUsersDto {
  @ApiPropertyOptional({
    enum: UserRole,
    description: 'Filtrləmək üçün rol (EMPLOYEE, MANAGER, HR, COMPANY_ADMIN və s.)',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Ad və ya email üzrə text search',
    example: 'Ali',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: UserStatus,
    description: 'İstəyə görə statusa görə filter (ACTIVE, INACTIVE və s.)',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}