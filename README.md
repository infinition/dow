<p align="center">
  <img src="dow.png" alt="DOW icon: a white download cloud on an orange to yellow gradient" width="120">
</p>

# DOW - Image Downloader & Bookmarklets Suite

DOW is a Chrome extension (Manifest V3) with two tools: a bulk image downloader with
advanced filtering, and a bookmarklet launcher that runs utility scripts against the
active page.

It runs entirely in the browser. There is no backend, no build step, and no external
dependency to install.

## Screenshots

| Image Downloader | Bookmarklets |
|---|---|
| <img src="docs/screenshots/image-downloader.jpg" alt="Image Downloader tab: filter bar with URL, width and height range sliders, and a grid of detected images with format, dimensions and file size" width="420"> | <img src="docs/screenshots/bookmarklets.jpg" alt="Bookmarklets tab: search field, category filters, and a list of bookmarklets each with a Run button" width="420"> |

## Features

### Image Downloader

- Collects every image on the active page, including those inside iframes.
- Filters by URL substring, by width and height ranges, and by file type.
- Deduplicates variants of the same image before listing them.
- Batch download with custom subfolder and filename rules.
- Reconstructs a sane filename from the source URL and MIME type when a page serves
  images without one, instead of letting Chrome save them as "unnamed".

### Bookmarklets

- Catalog of ready-made bookmarklets: reading focus, outline headings, show link URLs,
  allow right-click and text selection, QR code generation, Wayback Machine lookup,
  word frequency counter, picture-in-picture, and more.
- Run any of them on the active tab in one click.
- Add your own, with tags, stored in `chrome.storage.local`.
- Import bookmarklets already saved in your Chrome bookmarks bar.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/infinition/dow.git
   ```

2. Load the extension:
   - Open `chrome://extensions`.
   - Enable **Developer mode** (top right).
   - Click **Load unpacked** and select the `extension` directory.

Alternatively, download `dow-<version>.zip` from the
[Releases](https://github.com/infinition/dow/releases) page, unzip it, and load that
folder instead.

The toolbar icon opens the popup; the icon next to the header toggles the same UI as a
docked side panel.

## Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab`, `scripting` | Scan the current page for images, and execute bookmarklets in it |
| `downloads` | Save the selected images, and shape their filenames |
| `storage` | Remember your filters, options, and custom bookmarklets |
| `tabs` | Reload the image list when you switch or refresh a tab |
| `sidePanel` | Offer the docked side-panel view |
| `<all_urls>` | Work on any site you explicitly open the extension on |

The extension does **not** observe network traffic and registers no `webRequest`
listeners. The service worker only wakes on a download event or a message from the popup,
and content scripts are injected on demand rather than declared against every page.

## Project Structure

```
dow/
├── extension/
│   ├── manifest.json
│   ├── popup.html          # Shell: tab navigation, mounts both tools
│   ├── popup.js            # Tab routing + bookmarklet catalog engine
│   ├── background.js       # Service worker: image download handling, side panel
│   ├── bookmarklets/       # Bookmarklet catalog (one .js per bookmarklet)
│   ├── src/                # Image Downloader app (Preact + signals, no bundler)
│   ├── lib/                # Vendored Preact / htm / noUiSlider ES modules
│   └── images/
├── docs/screenshots/       # README illustrations, not shipped in the package
├── package.json
└── LICENSE
```

`extension/src/style.css` is a **frozen Tailwind build**: there is no Tailwind toolchain
in the project, so new utility classes (and any `dark:` variant) will not resolve. Styling
for the Image Downloader goes in `extension/src/image_downloader_dark.css` as plain CSS
scoped under `#image-downloader-root`.

## Development

There is nothing to compile. Edit the files, then hit reload on the extension in
`chrome://extensions`.

```bash
npm test
```

validates the manifest. CI additionally syntax-checks the extension scripts and verifies
that every entry point the manifest references actually exists.

### Builds and releases

Every push produces a `dow-dev-<sha>` artifact, downloadable from the run page under the
Actions tab. It is the current state of the branch, unversioned, kept 30 days. Use it to
test a change without waiting for a release.

Releases are cut from a tag and never rewritten. To publish a version, bump it in both
`extension/manifest.json` and `package.json`, commit, then:

```bash
git tag v3.1.0 && git push origin v3.1.0
```

The release workflow refuses to run if the tag and the two version fields disagree, so a
mismatched package can never reach the Releases page.

## License

MIT. See the LICENSE file for details.
