import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './company.entity';
import { User } from '../users/user.entity';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { Branch } from 'src/branches/branches.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Branch, Company, User])],
  providers: [CompaniesService],
  controllers: [CompaniesController],
})
export class CompaniesModule {}