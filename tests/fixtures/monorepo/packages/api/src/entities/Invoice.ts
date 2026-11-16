import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Customer } from './Customer';

@Entity('invoices')
@Index(['status', 'customer'])
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Customer, (customer: Customer) => customer.invoices)
  customer: Customer;

  @Column({ default: 'draft' })
  status: string;

  @Column('int')
  totalCents: number;

  @Column({ type: 'jsonb' })
  lines: unknown;
}
