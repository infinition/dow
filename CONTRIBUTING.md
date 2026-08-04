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
│   └── images/
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

## Adding a bookmarklet

One file per bookmarklet in `extension/bookmarklets/`, plus its entry in
`chrome-bookmarklets.js`, which carries the minified copy the launcher actually runs. Keep
both in sync.

`extension/bookmarklets/private/` is ignored by git. Anything you drop there stays local
and is excluded from release packages.
