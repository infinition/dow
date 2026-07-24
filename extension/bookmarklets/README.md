# DOW Bookmarklets

Each bookmarklet is a standalone JavaScript file in this folder.

To add one:

1. Create a new `.js` file here. Keep it self-contained because Chrome injects the file into the active page.
2. Add its `id`, display metadata, tags, icon, and file path to `catalog.js`.
3. Reload the unpacked DOW extension from `chrome://extensions`.

Bookmarklets may run only on normal `http` and `https` pages. Chrome blocks injection into its internal pages, the Chrome Web Store, and other restricted browser surfaces.