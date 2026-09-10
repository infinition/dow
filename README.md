<p align="center">
  <img src="dow.png" alt="DOW icon: a white download cloud on an orange to yellow gradient" width="120">
</p>

<h1 align="center">DOW</h1>

<p align="center">
  Bulk image downloader and bookmarklet launcher for Chrome and Safari.<br>
  No backend, no build step, no tracking.
</p>

<p align="center">
  <a href="https://github.com/infinition/dow/releases/latest"><img src="https://img.shields.io/github/v/release/infinition/dow?color=f59e0b" alt="Latest release"></a>
  <a href="https://github.com/infinition/dow/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/infinition/dow/ci.yml?branch=main&label=build" alt="Build status"></a>
  <img src="https://img.shields.io/badge/manifest-v3-4285f4" alt="Manifest V3">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/infinition/dow?color=22c55e&cacheSeconds=3600" alt="MIT license"></a>
</p>

| Image Downloader | Bookmarklets |
|---|---|
| <img src="docs/screenshots/image-downloader.jpg" alt="Image Downloader tab: filter bar with URL, width and height range sliders, and a grid of detected images with format, dimensions and file size" width="420"> | <img src="docs/screenshots/bookmarklets.jpg" alt="Bookmarklets tab: search field, category filters, and a list of bookmarklets each with a Run button" width="420"> |

## Install

### Chrome, Edge, Brave

1. Download `dow-<version>.zip` from the
   [latest release](https://github.com/infinition/dow/releases/latest) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.

The toolbar icon opens the popup. The icon next to the header docks the same interface as
a side panel.

### Safari on macOS

Safari cannot load an extension folder, so the same code ships wrapped in a small macOS
app: `dow-<version>-safari-macos.zip` in the same release.

1. Unzip it and move `Dow.app` to `/Applications`.
2. Clear the quarantine flag macOS puts on anything downloaded:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Dow.app
   ```

3. Launch `Dow.app` once so it registers the extension with Safari, then quit it.
4. In Safari, open **Settings**, **Advanced**, and tick **Show features for web
   developers**. Then in the **Develop** menu, tick **Allow unsigned extensions**.
5. In **Settings**, **Extensions**, enable Dow and grant it access to the sites you want.

The app is built in CI and signed ad hoc rather than notarised, so step 4 is required, and
Safari forgets it each time you quit. Building with a paid Apple Developer ID drops both
step 2 and step 4.

Two behaviours differ on Safari, because the APIs do not exist there:

- No side panel. The docking button opens the same interface in its own window.
- No subfolder when saving. A batch download arrives as one `.zip` named after the
  subfolder you asked for, which macOS unpacks into exactly that folder.

## Features

**Image Downloader**

- Collects every image on the page, including those inside iframes.
- Filters by URL substring, by width and height ranges, and by file type.
- Deduplicates variants of the same image before listing them.
- Batch download with custom subfolder and filename rules.
- Rebuilds a proper filename when a site serves images without one, instead of letting
  Chrome save them all as "unnamed".

**Bookmarklets**

- Ready-made catalog: reading focus, outline headings, show link URLs, allow right-click
  and text selection, QR codes, Wayback Machine lookup, picture-in-picture, and more.
- Run any of them on the active tab in one click.
- Add your own, with tags. Import those already sitting in your bookmarks bar.

## Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab`, `scripting` | Scan the current page for images, and run bookmarklets in it |
| `downloads` | Save the selected images, and shape their filenames |
| `storage` | Remember your filters, options, and custom bookmarklets |
| `tabs` | Refresh the image list when you switch or reload a tab |
| `sidePanel` | Offer the docked side-panel view |
| `<all_urls>` | Work on any site you explicitly open the extension on |

The Safari build asks for neither `downloads` nor `sidePanel`: Safari implements neither,
and `extension/compat/browser-compat.js` covers both at runtime.

DOW never watches your browsing. It registers no `webRequest` listener, sends nothing to
any server, and injects its content script only when you open it on a page.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout, the styling constraints,
and how builds and releases work.

## License

MIT. See [LICENSE](LICENSE).
