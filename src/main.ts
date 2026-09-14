import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // Permit the current demo frontend origin only. The Next.js app runs on
  // port 3001 and makes authenticated requests (Authorization bearer,
  // X-Organization-Id tenant header) to this API on port 3000. CORS is
  // scoped to exactly this origin — never `*` since credentials are used.
  app.enableCors({
    origin: ['http://localhost:3001'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
    credentials: true,
  });

  await app.listen(port);
}
bootstrap();