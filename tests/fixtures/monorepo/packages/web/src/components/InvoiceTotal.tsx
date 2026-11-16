import { addMoney, formatMoney, zeroMoney } from '@acme/shared';
import type { InvoiceLine, Money } from '@acme/shared';

// TODO: import invoiceTotal from a shared place instead of copying it
export function computeTotal(lines: InvoiceLine[]): Money {
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

export function InvoiceTotal(props: { lines: InvoiceLine[] }) {
  return <strong>{formatMoney(computeTotal(props.lines))}</strong>;
}
