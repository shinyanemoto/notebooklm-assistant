import { build, context } from 'esbuild';
import { rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: true,
  logLevel: 'info'
};

const entryPoints = {
  'background/index': 'src/background/index.ts',
  'content/index': 'src/content/index.ts',
  'popup/index': 'src/popup/index.ts',
  'options/index': 'src/options/index.ts'
};

await rm('dist', { recursive: true, force: true });

if (watch) {
  const ctx = await context({
    ...common,
    entryPoints,
    outdir: 'dist'
  });
  await ctx.watch();
  console.log('Watching TypeScript files...');
} else {
  await build({
    ...common,
    entryPoints,
    outdir: 'dist'
  });
}
