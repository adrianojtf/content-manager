export interface RelationalQueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface RelationalQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<RelationalQueryResult<Row>>;
}

export interface RelationalDatabase extends RelationalQueryExecutor {
  transaction<T>(operation: (transaction: RelationalQueryExecutor) => Promise<T>): Promise<T>;
}
