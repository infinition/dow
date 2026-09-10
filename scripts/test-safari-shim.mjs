#!/usr/bin/env node
/**
 * Exercises extension/compat/browser-compat.js against a Safari shaped host:
 * no chrome.downloads, no chrome.sidePanel.
 *
 * Each scenario runs in its own process, because the shim reads the host
 * capabilities once at load time and a page and a service worker have to be
 * observed separately.
 *
 * Usage: node scripts/test-safari-shim.mjs [--scenario <name>] [--build <dir>]
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const SHIM = path.join(ROOT, 'extension', 'compat', 'browser-compat.js');

const IMAGES = {
  'https://example.com/photos/first.png': { mime: 'image/png', size: 1024 },
  'https://example.com/photos/second.jpg?width=800': { mime: 'image/jpeg', size: 2048 },
  'https://example.com/unnamed': { mime: 'image/webp', size: 512 },
  'https://example.com/photos/missing.png': { status: 404 },
};

const URLS = Object.keys(IMAGES);
const OK_URLS = URLS.filter((url) => !IMAGES[url].status);

function bodyFor(url) {
  const { size } = IMAGES[url];
  const bytes = new Uint8Array(size);
  // Deterministic, non uniform content so a CRC mismatch cannot pass unnoticed.
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + url.length) & 0xff;
  return bytes;
}

function installHost({ withDocument, native = false }) {
  const saved = [];
  const opened = [];
  const listeners = [];
  const messages = [];

  globalThis.fetch = async (url) => {
    const image = IMAGES[url];
    if (!image) throw new Error(`Unexpected fetch: ${url}`);
    if (image.status) {
      return { ok: false, status: image.status, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const bytes = bodyFor(url);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? image.mime : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };

  const blobs = new Map();
  let counter = 0;
  URL.createObjectURL = (blob) => {
    counter += 1;
    const handle = `blob:test/${counter}`;
    blobs.set(handle, blob);
    return handle;
  };
  URL.revokeObjectURL = (handle) => blobs.delete(handle);

  if (withDocument) {
    globalThis.document = {
      createElement: () => ({
        style: {},
        click() {
          saved.push({ name: this.download, blob: blobs.get(this.href) });
        },
        remove() {},
      }),
      body: { appendChild() {} },
    };
  } else {
    delete globalThis.document;
  }

  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ side_panel: { default_path: 'popup.html' } }),
      getURL: (relative) => `safari-web-extension://test/${relative}`,
      sendMessage: (...args) => {
        messages.push(args[0]);
        const last = args[args.length - 1];
        if (typeof last === 'function') last({ reachedTheWorker: true });
      },
      onMessage: {
        addListener: (listener) => {
          listeners.push(listener);
        },
      },
    },
    tabs: {
      query: (_query, callback) => callback([{ id: 1, windowId: 2 }]),
      create: async (options) => opened.push({ kind: 'tab', ...options }),
    },
    windows: {
      create: async (options) => opened.push({ kind: 'window', ...options }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };

  // A Chromium shaped host: both APIs present, with recognisable identities so
  // the shim can be caught if it ever overwrites one.
  if (native) {
    chrome.downloads = {
      native: true,
      download: () => 'native download',
      onDeterminingFilename: { addListener() {} },
      onChanged: { addListener() {} },
    };
    chrome.sidePanel = { native: true, open: () => 'native side panel' };
  }

  return { saved, opened, listeners, messages };
}

async function unzip(blob, name) {
  const directory = path.join(tmpdir(), 'dow-safari-shim');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

  // Read the archive back with a tool that is not the writer under test, so
  // every CRC and offset gets checked independently.
  const readers = [
    ['python3', ['-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint("\\n".join(f"{i.filename}\\t{i.file_size}" for i in z.infolist()))', file]],
    ['python', ['-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint("\\n".join(f"{i.filename}\\t{i.file_size}" for i in z.infolist()))', file]],
  ];

  for (const [command, args] of readers) {
    const run = spawnSync(command, args, { encoding: 'utf8' });
    if (run.error || run.status !== 0) continue;
    return run.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [filename, size] = line.split('\t');
        return { filename, size: Number(size) };
      });
  }

  const check = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
  if (!check.error && check.status === 0) return null;

  return undefined;
}

function expectedName(url, index) {
  if (url.includes('first')) return 'first.png';
  if (url.includes('second')) return 'second.jpg';
  return `image_${String(index + 1).padStart(3, '0')}.webp`;
}

const scenarios = {
  // A page with no chrome.downloads answers the batch save itself and produces
  // one archive named after the target folder.
  async batch() {
    const host = installHost({ withDocument: true });
    await import(pathToFileURL(SHIM).href);

    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'downloadImages', imagesToDownload: URLS, options: { folder_name: 'My Shots', new_file_name: '' } },
        resolve
      );
    });

    assert.deepEqual(result, { downloaded: 3, failed: 1 }, 'three saved, the 404 reported');
    assert.equal(host.messages.length, 0, 'the request never leaves the page');
    assert.equal(host.saved.length, 1, 'a single file reaches the browser');
    assert.equal(host.saved[0].name, 'My Shots.zip', 'the archive carries the folder name');

    const entries = await unzip(host.saved[0].blob, 'My Shots.zip');
    if (entries === undefined) {
      console.log('  no zip reader available, archive contents not verified');
    } else if (entries === null) {
      console.log('  archive verified with unzip -t');
    } else {
      assert.deepEqual(
        entries.map((entry) => entry.filename),
        OK_URLS.map((url, index) => expectedName(url, index)),
        'entry names follow the Chrome naming rules'
      );
      assert.deepEqual(
        entries.map((entry) => entry.size),
        OK_URLS.map((url) => IMAGES[url].size),
        'entry sizes match the fetched bodies'
      );
      console.log(`  archive verified with a zip reader: ${entries.map((e) => e.filename).join(', ')}`);
    }
  },

  // One image and no folder goes out as the image itself, not as an archive.
  async single() {
    const host = installHost({ withDocument: true });
    await import(pathToFileURL(SHIM).href);

    const url = 'https://example.com/photos/second.jpg?width=800';
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'downloadImages', imagesToDownload: [url], options: {} }, resolve);
    });

    assert.deepEqual(result, { downloaded: 1, failed: 0 });
    assert.equal(host.saved.length, 1);
    assert.equal(host.saved[0].name, 'second.jpg', 'the query string is stripped from the name');
    assert.equal(host.saved[0].blob.type, '', 'the image is not wrapped in an archive');
  },

  // The sequential rename option keeps its padding and its extensions.
  async renamed() {
    const host = installHost({ withDocument: true });
    await import(pathToFileURL(SHIM).href);

    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'downloadImages', imagesToDownload: OK_URLS, options: { folder_name: '', new_file_name: 'shot_' } },
        resolve
      );
    });

    assert.deepEqual(result, { downloaded: 3, failed: 0 });
    assert.equal(host.saved[0].name, 'shot_.zip', 'the archive falls back to the rename stem');

    const entries = await unzip(host.saved[0].blob, 'renamed.zip');
    if (entries && entries.length > 0) {
      assert.deepEqual(
        entries.map((entry) => entry.filename),
        ['shot_1.png', 'shot_2.jpg', 'shot_3.webp'],
        'renamed entries keep the source extension'
      );
      console.log(`  renamed entries: ${entries.map((e) => e.filename).join(', ')}`);
    }
  },

  // Without a side panel API the panel document opens as its own window.
  async sidepanel() {
    const host = installHost({ withDocument: true });
    await import(pathToFileURL(SHIM).href);

    assert.equal(typeof chrome.sidePanel.open, 'function', 'the side panel surface is filled in');
    await chrome.sidePanel.open({ windowId: 2 });

    assert.equal(host.opened.length, 1);
    assert.equal(host.opened[0].kind, 'window');
    assert.match(host.opened[0].url, /popup\.html$/, 'the panel document is reused');
  },

  // On a host that has both APIs the shim must change nothing at all: the Chrome
  // path has to stay exactly what it is today.
  async chromium() {
    const host = installHost({ withDocument: true, native: true });
    await import(pathToFileURL(SHIM).href);

    assert.equal(chrome.downloads.native, true, 'the native downloads API is left alone');
    assert.equal(chrome.downloads.isPolyfill, undefined);
    assert.equal(chrome.downloads.download(), 'native download');
    assert.equal(chrome.sidePanel.native, true, 'the native side panel API is left alone');
    assert.equal(chrome.sidePanel.open(), 'native side panel');

    const answer = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'downloadImages', imagesToDownload: OK_URLS, options: {} }, resolve);
    });

    assert.deepEqual(answer, { reachedTheWorker: true }, 'the batch save still goes to the service worker');
    assert.equal(host.messages.length, 1);
    assert.equal(host.saved.length, 0, 'the shim saves nothing of its own');
  },

  // The real service worker has to load and answer messages on a host with no
  // downloads API. This is the failure that would break the extension outright.
  async worker(options) {
    const worker = path.join(options.build, 'background.js');
    if (!existsSync(worker)) throw new Error(`Missing build, run the Safari build first: ${worker}`);

    const host = installHost({ withDocument: false });

    // The worker is a classic script: its injected importScripts call has to run
    // synchronously, which createRequire reproduces faithfully enough here.
    const { createRequire } = await import('node:module');
    const load = createRequire(pathToFileURL(worker).href);
    globalThis.importScripts = (relative) => load(path.join(options.build, relative));

    load(worker);

    assert.ok(chrome.downloads, 'the downloads surface is filled in for the worker');
    assert.equal(chrome.downloads.isPolyfill, true);
    assert.equal(host.listeners.length, 1, 'the worker registered its message listener');

    const answered = await new Promise((resolve) => {
      const kept = host.listeners[0]({ type: 'downloadImages', imagesToDownload: OK_URLS, options: {} }, {}, resolve);
      assert.equal(kept, true, 'the worker keeps the message channel open');
    });

    assert.equal(Array.isArray(answered), true, 'the worker answers instead of throwing');
    assert.equal(answered.length, OK_URLS.length);
    assert.equal(host.saved.length, 0, 'a worker cannot save on its own, the page does it');
  },
};

function parseArgs(argv) {
  const options = { scenario: null, build: path.join(ROOT, 'dist', 'safari') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scenario') {
      options.scenario = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--build') {
      options.build = path.resolve(argv[i + 1] || '');
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.scenario) {
    const scenario = scenarios[options.scenario];
    if (!scenario) throw new Error(`Unknown scenario: ${options.scenario}`);
    await scenario(options);
    // The shim keeps a long timer alive to revoke its blob URLs, which is right
    // in a browser and would only stall the harness here.
    process.exit(0);
  }

  let failed = 0;
  for (const name of Object.keys(scenarios)) {
    console.log(`- ${name}`);
    const run = spawnSync(process.execPath, [SELF, '--scenario', name, '--build', options.build], { stdio: 'inherit' });
    if (run.status !== 0) {
      failed += 1;
      console.error(`  FAILED: ${name}`);
    }
  }

  if (failed > 0) throw new Error(`${failed} scenario(s) failed`);
  console.log(`${Object.keys(scenarios).length} scenarios passed`);
}

main().catch((error) => {
  console.error(`test-safari-shim: ${error.message}`);
  process.exit(1);
});
