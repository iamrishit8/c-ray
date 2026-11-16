import { dataSource } from '../db/data-source';
import { Customer } from '../entities/Customer';
import { countInvoicesForCustomer } from './invoiceService';

export async function getCustomer(id: number): Promise<Customer | null> {
  return dataSource.getRepository(Customer).findOneBy({ id });
}

export async function customerSummary(id: number) {
  const customer = await getCustomer(id);
  if (!customer) {
    return null;
  }
  const invoiceCount = await countInvoicesForCustomer(id);
  return { id: customer.id, name: customer.name, invoiceCount };
}
