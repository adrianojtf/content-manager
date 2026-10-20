import type { PoolConfig } from 'pg';

export type PostgresEnvironment = Readonly<Record<string, string | undefined>>;

export function postgresPoolConfigFromEnvironment(environment: PostgresEnvironment = process.env): PoolConfig {
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString || !isPostgresUrl(connectionString)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL with a database name');
  }
  return { connectionString };
}

function isPostgresUrl(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return (url.protocol === 'postgres:' || url.protocol === 'postgresql:')
      && Boolean(url.hostname)
      && url.pathname.length > 1;
  } catch {
    return false;
  }
}
