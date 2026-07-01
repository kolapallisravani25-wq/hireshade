import knex from 'knex';
import type { Knex } from 'knex';
import dotenv from 'dotenv';

dotenv.config();

let cachedKnex: Knex | null = null;

export const getKnex = (): Knex => {
  if (cachedKnex) return cachedKnex;

  cachedKnex = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    },
    pool: {
      min: 2,
      max: 10,
    },
  });

  return cachedKnex;
};
