import { formatMoney } from '@acme/shared';
import type { InvoiceDto } from '@acme/shared';
import { CustomerBadge } from './CustomerBadge';
import { InvoiceTotal, computeTotal } from './InvoiceTotal';

export function InvoiceList(props: { invoices: InvoiceDto[] }) {
  const grand = props.invoices.reduce((sum, invoice) => sum + computeTotal(invoice.lines).cents, 0);
  return (
    <div>
      <ul>
        {props.invoices.map((invoice) => (
          <li key={invoice.id}>
            #{invoice.id} <CustomerBadge customerId={invoice.customerId} /> <InvoiceTotal lines={invoice.lines} />
          </li>
        ))}
      </ul>
      <p>Grand total: {formatMoney({ cents: grand, currency: 'EUR' })}</p>
    </div>
  );
}
