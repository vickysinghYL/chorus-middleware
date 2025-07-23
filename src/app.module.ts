import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChorusApiService } from './services/chorus-api.service';
import { ChorusController } from './controllers/chorus.controller';
import { ErrorLogService } from './services/error-log.service';
import { ErrorLogController } from './controllers/error-log.controller';
import { ChorusErrorLog } from './entities/chorus-error-log.entity';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.POSTGRES_HOST,
        port: parseInt(process.env.POSTGRES_PORT, 10),
        username: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        autoLoadEntities: true,
        synchronize: true,
        entities: [join(__dirname, './**/**.entity{.ts,.js}')],
        logging: false, // Disable SQL query logging
      }),
    TypeOrmModule.forFeature([ChorusErrorLog]),
  ],
  controllers: [ChorusController, ErrorLogController],
  providers: [ChorusApiService, ErrorLogService],
})
export class AppModule {} 