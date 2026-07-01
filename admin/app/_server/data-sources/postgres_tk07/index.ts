import { KnexPgAdapter } from '@kottster/server';
import knex from 'knex';
import dotenv from 'dotenv';

dotenv.config();


const client = knex({
  client: 'pg', 
  connection: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true'
  },
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 30000,
    propagateCreateError: false,
  },
  searchPath: ['public']
});

export default new KnexPgAdapter(client);