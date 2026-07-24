/*
 * Usage:
 * node import-chrome-bookmarklets.js "C:\\path\\to\\Chrome bookmarks export.html"
 */
const fs = require('fs');
const path = require('path');

const sourcePath = process.argv[2];
if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error('Provide the path to a Chrome bookmarks HTML export.');
}

const source = fs.readFileSync(sourcePath, 'utf8');
const folderMatch = /<H3\b[^>]*>Bookmarklets<\/H3>\s*<DL><p>/i.exec(source);
if (!folderMatch) throw new Error('The Bookmarklets folder was not found in this export.');

function decodeHtml(value) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)));
}

function bookmarkletFolder(html, startIndex) {
  const tokens = /<DL><p>|<\/DL><p>/gi;
  tokens.lastIndex = startIndex;
  let depth = 0;
  let match;
  while ((match = tokens.exec(html))) {
    if (match[0].toLowerCase().startsWith('<dl')) depth += 1;
    else if (--depth === 0) return html.slice(startIndex, tokens.lastIndex);
  }
  throw new Error('The Bookmarklets folder has no closing tag.');
}

function normalizeSource(url) {
  const rawSource = url.slice('javascript:'.length);
  return rawSource.replace(/(?:%[0-9a-f]{2})+/gi, (encodedChunk) => {
    try {
      return decodeURIComponent(encodedChunk);
    } catch {
      return encodedChunk;
    }
  });
}

function isExcluded(title, href) {
  if (/bookmarklet highlight similaire/i.test(title)) return false;
  return /paprika|plex|mdp|password|download video without drm/i.test(title)
    || /token=|myPlexAccessToken|type\.toLowerCase\(\)\s*==\s*['"]password/i.test(href);
}

function metadataFor(title) {
  const lowerTitle = title.toLowerCase();
  if (/ml-pro|clipboard|pdf|qrcode|youtube|video|pip|full screen/i.test(lowerTitle)) {
    return { tags: ['Imported', 'Media'], icon: 'fa-film' };
  }
  if (/search|recherche|index|word|fréquence|highlight/i.test(lowerTitle)) {
    return { tags: ['Imported', 'Search'], icon: 'fa-magnifying-glass' };
  }
  if (/click|selection|edit|couleur|link|page/i.test(lowerTitle)) {
    return { tags: ['Imported', 'Page'], icon: 'fa-wand-magic-sparkles' };
  }
  return { tags: ['Imported', 'Utility'], icon: 'fa-puzzle-piece' };
}

function slugFor(title, index) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug || 'bookmarklet'}-${index + 1}`;
}

const folder = bookmarkletFolder(source, folderMatch.index);
const linkPattern = /<A\s+HREF="([^"]+)"[^>]*>(.*?)<\/A>/gis;
const importedDirectory = path.join(__dirname, 'imported');
fs.mkdirSync(importedDirectory, { recursive: true });

const entries = [];
let match;
let index = 0;
while ((match = linkPattern.exec(folder))) {
  const href = decodeHtml(match[1]);
  const title = decodeHtml(match[2].replace(/<[^>]+>/g, '').trim());
  if (!href.startsWith('javascript:') || isExcluded(title, href)) continue;

  const sourceCode = normalizeSource(href);
  const slug = slugFor(title, index);
  const fileName = `${slug}.js`;
  const metadata = metadataFor(title);
  fs.writeFileSync(path.join(importedDirectory, fileName), `${sourceCode}\n`, 'utf8');
  entries.push({
    id: `imported-${slug}`,
    name: title,
    description: 'Imported from the Chrome Bookmarklets folder.',
    tags: metadata.tags,
    icon: metadata.icon,
    file: `bookmarklets/imported/${fileName}`,
    bookmarklet: `javascript:${sourceCode}`
  });
  index += 1;
}

const catalog = `self.DOW_BOOKMARKLETS.push(\n${entries.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n);\n`;
fs.writeFileSync(path.join(__dirname, 'chrome-bookmarklets.js'), catalog, 'utf8');
console.log(`Imported ${entries.length} bookmarklets into ${importedDirectory}.`);