/**
 * DOW COMPANION - CONTENT SCRIPT
 * Runs across all frames (including embedded BunnyStream / mediadelivery.net / Vimeo / YouTube iframes).
 * Extracts real course/video title, captures live video frames for animated thumbnails, and detects durations.
 */

(function() {
  if (globalThis.__dowContentMediaBridge) {
    rescanMedia();
    return;
  }
  globalThis.__dowContentMediaBridge = true;

  const drmPattern = /(?:license|widevine|playready|fairplay|drm)/i;
  let previewTimer = null;

  function getRealTitle() {
    // 1. Try parent document title
    try {
      if (window.top && window.top.document) {
        const topTitle = window.top.document.title ? window.top.document.title.trim() : '';
        const cleanTopTitle = topTitle.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo|Coursera|Udemy).*$/i, '').trim();
        if (cleanTopTitle && !/^(?:mediadelivery|bunnystream|player|embed)$/i.test(cleanTopTitle)) {
          // Check for sub-heading (lecture name)
          const h1 = window.top.document.querySelector('h1, h2, .lecture-title, .course-title');
          if (h1 && h1.textContent.trim() && !cleanTopTitle.includes(h1.textContent.trim())) {
            return `${cleanTopTitle} - ${h1.textContent.trim()}`;
          }
          return cleanTopTitle;
        }
      }
    } catch (e) {
      // Cross-origin iframe
    }

    // 2. Try current frame title & headings
    let docTitle = document.title ? document.title.trim() : '';
    docTitle = docTitle.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo|Coursera|Udemy).*$/i, '').trim();

    const h1 = document.querySelector('h1, h2, .lecture-title, .course-title');
    const headingText = h1 ? h1.textContent.trim() : '';

    if (docTitle && headingText && !docTitle.includes(headingText) && !/^(?:mediadelivery|bunnystream|player|embed)$/i.test(docTitle)) {
      return `${docTitle} - ${headingText}`;
    }

    if (headingText && !/^(?:mediadelivery|bunnystream|player|embed)$/i.test(headingText)) {
      return headingText;
    }

    if (docTitle && !/^(?:mediadelivery|bunnystream|player|embed)$/i.test(docTitle)) {
      return docTitle;
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content && ogTitle.content.trim()) {
      return ogTitle.content.trim();
    }

    return '';
  }

  function sendMediaCandidate(candidate) {
    if (!candidate?.url || !/^https?:/i.test(candidate.url) || drmPattern.test(candidate.url)) return;
    
    const mediaElementCount = document.querySelectorAll('video, audio').length;
    const isSinglePlayerPage = mediaElementCount === 1;
    const title = getRealTitle();
    const poster = document.querySelector('video[poster]')?.poster || candidate.poster || '';

    try {
      chrome.runtime.sendMessage({
        action: 'mediaCandidate',
        candidate: {
          url: candidate.url,
          source: candidate.source || 'video-element',
          title: title,
          thumbnail: poster,
          logicalKey: isSinglePlayerPage ? `player:${window.location.href}` : '',
          previewUrl: candidate.source === 'video-element' ? candidate.url : ''
        }
      });
    } catch (e) {
      // Ignore context invalidated
    }
  }

  function inspectMediaElements() {
    document.querySelectorAll('video, audio').forEach((element) => {
      const src = element.currentSrc || element.src || element.getAttribute('src');
      const poster = element.poster || '';
      if (src) sendMediaCandidate({ url: src, source: 'video-element', poster });

      element.querySelectorAll('source[src]').forEach((source) => {
        sendMediaCandidate({ url: source.src, source: 'video-element', poster });
      });
    });
  }

  function sendPreviewFrame() {
    const video = [...document.querySelectorAll('video')].find((element) => 
      element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0
    );
    if (!video) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

        let durationStr = '';
        if (video.duration && Number.isFinite(video.duration)) {
          const mins = Math.floor(video.duration / 60);
          const secs = Math.floor(video.duration % 60);
          durationStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }

        chrome.runtime.sendMessage({
          action: 'mediaPreviewFrame',
          preview: {
            logicalKey: `player:${window.location.href}`,
            frame: dataUrl,
            duration: durationStr,
            title: getRealTitle()
          }
        });
      }
    } catch (e) {
      // Cross-origin canvas security restriction
    }
  }

  function setPreviewEnabled(enabled) {
    if (previewTimer) {
      window.clearInterval(previewTimer);
      previewTimer = null;
    }
    if (!enabled) return;
    sendPreviewFrame();
    previewTimer = window.setInterval(sendPreviewFrame, 1000);
  }

  function getPageMetadata() {
    let title = getRealTitle();
    let thumbnail = "";

    // YouTube Playlist handling
    if (window.location.href.includes('list=')) {
      const playlistTitleEl = document.querySelector('ytd-playlist-header-renderer h1, yt-page-header-renderer h1, h1.yt-dynamic-sizing-metadata');
      if (playlistTitleEl && playlistTitleEl.textContent.trim()) {
        title = playlistTitleEl.textContent.trim();
      }

      const playlistImg = document.querySelector('ytd-playlist-header-renderer img, ytd-playlist-sidebar-renderer img, yt-page-header-renderer img, img.ytCoreImageHost[src*="i.ytimg.com"], img[src*="i.ytimg.com/vi"]');
      if (playlistImg && playlistImg.src) {
        thumbnail = playlistImg.src;
      }
    }

    // YouTube Shorts handling
    if (window.location.href.includes('/shorts/')) {
      const shortsTitleEl = document.querySelector('ytd-reel-player-header-renderer h2, h2.title, ytd-shorts-player-header-renderer h2');
      if (shortsTitleEl && shortsTitleEl.textContent.trim()) {
        title = shortsTitleEl.textContent.trim();
      }
    }

    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && ogImage.content && !thumbnail) {
      thumbnail = ogImage.content;
    }

    if (!thumbnail) {
      const videoEl = document.querySelector('video[poster]');
      if (videoEl && videoEl.poster) thumbnail = videoEl.poster;
    }

    const ytMatch = window.location.href.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch && !thumbnail) {
      thumbnail = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }

    return {
      title: title.replace(/ - YouTube$/, ''),
      thumbnail: thumbnail,
      url: window.location.href,
      logicalKey: document.querySelectorAll('video, audio').length === 1 ? `player:${window.location.href}` : ''
    };
  }

  function rescanMedia() {
    try {
      chrome.runtime.sendMessage({ action: 'pageMetadata', metadata: getPageMetadata() });
      inspectMediaElements();
      sendPreviewFrame();
    } catch (e) {
      // Ignore context invalidated
    }
  }

  window.addEventListener('dow-rescan-media', rescanMedia);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'setMediaPreviewEnabled') setPreviewEnabled(Boolean(message.enabled));
  });

  try {
    rescanMedia();
    setPreviewEnabled(true);
    new MutationObserver(() => {
      inspectMediaElements();
      sendPreviewFrame();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

    document.addEventListener('loadedmetadata', () => {
      inspectMediaElements();
      sendPreviewFrame();
    }, true);
    document.addEventListener('timeupdate', sendPreviewFrame, true);
    document.addEventListener('play', sendPreviewFrame, true);
  } catch (e) {
    // Ignore context invalidated
  }
})();
