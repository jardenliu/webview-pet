/**
 * Build script: bundle the renderer, compile the host library to
 * dist/, and copy the static renderer assets.
 *
 * Usage: bun run scripts/build.ts
 */
import { $ } from 'bun';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist');

console.log('[build] cleaning dist/');
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'renderer'), { recursive: true });

console.log('[build] bundling renderer');
const result = await Bun.build({
  entrypoints: [join(root, 'src/renderer/main.ts')],
  outdir: join(dist, 'renderer'),
  target: 'browser',
  format: 'iife',
  minify: false,
  sourcemap: 'none',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// bun names the bundle after the entry; publish it as renderer.js
await rename(join(dist, 'renderer/main.js'), join(dist, 'renderer/renderer.js'));

console.log('[build] copying renderer assets');
for (const file of ['index.html', 'styles.css']) {
  await cp(join(root, 'src/renderer', file), join(dist, 'renderer', file));
}
await cp(join(root, 'src/renderer/assets'), join(dist, 'renderer/assets'), { recursive: true });
// click sound is served at sound/click.wav
await mkdir(join(dist, 'renderer/sound'), { recursive: true });
await cp(join(root, 'src/renderer/assets/click.wav'), join(dist, 'renderer/sound/click.wav'));

console.log('[build] compiling host library (tsc)');
await $`./node_modules/.bin/tsc -p tsconfig.json`;

console.log('[build] done');
