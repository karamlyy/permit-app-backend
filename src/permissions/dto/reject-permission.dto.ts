import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectPermissionDto {
  @ApiProperty({ example: 'Bu tarixlərdə layihə deadline var.' })
  @IsString()
  managerComment: string;
}