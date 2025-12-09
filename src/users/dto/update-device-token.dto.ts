import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateDeviceTokenDto {
  @ApiProperty({
    description: 'Firebase Cloud Messaging device token',
    example: 'fcm_token_here_123456789',
  })
  @IsNotEmpty()
  @IsString()
  fcmToken: string;
}

