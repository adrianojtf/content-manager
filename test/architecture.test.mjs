import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : entry.name.endsWith('.ts') ? [entryPath] : [];
  }));

  return files.flat();
}

async function importsFrom(filePath) {
  const source = await readFile(filePath, 'utf8');
  const specifiers = [];
  const importPattern = /^\s*(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]|^\s*import\s*\(['"]([^'"]+)['"]\)/gm;

  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[1] ?? match[2]);
  }

  return specifiers;
}

test('provides the documented application layer boundaries', async () => {
  for (const layer of ['domain', 'application', 'infrastructure', 'presentation/http']) {
    await assert.doesNotReject(readdir(path.join(sourceRoot, layer)));
  }
});

test('keeps domain imports inside the domain layer', async () => {
  for (const filePath of await sourceFiles(path.join(sourceRoot, 'domain'))) {
    for (const specifier of await importsFrom(filePath)) {
      assert.ok(specifier.startsWith('.'), `${filePath} imports external dependency ${specifier}`);
      const importedPath = path.resolve(path.dirname(filePath), specifier);
      assert.ok(importedPath.startsWith(`${path.join(sourceRoot, 'domain')}${path.sep}`), `${filePath} imports outside the domain: ${specifier}`);
    }
  }
});

test('keeps application code independent from infrastructure and presentation', async () => {
  for (const filePath of await sourceFiles(path.join(sourceRoot, 'application'))) {
    for (const specifier of await importsFrom(filePath)) {
      assert.ok(specifier.startsWith('.'), `${filePath} imports external dependency ${specifier}`);
      const importedPath = path.resolve(path.dirname(filePath), specifier);
      const applicationRoot = path.join(sourceRoot, 'application');
      const domainRoot = path.join(sourceRoot, 'domain');
      assert.ok(
        importedPath.startsWith(`${applicationRoot}${path.sep}`) || importedPath.startsWith(`${domainRoot}${path.sep}`),
        `${filePath} imports outside application/domain: ${specifier}`,
      );
    }
  }
});
