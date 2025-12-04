import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LeaveBalanceDto {
  @ApiProperty({ example: 2025 })
  year: number;

  @ApiProperty({
    example: 21,
    description: 'Bu il üçün illik məzuniyyət haqqı (günlə)',
  })
  entitlementDays: number;

  @ApiProperty({
    example: 5,
    description: 'Bu il təsdiqlənmiş icazələr üzrə istifadə olunmuş günlər',
  })
  usedDays: number;

  @ApiProperty({
    example: 3,
    description:
      'Bu il üçün PENDING / IN_PROGRESS olan icazələr üzrə gözləyən günlər',
  })
  pendingDays: number;

  @ApiProperty({
    example: 13,
    description: 'Bu il üçün qalan illik məzuniyyət günləri',
  })
  remainingDays: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Bu ay üçün APPROVED short leave üzrə istifadə olunmuş saatlar',
  })
  usedShortLeaveHoursThisMonth?: number;

  @ApiPropertyOptional({
    example: 6,
    description:
      'Bu ay üçün PENDING + APPROVED short leave nəzərə alınaraq qalan saatlar',
  })
  remainingShortLeaveHoursThisMonth?: number;
}