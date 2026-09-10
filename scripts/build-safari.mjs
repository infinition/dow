#!/usr/bin/env node
/**
 * Builds the Safari flavour of the extension into dist/safari.
 *
 * Nothing under extension/ is modified: the Chrome build stays byte identical
 * to what ships today. This script copies the extension, strips the manifest
 * entries Safari does not implement, and wires extension/compat/browser-compat.js
 * into every context so the missing APIs get filled in at runtime.
 *
 * Output is meant to be fed to xcrun safari-web-extension-converter.
 *
 * Usage: node scripts/build-safari.mjs [--out <dir>]
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'extension');
const SHIM_PATH = 'compat/browser-compat.js';
const SHIM_URL = `/${SHIM_PATH}`;

// Neither the Chrome theme nor the private bookmarklets belong in a build,
// matching the exclusions the Chrome release zip already applies.
const EXCLUDED = ['dow-chrome-theme', 'dow-chrome-theme.zip', 'bookmarklets/private'];

// Declared by the Chrome manifest, absent from Safari 18. browser-compat.js
// fills each one in at runtime, so keeping them here would only earn a
// converter warning and an unknown permission prompt.
const UNSUPPORTED_PERMISSIONS = ['downloads', 'downloads.open', 'sidePanel', 'offscreen', 'browsingData', 'unlimitedStorage'];

// Surfaces Safari does not provide. The shim reroutes them.
const UNSUPPORTED_MANIFEST_KEYS = ['side_panel'];

function parseArgs(argv) {
  const options = { out: path.join(ROOT, 'dist', 'safari') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      const value = argv[i + 1];
      if (!value) throw new Error('--out needs a directory');
      options.out = path.resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return options;
}

function isExcluded(relative) {
  const normalized = relative.split(path.sep).join('/');
  return EXCLUDED.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

async function collectFiles(directory, base = directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(base, absolute);
    if (isExcluded(relative)) continue;
    if (entry.isDirectory()) {
      found.push(...(await collectFiles(absolute, base)));
    } else {
      found.push(relative.split(path.sep).join('/'));
    }
  }
  return found;
}

function patchManifest(manifest) {
  const dropped = { permissions: [], keys: [] };
  const patched = { ...manifest };

  for (const field of ['permissions', 'optional_permissions']) {
    if (!Array.isArray(patched[field])) continue;
    const kept = patched[field].filter((permission) => !UNSUPPORTED_PERMISSIONS.includes(permission));
    dropped.permissions.push(...patched[field].filter((permission) => UNSUPPORTED_PERMISSIONS.includes(permission)));
    if (kept.length > 0) {
      patched[field] = kept;
    } else {
      delete patched[field];
    }
  }

  for (const key of UNSUPPORTED_MANIFEST_KEYS) {
    if (key in patched) {
      delete patched[key];
      dropped.keys.push(key);
    }
  }

  return { patched, dropped };
}

function injectIntoHtml(html, file) {
  if (html.includes(SHIM_URL)) return html;

  const tag = `<script src="${SHIM_URL}"></script>`;
  // A classic script placed in the head runs before deferred module scripts and
  // before anything at the end of the body, which is what the shim needs.
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`;
  }

  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`;
  }

  throw new Error(`No place to inject the shim in ${file}`);
}

function injectIntoWorker(source, isModule) {
  if (source.includes(SHIM_PATH)) return source;

  const statement = isModule ? `import '/${SHIM_PATH}';` : `importScripts('${SHIM_PATH}');`;
  const banner = `// Injected by scripts/build-safari.mjs: fills in the APIs Safari lacks.\n${statement}\n\n`;
  return banner + source;
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));

  if (!existsSync(SOURCE)) throw new Error(`Missing source directory: ${SOURCE}`);
  if (!existsSync(path.join(SOURCE, SHIM_PATH))) throw new Error(`Missing compatibility shim: extension/${SHIM_PATH}`);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const files = await collectFiles(SOURCE);
  for (const file of files) {
    const target = path.join(out, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(SOURCE, file), target);
  }

  const manifestPath = path.join(out, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { patched, dropped } = patchManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');

  const worker = patched.background?.service_worker;
  if (!worker) throw new Error('The manifest declares no service worker');
  const workerPath = path.join(out, worker);
  const isModule = patched.background?.type === 'module';
  await writeFile(workerPath, injectIntoWorker(await readFile(workerPath, 'utf8'), isModule), 'utf8');

  const pages = files.filter((file) => file.endsWith('.html'));
  for (const page of pages) {
    const target = path.join(out, page);
    const html = await readFile(target, 'utf8');
    const injected = injectIntoHtml(html, page);
    if (!injected.includes(SHIM_URL)) throw new Error(`Shim missing from ${page}`);
    await writeFile(target, injected, 'utf8');
  }

  console.log(`Safari build: ${path.relative(process.cwd(), out) || out}`);
  console.log(`  ${manifest.name} v${manifest.version}, ${files.length} files`);
  console.log(`  Shim wired into ${worker} and ${pages.length} page(s): ${pages.join(', ')}`);
  if (dropped.permissions.length > 0) console.log(`  Permissions dropped: ${dropped.permissions.join(', ')}`);
  if (dropped.keys.length > 0) console.log(`  Manifest keys dropped: ${dropped.keys.join(', ')}`);
}

main().catch((error) => {
  console.error(`build-safari: ${error.message}`);
  process.exit(1);
});
