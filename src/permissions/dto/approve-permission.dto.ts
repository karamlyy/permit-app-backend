import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApprovePermissionDto {
  @ApiPropertyOptional({ example: 'OK, qəbul olundu.' })
  @IsOptional()
  @IsString()
  comment?: string;
}