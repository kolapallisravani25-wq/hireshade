import type { Knex } from 'knex';

export interface ColumnInfo {
  column_name: string;
  data_type: string;
}

export interface SubscriptionResult {
  listener: string | Knex;
  knexPg: Knex | null;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface DatabaseConnectionPool {
  min: number;
  max: number;
  acquireTimeoutMillis: number;
  createTimeoutMillis: number;
  destroyTimeoutMillis: number;
  idleTimeoutMillis: number;
  reapIntervalMillis: number;
  createRetryIntervalMillis: number;
}
