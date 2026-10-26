import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord } from '../src/utils/validation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = fileURLToPath(new URL('../../', import.meta.url));

test('hosting build has six files, one ESM application, a production-only lockfile and no startup compiler dependency', { timeout: 60_000 }, async () => {
  const run = promisify(execFile);
  await run(process.execPath, ['--import', 'tsx', 'scripts/build-hosting.ts'], { cwd: root });
  const directory = join(repository, 'hosting');
  const expected = ['.env.example', '.nvmrc', 'README.md', 'bot.mjs', 'package-lock.json', 'package.json'].sort();
  assert.deepEqual((await readdir(directory)).sort(), expected);
  const { stdout } = await run('tar', ['-tzf', join(repository, 'kreox-hosting.tar.gz')], { cwd: root });
  assert.deepEqual(stdout.trim().split('\n').sort(), expected);
  const pkg: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.ok(isRecord(pkg) && isRecord(pkg.scripts) && isRecord(pkg.dependencies) && isRecord(pkg.engines));
  assert.equal(pkg.scripts.start, 'node --env-file-if-exists=.env bot.mjs');
  assert.equal(pkg.scripts.prestart, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.dependencies.mongodb, '7.7.0');
  assert.equal(pkg.dependencies['vk-io'], '4.10.1');
  assert.equal(pkg.engines.node, '>=24 <25');
  const lock: unknown = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  assert.ok(isRecord(lock) && isRecord(lock.packages));
  for (const name of ['typescript', 'tsx', 'esbuild']) assert.equal(lock.packages[`node_modules/${name}`], undefined);
  const bundle = join(directory, 'bot.mjs');
  await run(process.execPath, ['--check', bundle], { cwd: directory });
  const startup = spawnSync(process.execPath, [bundle], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, VK_TOKEN: '', VK_GROUP_ID: '', MONGODB_URI: '', MONGODB_DB: '' }
  });
  assert.equal(startup.error, undefined);
  assert.equal(startup.status, 1);
  const diagnostic: unknown = JSON.parse(startup.stderr.trim());
  assert.ok(isRecord(diagnostic));
  assert.equal(diagnostic.scope, 'startup');
  assert.equal(diagnostic.type, 'Error');
});


test('repository root is runtime-only while strict source project and test suite remain in backup', async () => {
  const runtime: unknown = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  assert.ok(isRecord(runtime) && isRecord(runtime.scripts));
  assert.deepEqual(runtime.scripts, { start: 'node --env-file-if-exists=.env bot.mjs' });
  assert.equal(runtime.devDependencies, undefined);
  const development: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.ok(isRecord(development) && isRecord(development.devDependencies) && isRecord(development.scripts));
  assert.equal(development.devDependencies.esbuild, '0.28.2');
  assert.match(String(development.scripts['build:hosting']), /--publish/);
  const files = await readdir(repository);
  for (const name of ['src', 'tests', 'scripts', 'tsconfig.json', 'HOSTING.md']) assert.equal(files.includes(name), false);
  for (const name of ['src', 'tests', 'scripts', 'tsconfig.json']) assert.ok((await readdir(root)).includes(name));
  await promisify(execFile)(process.execPath, ['--check', join(repository, 'bot.mjs')]);
});
