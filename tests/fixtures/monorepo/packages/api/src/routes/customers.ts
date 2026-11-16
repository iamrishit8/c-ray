import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dataSource } from '../db/data-source';
import { Customer } from '../entities/Customer';
import { customerSummary } from '../services/customerService';

export async function customerRoutes(app: FastifyInstance) {
  app.get('/customers', async (request: FastifyRequest, reply: FastifyReply) => {
    // Planted layering violation: the route handler queries the repository directly.
    const customers = await dataSource.getRepository(Customer).find();
    reply.send(customers);
  });

  app.get('/customers/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const summary = await customerSummary(Number(request.params.id));
    if (!summary) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.send(summary);
  });
}
