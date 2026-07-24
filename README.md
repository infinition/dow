# DOW Media Downloader Suite

DOW is a media detection and downloading suite composed of a Chrome Extension (Manifest V3) and a local Node.js backend. It detects web video streams, playlists, audio tracks, and images, allowing direct single-click downloads to disk.

## Features

- Stream Detection: Automatically intercepts HLS (m3u8), MP4, WebM, Apple Music albums, and BunnyStream video links.
- Quality Selection: Custom format selector for 1080p, 720p, 480p, or best available quality via yt-dlp.
- Referer Proxy: Built-in image proxy server to bypass 403 Forbidden checks on protected CDNs.
- Subtitles & Lyrics: Automatic speech-to-text subtitle fetching and LRCLIB synced lyrics embedding.
- Bookmarklets Suite: Integrated catalog to manage and execute custom JavaScript bookmarklets in the page context.
- Duplicate File Protection: Automatic incremental filename suffixing for duplicate media titles.

## Prerequisites

- Node.js 18 or higher
- Google Chrome or Chromium-based browser
- yt-dlp added to system PATH

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/infinition/dow.git
   cd dow
   ```

2. Start the local backend server:
   ```bash
   node server.js
   ```
   Or double-click `start_dow.bat` on Windows.

3. Load the Chrome Extension:
   - Open `chrome://extensions` in your browser.
   - Enable "Developer mode" in the top right corner.
   - Click "Load unpacked" and select the `extension` directory.

## Project Structure

```
dow/
├── extension/          # Chrome Extension Manifest V3 & WebApp source
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── index.html
│   └── bookmarklets/
├── server.js           # Local Node.js server & yt-dlp runner
├── start_dow.bat       # Windows launcher script
├── package.json
└── LICENSE
```

## License

This project is licensed under the MIT License. See the LICENSE file for details.
