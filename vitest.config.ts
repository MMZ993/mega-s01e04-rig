import { configDefaults, defineConfig } from 'vitest/config';

/** Test this checkout only; isolated worker worktrees are separate applications. */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
  },
});
