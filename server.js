const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { spawn, exec } = require('child_process');

const PORT = 8085;
const YTDLP_PATH = 'yt-dlp';
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

let serverQueue = [];
let activeDownloads = new Map(); // id -> job object
const downloadProcesses = new Map(); // job id -> active yt-dlp child process

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.zip': 'application/zip'
};

// Helper: Smart HTTP Referer Resolver for BunnyStream / BunnyNet / Vimeo / Dailymotion
function resolveReferer(targetUrl, customReferer) {
  if (customReferer && customReferer.startsWith('http')) return customReferer;

  try {
    const u = new URL(targetUrl);
    const host = u.hostname.toLowerCase();

    if (host.includes('b-cdn.net') || host.includes('mediadelivery.net') || host.includes('bunny')) {
      return 'https://iframe.mediadelivery.net/';
    }
    if (host.includes('vimeo') || host.includes('vimeocdn')) {
      return 'https://vimeo.com/';
    }
    if (host.includes('dailymotion') || host.includes('dmcdn')) {
      return 'https://www.dailymotion.com/';
    }
  } catch {}

  return customReferer || targetUrl;
}

// Helper: Fix M4A/MP3 Year 2026, Genre & Embedded Lyrics Metadata for Windows Explorer / Apple Music
function fixAudioMetadata(filePath, releaseYear, genre, artist, title, album, trackNum, lyricsText) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve();

    const ext = path.extname(filePath);
    const tempPath = filePath + `.tmp${ext}`;
    const yearStr = String(releaseYear || '2026').substring(0, 4);
    const genreStr = genre || 'Metal';

    const args = [
      '-y',
      '-i', filePath,
      '-map_metadata', '-1',
      '-metadata', `date=${yearStr}`,
      '-metadata', `year=${yearStr}`,
      '-metadata', `genre=${genreStr}`,
      '-metadata', `artist=${artist || ''}`,
      '-metadata', `title=${title || ''}`,
      '-metadata', `album=${album || ''}`,
      '-metadata', `track=${trackNum || 1}`,
      '-codec', 'copy',
      '-movflags', '+faststart'
    ];

    if (lyricsText) {
      args.push('-metadata', `lyrics=${lyricsText}`);
      args.push('-metadata', `USLT=${lyricsText}`);
    }

    args.push(tempPath);

    const p = spawn('ffmpeg', args);
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(filePath);
          fs.renameSync(tempPath, filePath);
          console.log(`[METADATA FIXED 100%] ${path.basename(filePath)} -> Year: ${yearStr}, Genre: ${genreStr}${lyricsText ? ' (Embedded Lyrics Included)' : ''}`);
        } catch {}
      }
      resolve();
    });
  });
}

// Helper: Fetch Paroles / Lyrics from LRCLIB API with smart fallback
function fetchLyricsForTrack(artist, title) {
  return new Promise((resolve) => {
    if (!title) return resolve(null);

    const cleanTitle = title.replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim();
    const cleanArtist = (artist || '').replace(/,.*$/, '').trim();
    const query = encodeURIComponent(`${cleanArtist ? cleanArtist + ' ' : ''}${cleanTitle}`);
    const apiUrl = `https://lrclib.net/api/search?q=${query}`;

    https.get(apiUrl, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(body);
          if (!results || !Array.isArray(results) || results.length === 0) {
            if (cleanArtist) {
              return fetchLyricsForTrack('', cleanTitle).then(resolve);
            }
            return resolve(null);
          }

          const match = results.find(r => r.syncedLyrics || r.plainLyrics) || results[0];
          resolve({
            syncedLyrics: match.syncedLyrics || null,
            plainLyrics: match.plainLyrics || null,
            trackName: match.trackName,
            artistName: match.artistName
          });
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Helper: Convert LRC Synced Lyrics string to SRT Subtitle format
function convertLrcToSrt(lrcText) {
  if (!lrcText) return '';

  const lines = lrcText.split('\n');
  const items = [];

  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  lines.forEach(line => {
    const match = line.match(timeRegex);
    if (match) {
      const mins = parseInt(match[1]);
      const secs = parseInt(match[2]);
      const msStr = match[3].padEnd(3, '0').substring(0, 3);
      const ms = parseInt(msStr);
      const totalMs = (mins * 60 + secs) * 1000 + ms;
      const text = match[4].trim();

      if (text) {
        items.push({ totalMs, text });
      }
    }
  });

  items.sort((a, b) => a.totalMs - b.totalMs);

  let srtOutput = '';
  items.forEach((item, idx) => {
    const startMs = item.totalMs;
    const nextItem = items[idx + 1];
    const endMs = nextItem ? nextItem.totalMs : startMs + 4000;

    const formatTime = (ms) => {
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const milli = Math.floor(ms % 1000);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(milli).padStart(3,'0')}`;
    };

    srtOutput += `${idx + 1}\n${formatTime(startMs)} --> ${formatTime(endMs)}\n${item.text}\n\n`;
  });

  return srtOutput;
}

// Helper: Run yt-dlp with --flat-playlist and return parsed JSON
function fetchPlaylistViaYtdlp(targetUrl) {
  return new Promise((resolve) => {
    const cmd = `${YTDLP_PATH} -J --flat-playlist --ignore-errors --no-warnings "${targetUrl.replace(/"/g, '\\"')}"`;
    exec(cmd, { maxBuffer: 1024 * 1024 * 100, timeout: 60000 }, (error, stdout) => {
      if (error || !stdout) return resolve(null);
      try {
        const info = JSON.parse(stdout);
        if (!info.entries || info.entries.length === 0) return resolve(null);
        const entries = info.entries.map((e, idx) => ({
          index: idx + 1,
          title: e.title || `Track #${idx + 1}`,
          artist: e.artist || e.channel || e.uploader || "Apple Music Artist",
          album: info.title || "Apple Music Playlist",
          releaseYear: e.release_year ? String(e.release_year) : "2026",
          genre: "Music",
          duration: e.duration ? `${Math.floor(e.duration/60)}:${String(Math.floor(e.duration%60)).padStart(2, '0')}` : '',
          thumbnail: e.thumbnail || info.thumbnail || ''
        }));
        resolve({
          title: info.title || "Apple Music Playlist",
          uploader: info.uploader || info.channel || "Apple Music Artist",
          thumbnail: info.thumbnail || entries[0]?.thumbnail || '',
          releaseYear: "2026",
          genre: "Music",
          isPlaylist: true,
          isAppleMusic: true,
          videoCount: entries.length,
          entries: entries
        });
      } catch { resolve(null); }
    });
  });
}

// Helper: Query iTunes API for Apple Music URL (albums) + fallback via yt-dlp (playlists)
function fetchAppleMusicData(targetUrl) {
  return new Promise((resolve) => {
    // Try iTunes API first for album IDs (numeric)
    const idMatch = targetUrl.match(/id(\d+)/) || targetUrl.match(/\/(\d+)(?:\?|$)/);
    const isPlaylistUrl = targetUrl.includes('/playlist/') || targetUrl.includes('pl.');

    if (!idMatch || isPlaylistUrl) {
      // Playlist URL or no numeric ID: fallback to yt-dlp
      return fetchPlaylistViaYtdlp(targetUrl).then(resolve);
    }

    const albumId = idMatch[1];
    // Use limit=200&sort=recent to get max tracks; Apple Music API pagination
    const apiUrl = `https://itunes.apple.com/lookup?id=${albumId}&entity=song&country=fr`;

    https.get(apiUrl, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.results || data.results.length === 0) return resolve(null);

          const collection = data.results.find(r => r.wrapperType === 'collection') || data.results[0];
          const tracks = data.results.filter(r => r.wrapperType === 'track');

          // If iTunes returned less than 200 and we expect more, fallback to yt-dlp
          if (tracks.length >= 200) {
            return fetchPlaylistViaYtdlp(targetUrl).then(resolve);
          }

          const highResArtwork = collection.artworkUrl100
            ? collection.artworkUrl100.replace('100x100bb', '1400x1400bb')
            : "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80";

          const releaseYear = collection.releaseDate ? collection.releaseDate.substring(0, 4) : "2026";
          const genre = collection.primaryGenreName || "Metal";

          const parsedEntries = tracks.map((t, idx) => ({
            index: t.trackNumber || (idx + 1),
            title: t.trackName || `Track #${idx + 1}`,
            artist: t.artistName || collection.artistName || "Unknown Artist",
            album: collection.collectionName || "Apple Music Album",
            releaseYear: t.releaseDate ? t.releaseDate.substring(0, 4) : releaseYear,
            genre: t.primaryGenreName || genre,
            duration: t.trackTimeMillis ? `${Math.floor(t.trackTimeMillis/60000)}:${Math.floor((t.trackTimeMillis%60000)/1000).toString().padStart(2, '0')}` : 'M4A Track',
            thumbnail: highResArtwork
          }));

          resolve({
            title: collection.collectionName || "Apple Music Album",
            uploader: collection.artistName || "Apple Music Artist",
            thumbnail: highResArtwork,
            releaseYear: releaseYear,
            genre: genre,
            isPlaylist: true,
            isAppleMusic: true,
            videoCount: parsedEntries.length || tracks.length,
            entries: parsedEntries
          });
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Helper: Process array items with concurrency limit
async function asyncPool(poolLimit, items, fn) {
  const results = [];
  const executing = new Set();
  for (const [index, item] of items.entries()) {
    const p = Promise.resolve().then(() => fn(item, index));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 0. API: Image Proxy with Referer Bypassing (Fixes BunnyStream 403 Forbidden for Thumbnails)
  if (pathname === '/api/proxy-image' && req.method === 'GET') {
    const imageUrl = parsedUrl.query.url;
    const referer = resolveReferer(imageUrl, parsedUrl.query.referer);

    if (!imageUrl) {
      res.writeHead(400);
      return res.end();
    }

    try {
      const client = imageUrl.startsWith('https') ? https : http;
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Referer': referer
        }
      };

      client.get(imageUrl, requestOptions, (imgRes) => {
        if (imgRes.statusCode >= 400 && referer !== 'https://iframe.mediadelivery.net/') {
          // Retry with mediadelivery referer fallback
          const fallbackOptions = {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://iframe.mediadelivery.net/'
            }
          };
          client.get(imageUrl, fallbackOptions, (fallbackRes) => {
            res.writeHead(fallbackRes.statusCode, {
              'Content-Type': fallbackRes.headers['content-type'] || 'image/jpeg',
              'Cache-Control': 'public, max-age=86400',
              'Access-Control-Allow-Origin': '*'
            });
            fallbackRes.pipe(res);
          });
          return;
        }

        res.writeHead(imgRes.statusCode, {
          'Content-Type': imgRes.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*'
        });
        imgRes.pipe(res);
      }).on('error', () => {
        res.writeHead(500);
        res.end();
      });
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
    return;
  }

  // 1. API: Extract Stream / Playlist / Apple Music Info via yt-dlp & iTunes API
  if (pathname === '/api/info' && req.method === 'GET') {
    const targetUrl = parsedUrl.query.url;
    const refererHeader = resolveReferer(targetUrl, parsedUrl.query.referer);

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing url parameter' }));
    }

    if (targetUrl.includes('music.apple.com') || targetUrl.includes('apple.com')) {
      console.log(`[APPLE MUSIC INFO] Resolving Apple Music Album: ${targetUrl}`);
      const appleData = await fetchAppleMusicData(targetUrl);

      if (appleData) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          title: appleData.title,
          thumbnail: appleData.thumbnail,
          platform: "Apple Music Album (M4A)",
          uploader: appleData.uploader,
          releaseYear: appleData.releaseYear,
          genre: appleData.genre,
          isPlaylist: true,
          isAppleMusic: true,
          videoCount: appleData.videoCount,
          entries: appleData.entries,
          subtitles: [{ code: 'fr', name: '🇫🇷 Paroles Synchro (.lrc / .srt)' }, { code: 'en', name: '🇬🇧 English Lyrics' }],
          variants: [
            { quality: "Download Full Album (M4A Audio)", format: "M4A", isAudio: true, audioFormat: "m4a", isPlaylist: true, isAppleMusic: true, isBest: true },
            { quality: "Download Full Album (MP3 Audio)", format: "MP3", isAudio: true, audioFormat: "mp3", isPlaylist: true, isAppleMusic: true }
          ]
        }));
      }
    }

    const isHlsOrDirectMedia = targetUrl.match(/\.(m3u8|mpd|mp4|webm|mov|m4v|flv)(\?.*)?$/i);
    const isPlaylistUrl = !isHlsOrDirectMedia && (targetUrl.includes('list=') || targetUrl.includes('/playlist/'));
    console.log(`[INFO REQUEST] Analyzing URL: ${targetUrl} (Referer: ${refererHeader})`);

    const playlistFlag = isPlaylistUrl ? '--flat-playlist' : '--no-playlist';
    const cmd = `${YTDLP_PATH} -J ${playlistFlag} --referer "${refererHeader.replace(/"/g, '\\"')}" "${targetUrl.replace(/"/g, '\\"')}"`;
    
    exec(cmd, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
      let thumbnail = "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80";
      const ytMatch = targetUrl.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) {
        thumbnail = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
      }

      if (error || !stdout) {
        const filename = targetUrl.substring(targetUrl.lastIndexOf('/') + 1).split('?')[0] || "video_download";
        return res.end(JSON.stringify({
          title: filename.replace(/\.[^/.]+$/, "") || "Direct Stream",
          thumbnail: thumbnail,
          platform: targetUrl.includes('.m3u8') ? "HLS Stream" : "Direct Media",
          duration: "Direct Stream",
          uploader: "Web Publisher",
          isPlaylist: false,
          subtitles: [{ code: 'fr', name: '🇫🇷 French Lyrics / Paroles' }, { code: 'en', name: '🇬🇧 English Lyrics / Paroles' }],
          variants: [
            { quality: "Best Video (MP4)", format_id: "best", resolution: "Original", format: "MP4", bitrate: "Native", url: targetUrl, isBest: true },
            { quality: "Audio MP3 (320k)", format_id: "bestaudio", resolution: "Audio", format: "MP3", bitrate: "320 kbps", url: targetUrl, isAudio: true, audioFormat: "mp3" },
            { quality: "Audio M4A (AAC)", format_id: "bestaudio", resolution: "Audio", format: "M4A", bitrate: "256 kbps", url: targetUrl, isAudio: true, audioFormat: "m4a" }
          ]
        }));
      }

      try {
        const info = JSON.parse(stdout);
        const isPlaylist = !isHlsOrDirectMedia && (info._type === 'playlist' || (info.entries && info.entries.length > 0));
        const rawTitle = info.title || "Video Stream";
        const title = (rawTitle.toLowerCase() === 'playlist' || rawTitle.toLowerCase() === 'master') ? 'Video Stream' : rawTitle;

        thumbnail = info.thumbnail || info.thumbnails?.[0]?.url || thumbnail;
        const uploader = info.uploader || info.channel || "Web Source";
        const platform = info.extractor_key || info.extractor || "Web Stream";

        const playlistEntries = (info.entries || []).map((e, idx) => ({
          index: idx + 1,
          title: e.title || `Video #${idx + 1}`,
          url: e.url || e.webpage_url || targetUrl,
          duration: e.duration ? `${Math.floor(e.duration / 60)}:${Math.floor(e.duration % 60)}` : 'Video',
          thumbnail: e.thumbnails?.[0]?.url || thumbnail
        }));

        if (playlistEntries.length > 0 && playlistEntries[0].thumbnail) {
          thumbnail = playlistEntries[0].thumbnail;
        }

        const subtitlesList = [];
        if (info.subtitles) {
          Object.keys(info.subtitles).forEach(langCode => {
            const sub = info.subtitles[langCode];
            subtitlesList.push({
              code: langCode,
              name: sub?.[0]?.name || langCode.toUpperCase()
            });
          });
        }
        if (info.automatic_captions) {
          Object.keys(info.automatic_captions).forEach(langCode => {
            if (!subtitlesList.some(s => s.code === langCode)) {
              subtitlesList.push({
                code: langCode,
                name: `${langCode.toUpperCase()} (Auto)`
              });
            }
          });
        }
        if (subtitlesList.length === 0) {
          subtitlesList.push({ code: 'fr', name: '🇫🇷 French Paroles / Synced Lyrics' });
          subtitlesList.push({ code: 'en', name: '🇬🇧 English Paroles / Synced Lyrics' });
        }

        if (isPlaylist) {
          return res.end(JSON.stringify({
            title,
            thumbnail,
            platform: `${platform} Playlist`,
            uploader,
            isPlaylist: true,
            videoCount: playlistEntries.length,
            entries: playlistEntries,
            subtitles: subtitlesList,
            variants: [
              { quality: "Download Full Playlist (MP4 Video)", format: "MP4", isBest: true, isPlaylist: true },
              { quality: "Download Full Playlist (MP3 Audio)", format: "MP3", isAudio: true, audioFormat: "mp3", isPlaylist: true },
              { quality: "Download Full Playlist (M4A Audio)", format: "M4A", isAudio: true, audioFormat: "m4a", isPlaylist: true }
            ]
          }));
        }

        let durationStr = "Stream";
        if (info.duration || info.duration_string) {
          if (info.duration_string) {
            durationStr = info.duration_string;
          } else {
            const mins = Math.floor(info.duration / 60);
            const secs = Math.floor(info.duration % 60);
            durationStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          }
        }

        const rawFormats = info.formats || [];
        const formatMap = new Map();

        const variants = [];

        rawFormats.forEach(f => {
          if (f.height && f.height >= 240) {
            const h = f.height;
            const key = `${h}p`;
            if (!formatMap.has(key)) {
              formatMap.set(key, {
                quality: `${h}p HD Video`,
                format_id: f.format_id,
                resolution: `${f.width || '?'}x${h}`,
                format: "MP4",
                bitrate: f.tbr ? `${Math.round(f.tbr)} kbps` : "Variable",
                url: targetUrl,
                height: h
              });
            }
          }
        });

        const sortedRes = Array.from(formatMap.values()).sort((a, b) => b.height - a.height);
        
        if (sortedRes.length > 0) {
          sortedRes[0].isBest = true;
          variants.push(...sortedRes);
        } else {
          variants.push({
            quality: "Best Quality Video (MP4)",
            format_id: "bestvideo+bestaudio/best",
            resolution: info.resolution || "MP4",
            format: "MP4",
            bitrate: "Highest Available",
            url: targetUrl,
            isBest: true
          });
        }

        variants.push({
          quality: "Audio MP3 (320k)",
          format_id: "bestaudio/best",
          resolution: "Audio",
          format: "MP3",
          bitrate: "320 kbps",
          url: targetUrl,
          isAudio: true,
          audioFormat: "mp3"
        });

        variants.push({
          quality: "Audio M4A (AAC)",
          format_id: "bestaudio/best",
          resolution: "Audio",
          format: "M4A",
          bitrate: "256 kbps",
          url: targetUrl,
          isAudio: true,
          audioFormat: "m4a"
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          title,
          thumbnail,
          duration: durationStr,
          uploader,
          platform,
          isPlaylist: false,
          subtitles: subtitlesList,
          variants
        }));
      } catch (parseErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Failed to parse video info." }));
      }
    });
    return;
  }

  // API: Get / Save Custom Bookmarklets to Disk
  if (pathname === '/api/bookmarklets/custom') {
    const customJsonPath = path.join(__dirname, 'extension', 'bookmarklets', 'private', 'custom-bookmarklets.json');
    if (req.method === 'GET') {
      try {
        if (fs.existsSync(customJsonPath)) {
          const content = fs.readFileSync(customJsonPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(content);
        }
      } catch (err) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const items = JSON.parse(body);
          const privateDir = path.join(__dirname, 'extension', 'bookmarklets', 'private');
          if (!fs.existsSync(privateDir)) {
            fs.mkdirSync(privateDir, { recursive: true });
          }
          fs.writeFileSync(customJsonPath, JSON.stringify(items, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, count: items.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // 2. API: Add stream to Queue
  if (pathname === '/api/queue' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const item = JSON.parse(body);
        if (!item.url) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Missing url" }));
        }

        const queueItem = {
          id: `queue_${Date.now()}_${Math.floor(Math.random()*1000)}`,
          url: item.url,
          title: item.title || "Web Media Stream",
          thumbnail: item.thumbnail || "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80",
          platform: item.platform || "Chrome Extension",
          addedAt: new Date().toLocaleTimeString(),
          status: 'queued'
        };

        serverQueue.unshift(queueItem);
        console.log(`[QUEUE ADDED] ${queueItem.title} (${queueItem.url})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, item: queueItem }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  }

  // 3. API: Get active server queue
  if (pathname === '/api/queue' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ queue: serverQueue }));
    return;
  }

  // 4. API: Start Download (With Embedded Paroles/Lyrics + Smart Referer Resolver)
  if (pathname === '/api/download-to-disk' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const item = JSON.parse(body);
        const targetUrl = item.url;
        const refererUrl = resolveReferer(targetUrl, item.referer || item.page_url);

        const isHlsOrDirectMedia = targetUrl && targetUrl.match(/\.(m3u8|mpd|mp4|webm|mov|m4v|flv)(\?.*)?$/i);
        const isAppleMusic = item.is_apple_music || (targetUrl && targetUrl.includes('music.apple.com'));
        const isPlaylist = !isHlsOrDirectMedia && (item.is_playlist || (targetUrl && targetUrl.includes('list=')) || isAppleMusic);
        const formatId = item.format_id || 'bestvideo+bestaudio/best';
        let rawFilename = item.filename || 'video.mp4';

        if (rawFilename.toLowerCase().startsWith('playlist') || rawFilename.toLowerCase().startsWith('master')) {
          const cleanTitle = (item.title && item.title !== 'playlist' && item.title !== 'master') ? item.title : 'Video_Stream';
          rawFilename = `${cleanTitle}.${rawFilename.endsWith('.mp3') ? 'mp3' : rawFilename.endsWith('.m4a') ? 'm4a' : 'mp4'}`;
        }

        const audioFormat = item.audio_format || (rawFilename.endsWith('.m4a') ? 'm4a' : rawFilename.endsWith('.mp3') ? 'mp3' : null);
        const isAudio = item.is_audio || !!audioFormat || isAppleMusic;
        const subLang = item.sub_lang || null;
        const embedSubs = item.embed_subs !== false;
        const embedLyrics = item.embed_lyrics !== false; // Default true!

        const selectedIndices = Array.isArray(item.selected_indices) && item.selected_indices.length > 0 ? item.selected_indices : null;

        if (!targetUrl) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Missing url parameter" }));
        }

        let safeFilename = rawFilename.replace(/[^\w\s.-]/gi, '_').trim();
        const reqExt = isAudio ? `.${audioFormat || 'm4a'}` : '.mp4';
        safeFilename = safeFilename.replace(/\.(mp4|mp3|m4a|webm|mkv)$/i, '');

        const jobId = `job_${Date.now()}_${Math.floor(Math.random()*1000)}`;
        
        let outputTemplate = "";
        let destinationFolder = DOWNLOADS_DIR;

        if (isPlaylist) {
          const playlistFolderName = (item.title || "YouTube Playlist").replace(/[^\w\s.-]/gi, '_').trim();
          destinationFolder = path.join(DOWNLOADS_DIR, playlistFolderName);
          if (!fs.existsSync(destinationFolder)) {
            fs.mkdirSync(destinationFolder, { recursive: true });
          }
          outputTemplate = path.join(destinationFolder, `%(playlist_index)s - %(title)s.${isAudio ? (audioFormat || 'm4a') : 'mp4'}`);
        } else {
          let baseName = safeFilename;
          let counter = 1;
          let candidate = `${baseName}${reqExt}`;
          
          while (
            fs.existsSync(path.join(DOWNLOADS_DIR, candidate)) ||
            Array.from(activeDownloads.values()).some(d => d.filename === candidate && d.status === 'downloading')
          ) {
            counter++;
            candidate = `${baseName} (${counter})${reqExt}`;
          }
          safeFilename = candidate;
          outputTemplate = path.join(DOWNLOADS_DIR, safeFilename);
        }

        const job = {
          id: jobId,
          title: item.title || safeFilename,
          filename: safeFilename,
          quality: item.quality || (isAudio ? `Audio (${audioFormat ? audioFormat.toUpperCase() : 'M4A'})` : 'Best Video'),
          platform: item.platform || (isAppleMusic ? 'Apple Music Album' : 'Dow Engine'),
          thumbnail: item.thumbnail || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80',
          outputPath: destinationFolder,
          percent: 0,
          speed: 'Starting...',
          eta: '...',
          status: 'downloading',
          isPlaylist: isPlaylist,
          isAppleMusic: isAppleMusic,
          currentVideoIndex: 1,
          totalVideos: selectedIndices ? selectedIndices.length : (item.video_count || 1),
          currentTrackTitle: isAppleMusic ? 'Fetching tracklist...' : isPlaylist ? 'Initializing playlist...' : safeFilename,
          startTime: Date.now()
        };

        activeDownloads.set(jobId, job);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, job }));

        // APPLE MUSIC CONCURRENT DOWNLOAD ENGINE
        if (isAppleMusic) {
          console.log(`[APPLE MUSIC DOWNLOAD START] ${job.title} -> ${destinationFolder}`);
          const appleData = await fetchAppleMusicData(targetUrl);
          let tracks = (appleData && appleData.entries && appleData.entries.length > 0)
            ? appleData.entries
            : [{ index: 1, title: item.title, artist: item.uploader || "Artist", album: item.title, releaseYear: "2026", genre: "Metal" }];

          if (selectedIndices) {
            tracks = tracks.filter(t => selectedIndices.includes(t.index));
          }

          job.totalVideos = tracks.length;
          let completedCount = 0;
          let hasError = false;
          const CONCURRENCY = Math.min(3, tracks.length); // Max 3 downloads at once

          await asyncPool(CONCURRENCY, tracks, async (t, i) => {
            if (job.status === 'cancelled') return;

            const baseTrackName = `${String(t.index).padStart(2, '0')} - ${(t.title || 'Track').replace(/[^\w\s.-]/gi, '_')}`;
            const cleanTrackName = `${baseTrackName}.${audioFormat || 'm4a'}`;
            const trackOutputPath = path.join(destinationFolder, cleanTrackName);

            job.currentTrackTitle = cleanTrackName;
            console.log(`[APPLE MUSIC TRACK ${i+1}/${tracks.length}] ${cleanTrackName}`);

            // Fetch lyrics in parallel with download
            let fetchedLyricsText = null;
            const lyricsPromise = fetchLyricsForTrack(t.artist, t.title).then(lyricsObj => {
              if (lyricsObj) {
                if (lyricsObj.syncedLyrics) {
                  fetchedLyricsText = lyricsObj.syncedLyrics;
                  const lrcPath = path.join(destinationFolder, `${baseTrackName}.lrc`);
                  fs.writeFile(lrcPath, lyricsObj.syncedLyrics, () => {});
                  const srtPath = path.join(destinationFolder, `${baseTrackName}.srt`);
                  fs.writeFile(srtPath, convertLrcToSrt(lyricsObj.syncedLyrics), () => {});
                  console.log(`[PAROLES LYRICS SAVED] ${baseTrackName}.lrc & .srt`);
                } else if (lyricsObj.plainLyrics) {
                  fetchedLyricsText = lyricsObj.plainLyrics;
                  const txtPath = path.join(destinationFolder, `${baseTrackName}.txt`);
                  fs.writeFile(txtPath, lyricsObj.plainLyrics, () => {});
                  console.log(`[PAROLES PLAIN LYRICS SAVED] ${baseTrackName}.txt`);
                }
              }
            }).catch(() => {});

            const searchQuery = `ytsearch1:${t.artist} ${t.title} ${t.album}`;
            const fmt = audioFormat === 'mp3' ? 'mp3' : 'm4a';
            const trackYear = String(t.releaseYear || "2026").substring(0, 4);
            const trackGenre = t.genre || "Metal";

            const args = [
              '--newline',
              '--extractor-args', 'youtube:player_client=android,web',
              '-f', 'ba/b', '-x', '--audio-format', fmt, '--audio-quality', '0',
              '--embed-thumbnail',
              '--convert-thumbnails', 'jpg',
              '-o', trackOutputPath,
              '--retries', '10',
              '--fragment-retries', '10',
              searchQuery
            ];

            // Wait for lyrics fetch while download starts
            await lyricsPromise;

            await new Promise((resolveTrack) => {
              if (job.status === 'cancelled') { resolveTrack(); return; }

              const child = spawn(YTDLP_PATH, args);
              downloadProcesses.set(jobId, child);

              child.stdout.on('data', (d) => {
                const str = d.toString();
                const percentMatch = str.match(/(\d+(?:\.\d+)?)%/);
                const speedMatch = str.match(/at\s+([\d\w./]+)/);
                const etaMatch = str.match(/ETA\s+([\d:]+)/);
                if (percentMatch) job.percent = parseFloat(percentMatch[1]);
                if (speedMatch) job.speed = speedMatch[1];
                if (etaMatch) job.eta = etaMatch[1];
              });

              child.on('close', async (code) => {
                if (downloadProcesses.get(jobId) === child) downloadProcesses.delete(jobId);
                if (code !== 0 && code !== null) {
                  console.error(`[APPLE MUSIC TRACK ERROR] ${cleanTrackName} (exit code ${code})`);
                  hasError = true;
                } else {
                  const lyricsToEmbed = embedLyrics ? fetchedLyricsText : null;
                  await fixAudioMetadata(trackOutputPath, trackYear, trackGenre, t.artist, t.title, t.album, t.index, lyricsToEmbed);
                }
                completedCount++;
                job.currentVideoIndex = completedCount;
                resolveTrack();
              });
            });
          });

          if (job.status === 'cancelled') {
            job.speed = 'Cancelled';
            job.eta = '0s';
            console.log(`[APPLE MUSIC CANCELLED] ${job.title}`);
          } else if (hasError) {
            job.percent = completedCount > 0 ? Math.round((completedCount / tracks.length) * 100) : 0;
            job.speed = 'Completed with errors';
            job.eta = '0s';
            job.status = 'completed';
            console.log(`[APPLE MUSIC COMPLETE WITH ERRORS] ${job.title} - ${completedCount}/${tracks.length} tracks`);
          } else {
            job.percent = 100;
            job.speed = 'Done';
            job.eta = '0s';
            job.status = 'completed';
            console.log(`[APPLE MUSIC COMPLETE] ${job.title} - ${tracks.length} tracks`);
          }
          return;
        }

        // STANDARD YOUTUBE PLAYLIST & SINGLE VIDEO ENGINE (WITH REFERER & USER-AGENT)
        console.log(`[DOWNLOAD START] ${safeFilename} -> ${destinationFolder} (Referer: ${refererUrl})`);

        let args = [
          '--newline',
          '--referer', refererUrl,
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          '--extractor-args', 'youtube:player_client=android,web',
          '--embed-thumbnail',
          '--convert-thumbnails', 'jpg',
          '--retries', '15',
          '--fragment-retries', '15',
          '--retry-sleep', 'linear=1:5:10',
          '--sleep-interval', '1',
          '--max-sleep-interval', '3'
        ];

        if (selectedIndices && selectedIndices.length > 0) {
          args.push('--playlist-items', selectedIndices.join(','));
        }

        if (isAudio) {
          const fmt = audioFormat === 'm4a' ? 'm4a' : 'mp3';
          args.push('-f', 'ba/b', '-x', '--audio-format', fmt, '--audio-quality', '0');
        } else {
          args.push('-f', isPlaylist ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' : formatId);
        }

        if (subLang) {
          args.push(
            '--write-subs',
            '--write-auto-subs',
            '--sub-langs', `${subLang},fr,en,all`,
            '--sub-format', 'srt',
            '--convert-subs', 'srt'
          );
          if (!isAudio && embedSubs) {
            args.push('--embed-subs');
          }
        }

        args.push('-o', outputTemplate);
        args.push(targetUrl);

        const child = spawn(YTDLP_PATH, args);
        downloadProcesses.set(jobId, child);

        child.stdout.on('data', (data) => {
          const str = data.toString();
          
          const itemIndexMatch = str.match(/Downloading (?:item|video) (\d+) of (\d+)/i);
          if (itemIndexMatch) {
            job.currentVideoIndex = parseInt(itemIndexMatch[1]);
            job.totalVideos = parseInt(itemIndexMatch[2]);
          }

          if (str.includes('[download] Destination:')) {
            const destMatch = str.match(/Destination:\s*(.+)/);
            if (destMatch) {
              const fullDest = destMatch[1].trim();
              job.currentTrackTitle = path.basename(fullDest);
              if (!isPlaylist) job.outputPath = fullDest;
            }
          }

          const percentMatch = str.match(/(\d+(?:\.\d+)?)%/);
          const speedMatch = str.match(/at\s+([\d\w./]+)/);
          const etaMatch = str.match(/ETA\s+([\d:]+)/);

          if (percentMatch) job.percent = parseFloat(percentMatch[1]);
          if (speedMatch) job.speed = speedMatch[1];
          if (etaMatch) job.eta = etaMatch[1];
        });

        child.on('close', async (code) => {
          if (downloadProcesses.get(jobId) === child) downloadProcesses.delete(jobId);

          if (job.status === 'cancelled') {
            job.speed = 'Cancelled';
            job.eta = '0s';
            console.log(`[DISK DOWNLOAD CANCELLED] ${job.title}`);
          } else if (code === 0) {
            if (!isPlaylist && fs.existsSync(outputTemplate)) {
              let fetchedLyricsText = null;
              if (embedLyrics) {
                const lyricsObj = await fetchLyricsForTrack(item.uploader, item.title);
                if (lyricsObj) fetchedLyricsText = lyricsObj.syncedLyrics || lyricsObj.plainLyrics;
              }
              await fixAudioMetadata(outputTemplate, '2026', 'Metal', item.uploader, item.title, item.title, 1, fetchedLyricsText);
            }
            job.percent = 100;
            job.speed = 'Done';
            job.eta = '0s';
            job.status = 'completed';
            console.log(`[DISK DOWNLOAD COMPLETE] ${job.title}`);
          } else {
            job.status = 'error';
            console.error(`[DISK DOWNLOAD ERROR] ${job.title} exited with code ${code}`);
          }
        });
      } catch (err) {
        console.error(err);
      }
    });
    return;
  }

  // 5. API: Download Subtitles / Paroles Only (.srt & .lrc)
  if (pathname === '/api/download-subtitles' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const item = JSON.parse(body);
        const targetUrl = item.url;
        const lang = item.lang || 'fr';
        const rawTitle = (item.title || 'subtitles').replace(/[^\w\s.-]/gi, '_');

        if (!targetUrl) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Missing url" }));
        }

        const isAppleMusic = targetUrl.includes('music.apple.com') || targetUrl.includes('apple.com');
        let artistName = item.artist || '';
        let trackTitle = rawTitle;

        if (isAppleMusic) {
          const appleData = await fetchAppleMusicData(targetUrl);
          if (appleData) {
            artistName = appleData.uploader || '';
            if (appleData.entries && appleData.entries.length > 0) {
              trackTitle = appleData.entries[0].title;
            }
          }
        }

        console.log(`[SUBTITLES / PAROLES REQUESTED] Target: ${trackTitle} by ${artistName}`);

        const lyrics = await fetchLyricsForTrack(artistName, trackTitle);
        if (lyrics && (lyrics.syncedLyrics || lyrics.plainLyrics)) {
          if (lyrics.syncedLyrics) {
            const srtContent = convertLrcToSrt(lyrics.syncedLyrics);
            const srtPath = path.join(DOWNLOADS_DIR, `${rawTitle}.${lang}.srt`);
            const lrcPath = path.join(DOWNLOADS_DIR, `${rawTitle}.lrc`);

            fs.writeFileSync(srtPath, srtContent, 'utf-8');
            fs.writeFileSync(lrcPath, lyrics.syncedLyrics, 'utf-8');

            console.log(`[PAROLES SAVED] ${rawTitle}.${lang}.srt & .lrc`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `Paroles (.srt et .lrc) enregistrées dans Téléchargements !` }));
          } else if (lyrics.plainLyrics) {
            const txtPath = path.join(DOWNLOADS_DIR, `${rawTitle}.txt`);
            fs.writeFileSync(txtPath, lyrics.plainLyrics, 'utf-8');

            console.log(`[PAROLES SAVED] ${rawTitle}.txt`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `Paroles enregistrées sous ${rawTitle}.txt` }));
          }
        }

        const outputTemplate = path.join(DOWNLOADS_DIR, `${rawTitle}.%(ext)s`);
        console.log(`[SUBTITLES YT-DLP START] Language: ${lang} -> ${outputTemplate}`);

        const args = [
          '--skip-download',
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs', `${lang},fr,en,all`,
          '--sub-format', 'srt',
          '--convert-subs', 'srt',
          '-o', outputTemplate,
          targetUrl
        ];

        const child = spawn(YTDLP_PATH, args);

        child.on('close', (code) => {
          if (code === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Sous-titres enregistrés sous ${rawTitle}.${lang}.srt` }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: "Failed to download subtitles." }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 6. API: Get Active Downloads status
  if (pathname === '/api/active-downloads' && req.method === 'GET') {
    const list = Array.from(activeDownloads.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ downloads: list }));
    return;
  }

  // 7. API: Cancel an active yt-dlp job
  if (pathname === '/api/cancel-download' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const item = JSON.parse(body || '{}');
        const job = item.id
          ? activeDownloads.get(item.id)
          : Array.from(activeDownloads.values()).find(candidate => candidate.filename === item.filename && candidate.status === 'downloading');

        if (!job || job.status !== 'downloading') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Active download not found.' }));
        }

        job.status = 'cancelled';
        job.speed = 'Cancelled';
        job.eta = '0s';

        const child = downloadProcesses.get(job.id);
        if (child?.pid) {
          spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        }

        console.log(`[DOWNLOAD CANCEL REQUESTED] ${job.title}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, job }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8. API: Clear completed active downloads
  if (pathname === '/api/clear-active' && req.method === 'POST') {
    for (const [id, job] of activeDownloads.entries()) {
      if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
        activeDownloads.delete(id);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 9. API: Open File / Folder Location in Windows Explorer
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const item = JSON.parse(body);
        let targetPath = item.filePath || (item.filename ? path.join(DOWNLOADS_DIR, item.filename) : DOWNLOADS_DIR);

        console.log(`[OPEN FOLDER REQUESTED] Target path: ${targetPath}`);

        if (!fs.existsSync(targetPath)) {
          targetPath = DOWNLOADS_DIR;
        }

        if (fs.statSync(targetPath).isDirectory()) {
          const p = spawn('explorer.exe', [targetPath], { detached: true, stdio: 'ignore' });
          p.unref();
        } else {
          const p = spawn('explorer.exe', ['/select,', targetPath], { detached: true, stdio: 'ignore' });
          p.unref();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error(`[OPEN FOLDER ERROR]`, err);
        try {
          const p = spawn('explorer.exe', [DOWNLOADS_DIR], { detached: true, stdio: 'ignore' });
          p.unref();
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    });
    return;
  }

  // Serve Static Frontend Files (Default to extension/ directory)
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  let filePath = path.join(__dirname, 'extension', relativePath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, relativePath);
  }
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` DOW LOCAL EDITION SERVER RUNNING AT:`);
  console.log(` http://localhost:${PORT}`);
  console.log(` Image Proxy (/api/proxy-image) + Referer Engine Active`);
  console.log(`====================================================`);
});
