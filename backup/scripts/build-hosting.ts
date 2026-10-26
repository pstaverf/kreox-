import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { isRecord } from '../src/utils/validation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = fileURLToPath(new URL('../../', import.meta.url));
const output = join(repository, 'hosting');
const archive = join(repository, 'kreox-hosting.tar.gz');
const files = ['bot.mjs', 'package.json', 'package-lock.json', '.env.example', 'README.md', '.nvmrc'];
const run = promisify(execFile);
const source: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!isRecord(source) || typeof source.name !== 'string' || typeof source.version !== 'string' || !isRecord(source.engines)
  || typeof source.engines.node !== 'string' || !isRecord(source.dependencies) || typeof source.dependencies.mongodb !== 'string'
  || typeof source.dependencies['vk-io'] !== 'string') throw new Error('Invalid production package metadata');
await rm(output, { recursive: true, force: true });
await rm(archive, { force: true });
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  outfile: join(output, 'bot.mjs'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  charset: 'utf8',
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info'
});
await writeFile(join(output, 'package.json'), `${JSON.stringify({
  name: source.name,
  version: source.version,
  private: true,
  type: 'module',
  engines: { node: source.engines.node },
  scripts: { start: 'node --env-file-if-exists=.env bot.mjs' },
  dependencies: { mongodb: source.dependencies.mongodb, 'vk-io': source.dependencies['vk-io'] }
}, null, 2)}\n`);
await copyFile(join(root, 'package-lock.json'), join(output, 'package-lock.json'));
await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: output });
await copyFile(join(repository, '.env.example'), join(output, '.env.example'));
await copyFile(join(repository, '.nvmrc'), join(output, '.nvmrc'));
await copyFile(join(root, 'HOSTING.md'), join(output, 'README.md'));
await run('tar', ['-czf', archive, '-C', output, ...files], { cwd: root });
if (process.argv.includes('--publish')) {
  for (const file of files) await copyFile(join(output, file), join(repository, file));
  await mkdir(join(repository, 'archives'), { recursive: true });
  await copyFile(archive, join(repository, 'archives/kreox-hosting.tar.gz'));
}
console.info('Hosting files: ../hosting/; archive: ../kreox-hosting.tar.gz; --publish updates repository runtime and archives/');
