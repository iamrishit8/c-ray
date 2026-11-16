import type { InvoiceDto } from './types';

export function validateInvoice(invoice: InvoiceDto): string[] {
  const problems: string[] = [];
  if (invoice.lines.length === 0) {
    problems.push('invoice has no lines');
  }
  for (const line of invoice.lines) {
    if (line.quantity <= 0) {
      problems.push(`bad quantity for ${line.description}`);
    }
  }
  return problems;
}
