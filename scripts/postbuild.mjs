// Node decides a .js file's module type from the nearest package.json "type" field.
// The root package.json has no "type", so without these markers Node treats
// dist/esm/*.js as CommonJS and throws on their `import` statements.
import { writeFileSync } from 'node:fs';

for (const [dir, type] of [
  ['dist/esm', 'module'],
  ['dist/cjs', 'commonjs'],
]) {
  writeFileSync(`${dir}/package.json`, JSON.stringify({ type }, null, 2) + '\n');
}
