// Runs the contract tests with the backend checkout's jest (BACKEND_DIR, default ../predikt-aggregator).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdk = resolve(here, '..');
const backend = resolve(process.env.BACKEND_DIR ?? join(sdk, '..', 'predikt-aggregator'));
const jest = join(backend, 'node_modules', 'jest', 'bin', 'jest.js');

if (!existsSync(join(backend, 'src', 'modules', 'combos'))) {
  console.error(`Backend checkout not found at ${backend}. Set BACKEND_DIR.`);
  process.exit(2);
}
if (!existsSync(jest)) {
  console.error(`Backend dependencies are missing. Run \`npm ci\` in ${backend}.`);
  process.exit(2);
}
if (!existsSync(join(sdk, 'dist', 'cjs', 'index.js'))) {
  console.error('SDK is not built. Run `npm run build` first.');
  process.exit(2);
}

const result = spawnSync(process.execPath, [jest, '-c', join(here, 'jest.config.cjs'), ...process.argv.slice(2)], {
  cwd: backend,
  stdio: 'inherit',
  env: { ...process.env, BACKEND_DIR: backend, SDK_DIR: sdk },
});
process.exit(result.status ?? 1);
