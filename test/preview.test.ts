import { randomUUID } from 'node:crypto';
import { readFile, stat, symlink, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { capturePreview, previewHtml } from '../scripts/capture-preview.js';

vi.mock('../src/app.js', () => ({ createApp: vi.fn() }));

const document = '<!doctype html><html><head><style>body { margin: 0; }</style></head><body><header><span class="marker">no marker set</span></header><main>sample digest</main></body></html>';
const paths: string[] = [];

// Remove only files this test created; previews/ remains ignored and no fixture logs are changed.
afterEach(async () => {
  vi.resetAllMocks();
  for (const path of paths.splice(0)) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
});

/** Construct an HTML response for validation tests without starting the service or reading secrets. */
function response(html = document, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=UTF-8' } });
}

/** Replace only the app boundary so capture validation can run before digest routes are merged. */
function serve(result: Response) {
  const request = vi.fn().mockResolvedValue(result);
  vi.mocked(createApp).mockReturnValue({ request } as unknown as ReturnType<typeof createApp>);
  return request;
}

describe('preview capture', () => {
  it('saves the fixed sample page verbatim under ignored previews with private file permissions', async () => {
    const output = `previews/test-${randomUUID()}.html`;
    paths.push(resolve(output));
    const request = serve(response());
    await capturePreview(output);
    expect(request).toHaveBeenCalledWith('/digest/2026-10-28');
    expect(createApp).toHaveBeenCalledWith(expect.objectContaining({ runsDir: resolve('runs') }));
    expect(await readFile(output, 'utf8')).toBe(document);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it.each(['index.html', '../leak.html', 'previews/../leak.html', 'previews/nested/index.html', 'previews/index.txt'])(
    'rejects output outside the permitted HTML directory: %s', async (output) => {
      await expect(capturePreview(output)).rejects.toThrow('directly inside previews/');
      expect(createApp).not.toHaveBeenCalled();
    },
  );

  it('rejects a symlink instead of overwriting its target', async () => {
    const target = `previews/test-${randomUUID()}.html`;
    const output = `previews/test-${randomUUID()}.html`;
    paths.push(resolve(output), resolve(target));
    serve(response());
    await capturePreview(target);
    serve(response());
    await symlink(resolve(target), output);
    await expect(capturePreview(output)).rejects.toThrow('regular file without links');
    expect(await readFile(target, 'utf8')).toBe(document);
  });

  it('does not create an output on a missing route', async () => {
    const output = `previews/test-${randomUUID()}.html`;
    paths.push(resolve(output));
    serve(new Response('not found', { status: 404 }));
    await expect(capturePreview(output)).rejects.toThrow('successful HTML');
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects JSON and incomplete or bannerless HTML', async () => {
    await expect(previewHtml(new Response('{}', { headers: { 'content-type': 'application/json' } }))).rejects.toThrow('successful HTML');
    await expect(previewHtml(response('<p>fragment</p>'))).rejects.toThrow('complete HTML');
    await expect(previewHtml(response(document.replace('class="marker"', 'class="other"')))).rejects.toThrow('lane banner');
  });

  it.each([
    '<script>alert(1)</script>',
    '<link rel="stylesheet" href="https://example.invalid/a.css">',
    '<img src="https://example.invalid/image.png">',
    '<p onclick="alert(1)">active</p>',
    '<a href="javascript:alert(1)">active</a>',
    '<style>@import "https://example.invalid/a.css";</style>',
    '<style>body { background: url(https://example.invalid/image.png); }</style>',
    '<meta http-equiv="refresh" content="0;url=https://example.invalid">',
  ])('rejects scripts and non-self-contained content: %s', async (content) => {
    await expect(previewHtml(response(document.replace('</main>', `${content}</main>`)))).rejects.toThrow('self-contained HTML');
  });
});
