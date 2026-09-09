import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  // Express's default body-parser limit is 100kb — every kiosk photo/video
  // upload form (Damaged Product, Help/Issues, Delivery Invoices, Monthly
  // Audit, Audit Corrections) sends its file(s) as base64 inside the JSON
  // submit payload, and even one compressed photo (readFileForUpload caps
  // at ~1600px/70% JPEG, still often 150-400kb) blows past that — found via
  // a real Monthly Audit submission (34 evidence photos) failing with a
  // generic 500 "Something went wrong.". Raised well above what a form with
  // several photos/videos in one submission would need.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '25mb', extended: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = app.get(ConfigService);
  const port = config.get<string>('PORT') ?? 3000;
  await app.listen(port);
}
await bootstrap();
