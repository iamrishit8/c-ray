export interface Money {
  cents: number;
  currency: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: Money;
}

export interface InvoiceDto {
  id: number;
  customerId: number;
  lines: InvoiceLine[];
  status: 'draft' | 'sent' | 'paid';
}

export interface CustomerDto {
  id: number;
  name: string;
  email: string;
}
