/** Capture the digest's server-rendered response without a socket, heartbeat, or environment dump. */
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previews = resolve(root, 'previews');

/** Validate a successful, standalone SSR document; reject active content and asset dependencies. */
export async function previewHtml(response: Response): Promise<string> {
  if (response.status !== 200 || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Preview requires a successful HTML response.');
  }
  const html = await response.text();
  if (!/^<!doctype html>/i.test(html) || !/<\/html>\s*$/i.test(html) || !/class=["']marker["']/i.test(html)) {
    throw new Error('Preview requires a complete HTML document with the lane banner.');
  }
  if (/<(?:script|link|base|iframe|frame|img|image|audio|video|source|object|embed|form)\b/i.test(html)
    || /\s(?:on[a-z]+|src|srcset)\s*=/i.test(html)
    || /(?:javascript\s*:|@import\b|url\s*\()/i.test(html)
    || /<meta\b[^>]*http-equiv\s*=/i.test(html)) {
    throw new Error('Preview must be self-contained HTML without client scripts or external assets.');
  }
  return html;
}

/** Render the fixed sample night and save a private-mode HTML file directly inside ignored previews/. */
export async function capturePreview(output = 'previews/index.html'): Promise<void> {
  const destination = resolve(root, output);
  if (dirname(destination) !== previews || extname(destination) !== '.html') {
    throw new Error('Preview output must be an HTML file directly inside previews/.');
  }
  const config = { ...loadConfig(resolve(root, 'rig.json')), runsDir: resolve(root, 'runs') };
  const html = await previewHtml(await createApp(config).request('/digest/2026-10-28'));

  await mkdir(previews, { recursive: true, mode: 0o700 });
  if (!(await lstat(previews)).isDirectory()) {
    throw new Error('Preview directory must not be a symlink.');
  }
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (existing && (!existing.isFile() || existing.nlink !== 1)) {
    throw new Error('Preview output must be a regular file without links.');
  }
  const file = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(html, 'utf8');
  } finally {
    await file.close();
  }
}

// Only the CLI entry point writes a preview; imports are safe for focused validation tests.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) {
    console.error('Usage: tsx scripts/capture-preview.ts [previews/index.html]');
    process.exitCode = 1;
  } else {
    await capturePreview(process.argv[2]).catch(() => {
      // Never echo a response body, marker, environment value, or arbitrary upstream error.
      console.error('Preview capture failed; check the digest route and previews/ output path.');
      process.exitCode = 1;
    });
  }
}
