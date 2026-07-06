import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Direct (non-pooled) connection string; only used by drizzle-kit locally.
    url: process.env.DATABASE_URL ?? '',
  },
});
