import 'reflect-metadata';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI data source.
 *
 * Used by the TypeORM CLI (`typeorm migration:generate`, `migration:run`,
 * `migration:revert`) to manage the production schema through migrations.
 * The NestJS runtime (src/app.module.ts) uses the same connection settings and
 * the same `migrations` glob, so the CLI and the application stay in lockstep.
 *
 * `synchronize` is intentionally `false` here as well: schema changes must
 * always go through generated migrations, never auto-sync.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'gym_management',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});

