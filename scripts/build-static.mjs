import { build } from 'esbuild';
import { copyFile, mkdir, stat, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = process.env.RECALL_RELAY_WORKSPACE_ROOT ||
  (basename(dirname(projectRoot.slice(0, -1))) === 'products' ? resolve(projectRoot, '../..') : projectRoot);
const tempRoot = resolve(workspaceRoot, 'temp');
let outdir = resolve(tempRoot, 'recall-relay-runtime/site');
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help') {
    console.log('Usage: npm run build:static -- [--outdir <workspace-temp-directory>]');
    process.exit(0);
  }
  if (argument === '--outdir') {
    if (!args[index + 1]) throw new Error('Provide a directory after --outdir.');
    outdir = resolve(args[++index]);
  } else if (argument.startsWith('--outdir=')) {
    outdir = resolve(argument.slice('--outdir='.length));
  } else throw new Error(`Unknown argument: ${argument}. Use --outdir to choose an output directory.`);
}
if (!outdir.startsWith(`${tempRoot}${sep}`)) throw new Error(`Choose an output directory inside ${tempRoot}.`);

const files = [];
async function copyAssets(directory, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const source = resolve(directory, entry.name);
    const destination = resolve(target, entry.name);
    if (entry.isDirectory()) await copyAssets(source, destination);
    else if (entry.isFile() && !['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.map'].includes(extname(entry.name))) {
      await copyFile(source, destination);
      files.push(destination);
    }
  }
}

// Inline the shared domain engine and curated JSON; runtime URL imports stay dynamic.
const bundled = await build({
  entryPoints: [resolve(projectRoot, 'web/app.mjs')],
  outfile: resolve(outdir, 'app.mjs'),
  bundle: true, splitting: false, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, legalComments: 'inline', sourcemap: false, metafile: true, write: false, logLevel: 'silent',
});
for (const source of ['src/engine.mjs', 'data/recall.json']) {
  if (!Object.keys(bundled.metafile.inputs).some(input => resolve(input) === resolve(projectRoot, source))) {
    throw new Error(`Static bundle needs the shared source ${source}.`);
  }
}
await copyAssets(resolve(projectRoot, 'web'), outdir);
for (const output of bundled.outputFiles) {
  await writeFile(output.path, output.contents);
  files.push(output.path);
}
const artifacts = await Promise.all(files.sort().map(async path => {
  return { file: relative(outdir, path), bytes: (await stat(path)).size };
}));
console.log(JSON.stringify({
  ok: true, outdir, entrypoint: 'index.html',
  routing: 'Relative assets; current page pathname and handoff hash retained.',
  bundledInputs: Object.keys(bundled.metafile.inputs).map(path => relative(projectRoot, resolve(path))),
  artifacts,
}, null, 2));
