import { ApiPropertyOptional } from '@nestjs/swagger';
import { CompanySize } from '../../common/enums/company-size.enum';
import { CompanySector } from 'src/common/enums/company-sectors.enum';

export class CompanyProfileDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  legalName?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ enum: CompanySector })
  sector?: CompanySector;

  @ApiPropertyOptional()
  website?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  country?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  addressLine?: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiPropertyOptional()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Təxmini və ya real işçi sayı' })
  employeeCount?: number;

  @ApiPropertyOptional({ enum: CompanySize })
  size?: CompanySize;
}