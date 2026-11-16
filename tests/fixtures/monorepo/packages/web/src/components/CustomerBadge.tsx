import { useEffect, useState } from 'react';
import type { CustomerDto } from '@acme/shared';
import { fetchCustomer } from '../api/client';

export function CustomerBadge(props: { customerId: number }) {
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  useEffect(() => {
    fetchCustomer(props.customerId).then(setCustomer);
  }, [props.customerId]);
  return <span className="badge">{customer ? customer.name : '...'}</span>;
}
