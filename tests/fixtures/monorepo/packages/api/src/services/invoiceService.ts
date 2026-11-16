import { addMoney, formatMoney, validateInvoice, zeroMoney } from '@acme/shared';
import type { InvoiceDto, InvoiceLine, Money } from '@acme/shared';
import { dataSource } from '../db/data-source';
import { Invoice } from '../entities/Invoice';
import { publishInvoiceCreated } from '../events/publisher';
import { getCustomer } from './customerService';

export async function countInvoicesForCustomer(customerId: number): Promise<number> {
  return dataSource.getRepository(Invoice).count({ where: { customer: { id: customerId } } });
}

export function invoiceTotal(lines: InvoiceLine[]): Money {
  let total = zeroMoney('EUR');
  for (const line of lines) {
    const lineTotal = {
      cents: line.unitPrice.cents * line.quantity,
      currency: line.unitPrice.currency,
    };
    if (line.quantity > 100) {
      lineTotal.cents = Math.round(lineTotal.cents * 0.9);
    }
    total = addMoney(total, lineTotal);
  }
  return total;
}

export async function listInvoices(): Promise<Invoice[]> {
  return dataSource.getRepository(Invoice).find();
}

export async function createInvoice(dto: InvoiceDto): Promise<{ id: number; total: string }> {
  const problems = validateInvoice(dto);
  if (problems.length > 0) {
    throw new Error(problems.join('; '));
  }
  const customer = await getCustomer(dto.customerId);
  if (!customer) {
    throw new Error('unknown customer');
  }
  const total = invoiceTotal(dto.lines);
  const saved = await dataSource.getRepository(Invoice).save({ customer, totalCents: total.cents, lines: dto.lines });
  await publishInvoiceCreated(saved.id);
  return { id: saved.id, total: formatMoney(total) };
}
