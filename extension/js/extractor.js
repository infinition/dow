/**
 * DOW EXTRACTOR ENGINE (EXTENSION INTEGRATED)
 */

window.DowExtractor = {
  async analyze(url) {
    if (!url || typeof url !== 'string') {
      throw new Error("Invalid URL provided.");
    }

    url = url.trim();

    try {
      const response = await fetch(`http://localhost:8085/api/info?url=${encodeURIComponent(url)}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.variants && data.variants.length > 0) {
          return data;
        }
      }
    } catch {
      // Local server fallback
    }

    if (url.includes('.m3u8') || url.includes('format=m3u8')) {
      return await this.extractHlsStream(url);
    }

    return this.extractDirectMedia(url);
  },

  async extractHlsStream(m3u8Url) {
    let thumbnail = "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80";
    const ytMatch = m3u8Url.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) thumbnail = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;

    try {
      const response = await fetch(m3u8Url);
      const text = await response.text();

      if (text.includes('#EXT-X-STREAM-INF')) {
        const variants = this.parseMasterM3u8(text, m3u8Url);
        return {
          title: this.inferTitleFromUrl(m3u8Url, "HLS Master Stream"),
          thumbnail: thumbnail,
          platform: "HLS Stream (.m3u8)",
          duration: "Adaptive HLS",
          uploader: "HLS Publisher",
          variants: variants
        };
      }
    } catch {
      // Fallback
    }

    return {
      title: this.inferTitleFromUrl(m3u8Url, "HLS Media Stream"),
      thumbnail: thumbnail,
      platform: "HLS Stream (.m3u8)",
      duration: "Stream",
      uploader: "HLS Direct",
      variants: [
        { quality: "Best HLS Stream", format_id: "best", resolution: "1920x1080", format: "MP4 / TS", bitrate: "Auto High", url: m3u8Url, isBest: true },
        { quality: "Audio Track", format_id: "bestaudio", resolution: "Audio", format: "MP3", bitrate: "320 kbps", url: m3u8Url, isAudio: true, isBest: false }
      ]
    };
  },

  parseMasterM3u8(m3u8Text, baseUrl) {
    const lines = m3u8Text.split('\n');
    const variants = [];
    let currentBandwidth = 0;
    let currentResolution = "1080p";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bwMatch) currentBandwidth = parseInt(bwMatch[1]);
        const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        if (resMatch) currentResolution = resMatch[1];
      } else if (line.length > 0 && !line.startsWith('#')) {
        const streamUrl = line.startsWith('http') ? line : new URL(line, baseUrl).href;
        variants.push({
          quality: currentResolution.includes('x') ? `${currentResolution.split('x')[1]}p` : currentResolution,
          format_id: "best",
          resolution: currentResolution,
          format: "MP4",
          bitrate: `${Math.round(currentBandwidth / 1000)} kbps`,
          url: streamUrl
        });
      }
    }

    if (variants.length === 0) {
      variants.push({ quality: "1080p HD", format_id: "best", resolution: "1920x1080", format: "MP4", bitrate: "High", url: baseUrl });
    }

    variants[0].isBest = true;
    return variants;
  },

  extractDirectMedia(url) {
    const filename = url.substring(url.lastIndexOf('/') + 1).split('?')[0] || "video_download";
    const ext = filename.split('.').pop().toUpperCase();
    
    let thumbnail = "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=400&q=80";
    const ytMatch = url.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) thumbnail = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;

    return {
      title: filename.replace(/\.[^/.]+$/, ""),
      thumbnail: thumbnail,
      platform: `Direct ${ext} File`,
      duration: "Direct Media",
      uploader: "Direct File Source",
      variants: [
        {
          quality: "Original Direct Source",
          format_id: "best",
          resolution: "Native",
          format: ext,
          bitrate: "Direct Stream",
          url: url,
          isBest: true
        }
      ]
    };
  },

  inferTitleFromUrl(url, fallback) {
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(p => p.length > 0);
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1].replace(/\.[^/.]+$/, "");
        return lastPart.replace(/[-_]/g, " ").toUpperCase();
      }
      return `${parsed.hostname} Stream`;
    } catch {
      return fallback;
    }
  }
};
