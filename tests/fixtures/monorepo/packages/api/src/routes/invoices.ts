import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createInvoice, listInvoices } from '../services/invoiceService';
import { requireAdmin } from './auth';

async function listHandler(request: FastifyRequest, reply: FastifyReply) {
  reply.send(await listInvoices());
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = await createInvoice(request.body);
  reply.code(201).send(result);
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.get('/invoices', listHandler);
  app.post('/invoices', { preHandler: [requireAdmin] }, createHandler);
}
