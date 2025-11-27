import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/user-role.enum';

export class CreateUserDto {
  @ApiProperty({ example: 'Emin Məmmədov' })
  @IsString()
  @Length(3, 100)
  name: string;

  @ApiProperty({ example: 'emin@company.az' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @Length(6, 50)
  password: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.EMPLOYEE,
    description: 'Yeni istifadəçinin rolu (COMPANY_ADMIN olmamalıdır)',
  })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ example: 'Backend Developer' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @ApiPropertyOptional({
    example: 3,
    description: 'User-in aid olduğu department ID-si',
  })
  @IsOptional()
  @IsInt()
  departmentId?: number;
}