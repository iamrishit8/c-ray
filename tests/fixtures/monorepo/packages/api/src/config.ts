export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost/billing',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // Planted secret
  adminToken: 'ghp_FixtureTokenA1b2C3d4E5f6G7h8I9j0KlMnOpQr',
};
