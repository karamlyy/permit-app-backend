import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@techcorp.az' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'superSecure123' })
  @IsString()
  @Length(6, 50)
  password: string;
}