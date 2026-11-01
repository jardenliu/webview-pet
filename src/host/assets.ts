/**
 * Custom-protocol asset server: renderer files, animation webms, fonts,
 * sounds and local bubble images, all served over `pet://localhost/…`.
 */
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RendererConfig } from '../shared/types.js';

const HERE = dirnameOfThisFile();

function dirnameOfThisFile(): string {
  // Works for both ESM (import.meta.url) and bundled output under dist/host.
  try {
    return fileURLToPath(new URL('.', import.meta.url));
  } catch {
    return process.cwd();
  }
}

/** Directory holding the built renderer assets (index.html, renderer.js, …). */
export const rendererAssetsDir = (): string => resolve(HERE, '..', 'renderer');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const mimeOf = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

/** Reject any path that escapes its base directory. */
const inside = (base: string, target: string): boolean => {
  const b = resolve(base);
  const t = resolve(target);
  return t === b || t.startsWith(b + sep);
};

export interface AssetContext {
  /** Absolute path of the pet's animation directory. */
  assetsDir: string;
  /** Absolute path of the custom font file, or null. */
  fontFile: string | null;
  /** Renderer boot config served as `/config.json` and injected into index.html. */
  config: () => RendererConfig;
}

/**
 * Create the protocol handler for one pet window. Routes:
 * - `/` `/index.html`        boot page with the config injected
 * - `/renderer.js|styles.css|click.wav`   built renderer assets
 * - `/config.json`           the renderer boot config
 * - `/anim/<name>.webm`      animation assets from the pet's assetsDir
 * - `/font/<file>`           the configured font file
 * - `/local/<abspath>`       an arbitrary local file (bubble images)
 */
export const createAssetHandler = (ctx: AssetContext) => {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const notFound = () =>
      new Response('Not found: ' + pathname, { status: 404, headers: { 'Content-Type': 'text/plain' } });

    try {
      if (pathname === '/config.json') {
        return new Response(JSON.stringify(ctx.config()), {
          headers: { 'Content-Type': MIME['.json']! },
        });
      }

      if (pathname === '/index.html') {
        const file = join(rendererAssetsDir(), 'index.html');
        if (!inside(rendererAssetsDir(), file)) return notFound();
        const html = await readFile(file, 'utf8');
        // Escape U+2028/U+2029 so the JSON is safe to inline inside <script>.
        const json = JSON.stringify(ctx.config()).replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
        const injected = html.replace(
          /\/\*__CONFIG__\*\/null\/\*__CONFIG_END__\*\//,
          () => json,
        );
        return new Response(injected, { headers: { 'Content-Type': MIME['.html']! } });
      }

      if (pathname.startsWith('/anim/')) {
        const name = pathname.slice('/anim/'.length);
        if (name.includes('..') || name.includes('/') || name.includes('\\')) return notFound();
        const file = join(ctx.assetsDir, name);
        if (!inside(ctx.assetsDir, file)) return notFound();
        return await fileResponse(file);
      }

      if (pathname.startsWith('/font/')) {
        if (!ctx.fontFile) return notFound();
        return await fileResponse(ctx.fontFile);
      }

      if (pathname.startsWith('/local/')) {
        const target = pathname.slice('/local/'.length);
        if (!isAbsolute(target)) return notFound();
        return await fileResponse(target);
      }

      // Built renderer assets (styles.css, renderer.js, click.wav, …)
      const file = join(rendererAssetsDir(), normalize(pathname).replace(/^([/\\])+/, ''));
      if (!inside(rendererAssetsDir(), file)) return notFound();
      return await fileResponse(file);
    } catch {
      return notFound();
    }
  };
};

async function fileResponse(file: string): Promise<Response> {
  const body = await readFile(file);
  return new Response(new Uint8Array(body), {
    headers: { 'Content-Type': mimeOf(file) },
  });
}
