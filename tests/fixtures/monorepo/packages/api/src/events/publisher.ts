import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redisUrl);

export async function publishInvoiceCreated(invoiceId: number): Promise<void> {
  await redis.publish('invoice.created', JSON.stringify({ invoiceId }));
}
