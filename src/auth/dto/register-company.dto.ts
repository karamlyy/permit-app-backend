import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterCompanyDto {
  @ApiProperty({ example: 'TechCorp LLC' })
  @IsString()
  @Length(3, 100)
  companyName: string;

  @ApiProperty({ example: 'Asia/Baku' })
  @IsString()
  timezone: string;

  @ApiProperty({ example: 'Karam Afandi' })
  @IsString()
  @Length(3, 100)
  adminName: string;

  @ApiProperty({ example: 'admin@techcorp.az' })
  @IsEmail()
  adminEmail: string;

  @ApiProperty({ example: 'superSecure123', minLength: 6 })
  @IsString()
  @Length(6, 50)
  adminPassword: string;
}