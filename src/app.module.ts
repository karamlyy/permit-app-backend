import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './companies/company.entity';
import { User } from './users/user.entity';
import { Department } from './departments/department.entity';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { DepartmentsModule } from './departments/departments.module';
import { UsersModule } from './users/users.module';
import { Permission } from './permissions/permission.entity';
import { PermissionsModule } from './permissions/permissions.module';
import { PermissionApproval } from './permissions/permission-approval.entity';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      entities: [Company, User, Department, Permission, PermissionApproval],
      synchronize: true,
    }),
    AuthModule,
    CompaniesModule,
    DepartmentsModule,
    UsersModule,
    PermissionsModule,
  ],
})
export class AppModule {}