import type { CustomerDto, InvoiceDto } from '@acme/shared';

const BASE_URL = '/api';

export async function fetchInvoices(): Promise<InvoiceDto[]> {
  const response = await fetch(`${BASE_URL}/invoices`);
  return response.json();
}

export async function fetchCustomer(id: number): Promise<CustomerDto> {
  const response = await fetch(`${BASE_URL}/customers/${id}`);
  return response.json();
}
