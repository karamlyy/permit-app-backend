import { ApiProperty } from '@nestjs/swagger';

export class LeaveBalanceDto {
  @ApiProperty({ example: 2025 })
  year: number;

  @ApiProperty({
    example: 21,
    description: 'Bu il üçün istifadəçiyə tanınan illik məzuniyyət günləri (effective policy)',
  })
  entitlementDays: number;

  @ApiProperty({
    example: 5,
    description: 'Bu il ərzində artıq istifadə etdiyi illik məzuniyyət günlərinin sayı',
  })
  usedDays: number;

  @ApiProperty({
    example: 3,
    description: 'Bu il üçün PENDING/IN_PROGRESS vəziyyətdə olan illik məzuniyyət günlərinin sayı',
  })
  pendingDays: number;

  @ApiProperty({
    example: 13,
    description: 'Qalan illik məzuniyyət günləri (entitlement - (used + pending))',
  })
  remainingDays: number;
}