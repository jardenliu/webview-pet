/** Debug: print monitor geometry, home computation and window placement. */
import { PetApp } from '../dist/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = new PetApp({});
const pet = app.createPet({
  id: 'dbg',
  name: 'dbg',
  size: 420,
  assetsDir: join(here, '..', 'examples', 'assets'),
  animations: { idle: ['待机呼吸'] },
  position: { corner: 'bottom-right', marginX: 32, marginY: 32 },
});
await app.start();

const monitors = app.getMonitors();
console.log('[dbg] monitors:', JSON.stringify(monitors, null, 2));
console.log('[dbg] home:', pet.home);
console.log('[dbg] metrics:', pet.metrics.width, pet.metrics.height, 'margins', pet.metrics.marginL, pet.metrics.marginT);
setTimeout(() => {
  const win = pet.window.win;
  console.log('[dbg] window pos:', win.getPosition(false), 'size:', win.getOuterSize(false));
  console.log('[dbg] primary monitor:', JSON.stringify(win.getPrimaryMonitor()));
  app.quit();
  process.exit(0);
}, 1500);
