/**
 * Renderer entry: boots the PetSprite from the injected config and wires the
 * host bridge (IPC out via `window.ipc.postMessage`, commands in via
 * `window.__petDispatch__`).
 */
import { PetSprite } from './sprite.js';
import type { HostCommand, RendererConfig } from '../shared/types.js';

function boot(): void {
  const config = window.__PET_CONFIG__ as RendererConfig | undefined;
  if (!config) {
    console.error('[webview-pet] missing __PET_CONFIG__');
    return;
  }
  const sprite = new PetSprite(config);
  window.__petDispatch__ = (cmd: HostCommand) => {
    try {
      sprite.dispatch(cmd);
    } catch (err) {
      console.error('[webview-pet] dispatch failed', cmd, err);
    }
  };
  // The host may already be pushing commands before `start()` finishes; the
  // sprite buffers nothing but every command is idempotent enough to run.
  sprite.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
