import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateCompanyPolicyDto {
  @ApiPropertyOptional({
    example: 21,
    description: 'İllik məzuniyyət günləri (şirkət üzrə)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  annualLeaveDaysPerYear?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Şirkətdə ümumiyyətlə remote work icazəsi var?',
  })
  @IsOptional()
  @IsBoolean()
  hasRemoteWork?: boolean;

  @ApiPropertyOptional({
    example: 5,
    description: 'Ay ərzində maksimal remote günləri',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxRemoteDaysPerMonth?: number;

  @ApiPropertyOptional({
    example: 8,
    description: 'Short leave üçün aylıq maksimal saat limiti',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxShortLeaveHoursPerMonth?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Tarix overlap-na icazə verilsin?',
  })
  @IsOptional()
  @IsBoolean()
  allowOverlap?: boolean;

  @ApiPropertyOptional({
    example: 14,
    description:
      'ANNUAL_LEAVE üçün minimal əvvəlcədən xəbərdarlıq müddəti (günlə). 0 = limit yoxdur.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minAdvanceDaysForAnnualLeave?: number;
}