import { readFileSync } from 'node:fs';

export function localHttpsOptionsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  readFile: (path: string) => Buffer = readFileSync,
): { readonly key: Buffer; readonly cert: Buffer } | undefined {
  const keyPath = environment.LOCAL_HTTPS_KEY_PATH?.trim();
  const certPath = environment.LOCAL_HTTPS_CERT_PATH?.trim();
  if (!keyPath && !certPath) return undefined;
  if (!keyPath || !certPath) {
    throw new Error('LOCAL_HTTPS_KEY_PATH and LOCAL_HTTPS_CERT_PATH must be configured together');
  }
  return { key: readFile(keyPath), cert: readFile(certPath) };
}
