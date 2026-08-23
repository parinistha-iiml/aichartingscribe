import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // Prisma CLI (migrate, studio, db seed) needs a *direct* connection —
  // it can't run migrations through Neon's pooled/pgbouncer endpoint.
  datasource: {
    url: env('DIRECT_URL'),
  },
});
