import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './company.entity';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
  ) {}

  async getCompanyById(id: number) {
    const company = await this.companiesRepo.findOne({
      where: { id },
      relations: ['departments', 'users'],
    });
    if (!company) {
      throw new NotFoundException('Şirkət tapılmadı');
    }
    return company;
  }
}