export type HttpHostEnvironment = Readonly<Record<string, string | undefined>>;

export function httpHostFromEnvironment(environment: HttpHostEnvironment = process.env): string {
  return environment.HOST?.trim() || '127.0.0.1';
}
