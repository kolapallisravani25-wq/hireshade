import { createApp, createIdentityProvider } from '@kottster/server';
import schema from '../../kottster-app.json';
import dotenv from 'dotenv';
import knex from 'knex';

dotenv.config();

// Build a Postgres knex client.
// Parses DATABASE_URL explicitly to avoid SASL/string issues in older pg versions.
// Uses a dedicated 'kottster_auth' schema to avoid table name conflicts with the
// main app's 'users' table (which has a text UUID id, not integer).
function buildPgDb() {
  const rawUrl = process.env.DATABASE_URL;
  let baseConnection: object;
  if (rawUrl) {
    const u = new URL(rawUrl);
    baseConnection = {
      host: u.hostname,
      port: parseInt(u.port || '5432', 10),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
    };
  } else {
    baseConnection = {
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
    };
  }
  return knex({
    client: 'pg',
    connection: baseConnection,
    pool: {
      min: 1,
      max: 5,
      afterCreate(conn: any, done: (err: Error | null, conn: any) => void) {
        // Create the dedicated schema on first connect (idempotent),
        // then set search_path so all Kottster tables land in it.
        conn.query(
          'CREATE SCHEMA IF NOT EXISTS kottster_auth; SET search_path TO kottster_auth',
          (err: Error | null) => done(err, conn),
        );
      },
    },
  });
}

// Kottster's createIdentityProvider only supports 'sqlite' in its public API,
// but internally uses knex — so we inject a Postgres knex client immediately
// after construction. Root-user login (ROOT_USERNAME / ROOT_PASSWORD) is
// env-var-only and never touches the DB; non-root user records go to Postgres.
const identityProvider = createIdentityProvider('sqlite', {
  fileName: ':memory:', // replaced below — no sqlite file is ever written to disk
  passwordHashAlgorithm: 'bcrypt',
  jwtSecretSalt: process.env.JWT_SECRET_SALT,
  rootUsername: process.env.ROOT_USERNAME,
  rootPassword: process.env.ROOT_PASSWORD,
});

// Swap the internal sqlite knex instance with a Postgres one.
//(identityProvider as any).db = buildPgDb();

export const app = createApp({
  schema,
  secretKey: process.env.KOTTSTER_SECRET_KEY,
  kottsterApiToken: process.env.KOTTSTER_API_TOKEN,
  identityProvider,
});
