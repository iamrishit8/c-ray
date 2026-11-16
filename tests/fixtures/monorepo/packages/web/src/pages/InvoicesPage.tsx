import { useEffect, useState } from 'react';
import type { InvoiceDto } from '@acme/shared';
import { fetchInvoices } from '../api/client';
import { InvoiceList } from '../components/InvoiceList';

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  useEffect(() => {
    fetchInvoices().then(setInvoices);
  }, []);
  return <InvoiceList invoices={invoices} />;
}
