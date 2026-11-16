import { DataSource } from 'typeorm';
import { config } from '../config';
import { Customer } from '../entities/Customer';
import { Invoice } from '../entities/Invoice';

export const dataSource = new DataSource({
  type: 'postgres',
  url: config.databaseUrl,
  entities: [Customer, Invoice],
});
