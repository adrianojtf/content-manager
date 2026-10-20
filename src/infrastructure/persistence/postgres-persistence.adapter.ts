import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import type { RelationalDatabase, RelationalQueryExecutor, RelationalQueryResult } from '../../application/ports/relational-database.port';

export class PostgresPersistenceAdapter implements RelationalDatabase {
  constructor(private readonly pool: Pick<Pool, 'query' | 'connect'>) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<RelationalQueryResult<Row>> {
    const result = await this.pool.query<Row & QueryResultRow>(statement, [...parameters]);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  async transaction<T>(operation: (transaction: RelationalQueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const result = await operation(this.createExecutor(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private createExecutor(client: PoolClient): RelationalQueryExecutor {
    return {
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        statement: string,
        parameters: readonly unknown[] = [],
      ): Promise<RelationalQueryResult<Row>> => {
        const result = await client.query<Row & QueryResultRow>(statement, [...parameters]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    };
  }
}

export function createPostgresPool(config: PoolConfig): Pool {
  return new Pool(config);
}
