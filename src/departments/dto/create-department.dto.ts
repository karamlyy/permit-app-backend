import { IsInt, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'IT Department' })
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Bu departament üçün manager-in user ID-si',
  })
  @IsOptional()
  @IsInt()
  managerId?: number;
}