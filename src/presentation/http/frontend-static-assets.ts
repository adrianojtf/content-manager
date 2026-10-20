import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function mountCreatorDeskFrontend(app: NestExpressApplication): void {
  app.useStaticAssets(resolve(__dirname, '../../../web'));
}
