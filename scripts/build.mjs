import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename } from 'node:path';
import { checkData } from './check-data.mjs';
await checkData();
const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
const outputPath = resolve(fileURLToPath(out));
if (dirname(outputPath) !== resolve(fileURLToPath(root)) || basename(outputPath) !== 'dist') throw new Error('Unexpected build output directory');
await rm(outputPath, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const path of ['index.html', 'favicon.svg', '_routes.json', 'src', 'data']) await cp(new URL(path, root), new URL(path, out), {
  recursive: true, filter: source => !basename(source).endsWith('.bak'),
});
await writeFile(new URL('.nojekyll', out), '');
console.log('静态网站发布文件已生成到 dist/。');
