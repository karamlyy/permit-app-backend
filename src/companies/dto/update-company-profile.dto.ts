import { PartialType } from '@nestjs/swagger';
import { CompanyProfileDto } from './company-profile.dto';

export class UpdateCompanyProfileDto extends PartialType(CompanyProfileDto) {}