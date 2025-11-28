import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateUserPolicyDto {
  @ApiPropertyOptional({
    example: 28,
    description: 'Bu işçinin illik məzuniyyət günləri (override)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  customAnnualLeaveDaysPerYear?: number | null;

  @ApiPropertyOptional({
    example: false,
    description: 'Bu işçiyə remote ümumiyyətlə icazə verilsin?',
  })
  @IsOptional()
  @IsBoolean()
  customHasRemoteWork?: boolean | null;

  @ApiPropertyOptional({
    example: 10,
    description: 'Bu işçiyə ayda neçə remote gün icazə var? (override)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  customMaxRemoteDaysPerMonth?: number | null;

  @ApiPropertyOptional({
    example: 12,
    description: 'Bu işçinin aylıq short leave limitini (saatla) override et',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  customMaxShortLeaveHoursPerMonth?: number | null;
}