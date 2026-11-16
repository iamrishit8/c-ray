import fastify from 'fastify';
import { config } from './config';
import { dataSource } from './db/data-source';
import { customerRoutes } from './routes/customers';
import { invoiceRoutes } from './routes/invoices';

async function main() {
  await dataSource.initialize();
  const app = fastify({ logger: true });
  app.register(invoiceRoutes, { prefix: '/api' });
  app.register(customerRoutes, { prefix: '/api' });
  await app.listen({ port: config.port });
}

main();
