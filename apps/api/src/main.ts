import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API đang chạy tại http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
