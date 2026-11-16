import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.headers['x-admin-token'] !== config.adminToken) {
    reply.code(401).send({ error: 'unauthorized' });
  }
}
