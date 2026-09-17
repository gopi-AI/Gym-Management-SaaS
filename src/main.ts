// Import this FIRST so Sentry's auto-instrumentation runs before any other module.
// This is a no-op (with a log line) when SENTRY_DSN is unset.
import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  if (!process.env.SENTRY_DSN) {
    // Clear, explicit signal that error tracking is disabled. This is the expected
    // default locally and in CI; production must set SENTRY_DSN in the env.
    new Logger('Sentry').warn(
      'SENTRY_DSN is not set — Sentry error tracking is DISABLED. ' +
        'Set SENTRY_DSN in your environment to enable error tracking.',
    );
  }

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