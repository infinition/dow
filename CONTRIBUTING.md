# Contributing

## Getting set up

There is nothing to compile. Clone the repository, load `extension/` unpacked from
`chrome://extensions`, edit the files, then hit reload on the extension.

```bash
git clone https://github.com/infinition/dow.git
```

```bash
npm test
```

validates the manifest. CI additionally syntax-checks the extension scripts and verifies
that every entry point the manifest references actually exists.

## Project layout

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
│   ├── compat/             # Feature-detected shim for the APIs Safari lacks
│   └── images/
├── scripts/                # Safari build and its test harness
├── docs/screenshots/       # README illustrations, not shipped in the package
├── package.json
└── LICENSE
```

## Styling constraint, read this before touching CSS

`extension/src/style.css` is a **frozen Tailwind build**. There is no Tailwind toolchain
in the project, so any new utility class, and every `dark:` variant, will silently fail to
resolve. Styling for the Image Downloader goes in `extension/src/image_downloader_dark.css`
as plain CSS scoped under `#image-downloader-root`.

## Builds and releases

Every push produces a `dow-dev-<sha>` artifact, downloadable from the run page under the
Actions tab. It is the current state of the branch, unversioned, kept 30 days. Use it to
test a change without cutting a release.

Releases are cut from a tag and never rewritten. To publish a version, bump it in both
`extension/manifest.json` and `package.json`, commit, then:

```bash
git tag v3.1.0 && git push origin v3.1.0
```

The release workflow refuses to run if the tag and the two version fields disagree, so a
mismatched package can never reach the Releases page.

## The Safari flavour

Nothing under `extension/` is Safari specific, and nothing there is generated. One command
produces the Safari build:

```bash
npm run build:safari
```

It copies `extension/` into `dist/safari/`, drops the manifest entries Safari does not
implement (`downloads`, `sidePanel`, `side_panel`), and wires
`extension/compat/browser-compat.js` into the service worker and into every page.

That shim is feature detected, so it defines only what the host browser is missing and
stays inert on Chromium. It fills in two things:

- `chrome.downloads`. Safari has no API at all, so the batch save is answered in the page,
  which is the only context that can hand a blob to the browser. Images are fetched with
  the manifest host permissions, renamed with the same rules `background.js` applies, then
  emitted as one stored ZIP. The service worker keeps an inert stub so its listener
  registrations do not throw at load.
- `chrome.sidePanel`. Reopens the panel document as a standalone window.

```bash
npm run test:safari
```

builds the flavour and runs `scripts/test-safari-shim.mjs`, which drives the shim against a
Safari shaped host: batch save, single file, sequential rename, side panel fallback, and a
service worker load with no downloads API. The archive it produces is read back with an
independent ZIP reader when `python3` is on the machine, so a bad CRC or offset fails the
run. CI runs both on every push.

The `.app` itself is only built on the macOS runner, by the `safari` job in
`.github/workflows/release.yml`, and uploaded to the release the Chrome job created. It is
signed ad hoc, not notarised. To notarise, add a Developer ID certificate to the repository
secrets and replace the `CODE_SIGN_IDENTITY="-"` line in that job.

## Adding a bookmarklet

One file per bookmarklet in `extension/bookmarklets/`, plus its entry in
`chrome-bookmarklets.js`, which carries the minified copy the launcher actually runs. Keep
both in sync.

`extension/bookmarklets/private/` is ignored by git. Anything you drop there stays local
and is excluded from release packages.
