// ---------------------------------------------------------------------------
// database.markers.ts
// Database and data storage markers
// ---------------------------------------------------------------------------

import type { SemanticMarker } from "../types/marker.types";

export const DATABASE_MARKERS: SemanticMarker[] = [
  {
    id: "db_mongodb",
    phrase: "mongodb",
    type: "phrase",
    weight: 0.90,
    category: "database",
  },
  {
    id: "db_postgres",
    phrase: "postgres",
    type: "phrase",
    weight: 0.90,
    category: "database",
  },
  {
    id: "db_postgresql",
    phrase: "postgresql",
    type: "phrase",
    weight: 0.90,
    category: "database",
  },
  {
    id: "db_mysql",
    phrase: "mysql",
    type: "phrase",
    weight: 0.90,
    category: "database",
  },
  {
    id: "db_sql",
    phrase: "sql",
    type: "phrase",
    weight: 0.82,
    category: "database",
  },
  {
    id: "db_nosql",
    phrase: "nosql",
    type: "phrase",
    weight: 0.85,
    category: "database",
  },
  {
    id: "db_redis",
    phrase: "redis",
    type: "phrase",
    weight: 0.88,
    category: "database",
  },
  {
    id: "db_elasticsearch",
    phrase: "elasticsearch",
    type: "phrase",
    weight: 0.88,
    category: "database",
  },
  {
    id: "db_transaction",
    phrase: "transaction",
    type: "phrase",
    weight: 0.85,
    category: "database",
  },
  {
    id: "db_index",
    phrase: "index",
    type: "phrase",
    weight: 0.78,
    category: "database",
  },
  {
    id: "db_query",
    phrase: "query",
    type: "phrase",
    weight: 0.75,
    category: "database",
  },
  {
    id: "db_schema",
    phrase: "schema",
    type: "phrase",
    weight: 0.80,
    category: "database",
  },
  {
    id: "db_migration",
    phrase: "migration",
    type: "phrase",
    weight: 0.82,
    category: "database",
  },
  {
    id: "db_orm",
    phrase: "orm",
    type: "phrase",
    weight: 0.82,
    category: "database",
  },
  {
    id: "db_prisma",
    phrase: "prisma",
    type: "phrase",
    weight: 0.88,
    category: "database",
  },
  {
    id: "db_sequelize",
    phrase: "sequelize",
    type: "phrase",
    weight: 0.85,
    category: "database",
  },
  {
    id: "db_typeorm",
    phrase: "typeorm",
    type: "phrase",
    weight: 0.85,
    category: "database",
  },
  {
    id: "db_connection_pool",
    phrase: "connection pool",
    type: "phrase",
    weight: 0.88,
    category: "database",
  },
  {
    id: "db_deadlock",
    phrase: "deadlock",
    type: "phrase",
    weight: 0.90,
    category: "database",
  },
  {
    id: "db_isolation",
    phrase: "isolation",
    type: "phrase",
    weight: 0.85,
    category: "database",
  },
];
