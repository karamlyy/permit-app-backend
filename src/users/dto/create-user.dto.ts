import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
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
    description: `
İstifadəçi rolu:
- EMPLOYEE
- MANAGER
- HEAD_OF_DEPARTMENT → departmentId mütləq olmalıdır
- HR
- HEAD_OF_HR → HR departamentinə bağlı olmalıdır (departmentId mütləq)
COMPANY_ADMIN buradan yaradıla bilməz.
`,
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
    description: `
User-in department ID-si:
- EMPLOYEE: optional
- MANAGER: optional
- HR: optional (amma şirkətdə HR departamenti varsa, bura yazılır)
- HEAD_OF_DEPARTMENT: MÜTLƏQ
- HEAD_OF_HR: MÜTLƏQ (və departament HR departamenti olmalıdır)
`,
  })
  @IsOptional()
  @IsInt()
  departmentId?: number;
}