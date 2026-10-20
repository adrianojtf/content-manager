import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { postgresPoolConfigFromEnvironment } from '../../infrastructure/persistence/postgres-persistence.config';
import { AppModule } from './app.module';
import { mountCreatorDeskFrontend } from './frontend-static-assets';

async function bootstrap(): Promise<void> {
  const databaseConfig = postgresPoolConfigFromEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.withPostgres(databaseConfig));
  mountCreatorDeskFrontend(app);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT) || 3000, '127.0.0.1');
}

void bootstrap();
