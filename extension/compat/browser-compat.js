/**
 * DOW BROWSER COMPATIBILITY SHIM
 *
 * Fills the gaps between Chromium and Safari so a single codebase serves both.
 * Every patch is feature detected, so this file is inert on Chrome, Edge and
 * Brave: it only defines what the host browser is missing.
 *
 * Safari 18 does not implement:
 *   - chrome.downloads (no API at all, so no batch save and no folder support)
 *   - chrome.sidePanel (no side panel surface)
 *
 * Loaded first in every context by scripts/build-safari.mjs. In the service
 * worker it stops background.js from throwing on the missing downloads
 * listeners. In extension pages it takes over the batch save: images are
 * fetched with the extension host permissions, renamed with the same rules
 * background.js applies, then handed to the browser as one archive.
 */

(function () {
  'use strict';

  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  const isDocument = typeof document !== 'undefined';

  // Filename shaping
  // Mirrors background.js. Kept standalone on purpose: background.js is a
  // classic service worker script with no exports, and this shim has to stay
  // loadable on its own in both the worker and the page.

  function extensionFromMime(mime) {
    if (!mime) return '';
    const subtype = mime.split('/')[1]?.split(';')[0]?.trim();
    if (!subtype) return '';
    return subtype.replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('x-icon', 'ico');
  }

  function deriveFilenameFromUrl(url, mime, index) {
    let base = '';

    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        base = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
        base = base.split('?')[0].split('#')[0].trim();

        if (!base || base.toLowerCase().startsWith('unnamed') || !/\.[a-z0-9]{2,5}$/i.test(base)) {
          for (const [, value] of parsed.searchParams.entries()) {
            if (value && /\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(value)) {
              base = decodeURIComponent(value.substring(value.lastIndexOf('/') + 1));
              break;
            }
          }
        }
      } catch {
        base = '';
      }
    }

    base = base.replace(/[^\w\s.-]/gi, '_').trim();
    if (base.toLowerCase().startsWith('unnamed')) base = '';

    const hasExtension = /\.[a-z0-9]{2,5}$/i.test(base);

    if (!base) {
      base = `image_${String(index + 1).padStart(3, '0')}`;
    }

    if (!hasExtension) {
      base += `.${extensionFromMime(mime) || 'jpg'}`;
    }

    return base;
  }

  function shapeFilename(url, mime, index, total, options) {
    if (options && options.new_file_name) {
      const fromUrl = deriveFilenameFromUrl(url, mime, index);
      const extension = /(?:\.([^.]+))?$/.exec(fromUrl)?.[1] || extensionFromMime(mime);
      const digits = String(total).length;
      const number = String(index + 1).padStart(digits, '0');
      return `${options.new_file_name}${number}${extension ? `.${extension}` : ''}`;
    }
    return deriveFilenameFromUrl(url, mime, index);
  }

  function sanitizeSegment(name) {
    return String(name || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/^\.+/, '')
      .trim();
  }

  function uniquify(name, taken) {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    let counter = 2;
    let candidate = `${stem} (${counter})${extension}`;
    while (taken.has(candidate)) {
      counter += 1;
      candidate = `${stem} (${counter})${extension}`;
    }
    taken.add(candidate);
    return candidate;
  }

  // ZIP writer, stored entries only
  // Images are already compressed, so deflate would buy nothing and would drag
  // in a dependency. This keeps the extension free of a build step.

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let bit = 0; bit < 8; bit += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosTime(date) {
    return ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  }

  function dosDate(date) {
    return (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  }

  function buildZip(entries) {
    const encoder = new TextEncoder();
    const now = new Date();
    const time = dosTime(now);
    const date = dosDate(now);
    const parts = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const crc = crc32(entry.bytes);
      const size = entry.bytes.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 filename
      lv.setUint16(8, 0, true); // stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const directory = new Uint8Array(46 + nameBytes.length);
      const dv = new DataView(directory.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, time, true);
      dv.setUint16(14, date, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, size, true);
      dv.setUint32(24, size, true);
      dv.setUint16(28, nameBytes.length, true);
      dv.setUint16(30, 0, true);
      dv.setUint16(32, 0, true);
      dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true);
      dv.setUint32(38, 0, true);
      dv.setUint32(42, offset, true);
      directory.set(nameBytes, 46);

      parts.push(local, entry.bytes);
      central.push(directory);
      offset += local.length + size;
    }

    let centralSize = 0;
    for (const directory of central) centralSize += directory.length;

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  // Saving from a page
  // An extension page can fetch cross origin with the manifest host permissions
  // and hand a blob to the browser through an anchor, which is the only save
  // path Safari offers without chrome.downloads.

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    // Safari reads the blob asynchronously, so the URL has to outlive the click.
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  }

  async function fetchBytes(url) {
    const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    return { bytes: new Uint8Array(buffer), mime: response.headers.get('content-type') || '' };
  }

  async function mapWithLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  function archiveName(urls, options) {
    const folder = sanitizeSegment(options && options.folder_name);
    if (folder) return folder;

    const stem = sanitizeSegment(options && options.new_file_name);
    if (stem) return stem;

    for (const url of urls) {
      try {
        return sanitizeSegment(new URL(url).hostname.replace(/^www\./, '')) || 'images';
      } catch {
        // Keep looking: data and blob URLs carry no hostname.
      }
    }
    return 'images';
  }

  async function saveImages(urls, options) {
    const total = urls.length;
    const failures = [];

    const fetched = await mapWithLimit(urls, 4, async (url, index) => {
      try {
        const { bytes, mime } = await fetchBytes(url);
        return { bytes, name: shapeFilename(url, mime, index, total, options) };
      } catch (error) {
        failures.push({ url, message: error.message });
        return null;
      }
    });

    const taken = new Set();
    const entries = [];
    for (const entry of fetched) {
      if (!entry) continue;
      entries.push({ bytes: entry.bytes, name: uniquify(sanitizeSegment(entry.name), taken) });
    }

    for (const failure of failures) {
      console.error(`${failure.url}:`, failure.message);
    }

    if (entries.length === 0) {
      return { downloaded: 0, failed: failures.length };
    }

    // A single file goes out as itself. Anything bulkier goes out as one
    // archive: Safari cannot place a file in a subfolder, and macOS unpacks a
    // multi entry archive into a folder named after it.
    if (entries.length === 1 && !(options && options.folder_name)) {
      saveBlob(new Blob([entries[0].bytes]), entries[0].name);
    } else {
      saveBlob(buildZip(entries), `${archiveName(urls, options)}.zip`);
    }

    return { downloaded: entries.length, failed: failures.length };
  }

  // chrome.downloads

  function inertEvent() {
    return { addListener() {}, removeListener() {}, hasListener: () => false };
  }

  if (!chrome.downloads) {
    chrome.downloads = {
      isPolyfill: true,
      // background.js registers both of these at load time. Safari never fires
      // them, so the renaming they do happens in saveImages instead.
      onDeterminingFilename: inertEvent(),
      onChanged: inertEvent(),
      onCreated: inertEvent(),
      download(options, callback) {
        const url = options && options.url;
        if (!isDocument || !url) {
          if (typeof callback === 'function') callback(undefined);
          return Promise.resolve(undefined);
        }

        const done = fetchBytes(url)
          .then(({ bytes, mime }) => {
            const name = sanitizeSegment(options.filename) || deriveFilenameFromUrl(url, mime, 0);
            saveBlob(new Blob([bytes]), name);
            return 1;
          })
          .catch((error) => {
            console.error(`${url}:`, error.message);
            return undefined;
          });

        if (typeof callback === 'function') {
          done.then(callback);
          return undefined;
        }
        return done;
      },
    };
  }

  // Batch save routing
  // The request is answered in the page instead of the service worker, because
  // only a document can hand a blob to the browser. The message contract is
  // untouched, so nothing upstream changes.

  if (isDocument && chrome.downloads.isPolyfill && typeof chrome.runtime.sendMessage === 'function') {
    const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

    chrome.runtime.sendMessage = function (...args) {
      const message = args[0];
      const last = args[args.length - 1];
      const callback = typeof last === 'function' ? last : null;
      const mine =
        message &&
        typeof message === 'object' &&
        message.type === 'downloadImages' &&
        Array.isArray(message.imagesToDownload);

      if (!mine) return nativeSendMessage(...args);

      const done = saveImages(message.imagesToDownload, message.options || {}).catch((error) => {
        console.error('Batch save failed:', error);
        return { downloaded: 0, failed: message.imagesToDownload.length };
      });

      if (callback) {
        done.then(callback);
        return undefined;
      }
      return done;
    };
  }

  // chrome.sidePanel
  // Safari has no side panel. The panel document is the same popup.html, so it
  // opens as a standalone window instead and the button keeps its meaning.

  if (!chrome.sidePanel) {
    const panelPath = chrome.runtime.getManifest()?.side_panel?.default_path || 'popup.html';

    chrome.sidePanel = {
      isPolyfill: true,
      async open() {
        const url = chrome.runtime.getURL(panelPath);
        try {
          await chrome.windows.create({ url, type: 'popup', width: 560, height: 720 });
        } catch {
          await chrome.tabs.create({ url });
        }
      },
      async setOptions() {},
      async getOptions() {
        return { path: panelPath, enabled: true };
      },
      async setPanelBehavior() {},
      async getPanelBehavior() {
        return { openPanelOnActionClick: false };
      },
    };
  }
})();
