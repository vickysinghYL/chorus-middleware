import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
    
    // Set global prefix for all routes
    app.setGlobalPrefix('api');
  
    app.enableCors({ origin: '*' });
    app.useGlobalPipes(
      new ValidationPipe({
        stopAtFirstError: true,
        // whitelist: true,
      }),
    );
    
    const port = configService.get('port') || 8000;
    await app.listen(port);
    
    console.log(`🚀 Application is running on: http://localhost:${port}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   POST /api/chorus/create-trip`);
    console.log(`   POST /api/chorus/start-tracking`);
    console.log(`   POST /api/chorus/update-trip-in-transit`);
    console.log(`   POST /api/chorus/end-trip`);
    console.log(`   POST /api/chorus/end-tracking`);
    console.log(`   GET  /api/chorus/list-trips-in-transit`);
    console.log(`   POST /api/chorus/process-data`);
  }
  
  bootstrap();