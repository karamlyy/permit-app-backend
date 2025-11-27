import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionType } from '../../common/enums/permission-type.enum';

export class CreatePermissionDto {
  @ApiProperty({ enum: PermissionType, example: PermissionType.ANNUAL_LEAVE })
  @IsEnum(PermissionType)
  type: PermissionType;

  @ApiProperty({ example: '2025-05-10' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: '2025-05-15' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @IsOptional()
  @IsString()
  startTime?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @IsString()
  endTime?: string;

  @ApiPropertyOptional({ example: 'Ailəvi səbəblərdən...' })
  @IsOptional()
  @IsString()
  reason?: string;
}