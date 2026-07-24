/**
 * DOW COMPANION EXTENSION - BACKGROUND SERVICE WORKER
 * Sniffs network media streams (BunnyStream, HLS, MP4, etc.) + handles Image Downloader batch downloads.
 */

const detectedMedia = {}; // { tabId: [ { url, key, type, title, thumbnail, timestamp } ] }
const mediaContexts = {}; // { tabId: { title, thumbnail, logicalKey } }
const activeMediaScanTabs = new Set();

// Image Downloader tasks map & download handlers
const tasksByDownloadId = new Map();

function downloadImagesTask(task) {
  const promises = task.imagesToDownload.map((image, index) => {
    return new Promise((resolve) => {
      chrome.downloads.download({ url: image }, (downloadId) => {
        if (downloadId != null) {
          task.indices.set(downloadId, index);
          tasksByDownloadId.set(downloadId, task);
        } else {
          if (chrome.runtime.lastError) {
            console.error(`${image}:`, chrome.runtime.lastError.message);
          }
        }
        resolve();
      });
    });
  });

  return Promise.allSettled(promises);
}

function extensionFromMime(mime) {
  if (!mime) return '';
  const subtype = mime.split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return '';
  return subtype.replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('x-icon', 'ico');
}

function deriveFilenameFromUrl(url, mime, index) {
  let base = '';

  if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname;
      base = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
      base = base.split('?')[0].split('#')[0].trim();

      if (!base || base.toLowerCase().startsWith('unnamed') || !/\.[a-z0-9]{2,5}$/i.test(base)) {
        for (const [k, v] of parsed.searchParams.entries()) {
          if (v && /\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(v)) {
            base = decodeURIComponent(v.substring(v.lastIndexOf('/') + 1));
            break;
          }
        }
      }
    } catch (e) {
      base = '';
    }
  }

  base = base.replace(/[^\w\s.-]/gi, '_').trim();
  if (base.toLowerCase().startsWith('unnamed')) base = '';

  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(base);

  if (!base) {
    base = `image_${String(index + 1).padStart(3, '0')}`;
  }

  if (!hasExtension) {
    const extension = extensionFromMime(mime) || 'jpg';
    base += `.${extension}`;
  }

  return base;
}

function suggestNewFilename(item, suggest) {
  const task = tasksByDownloadId.get(item.id);
  if (!task) {
    suggest();
    return;
  }

  const index = task.indices.get(item.id);
  if (index === undefined) {
    suggest();
    tasksByDownloadId.delete(item.id);
    return;
  }

  let newFilename = '';
  if (task.options && task.options.folder_name) {
    newFilename += `${task.options.folder_name}/`;
  }

  if (task.options && task.options.new_file_name) {
    const regex = /(?:\.([^.]+))?$/;
    const extension = regex.exec(item.filename)?.[1] || extensionFromMime(item.mime);
    const numberOfDigits = task.imagesToDownload.length.toString().length;
    const formattedImageNumber = `${index + 1}`.padStart(numberOfDigits, '0');
    newFilename += `${task.options.new_file_name}${formattedImageNumber}${extension ? `.${extension}` : ''}`;
  } else {
    const chromeName = (item.filename || '').trim();
    const chromeNameIsUsable =
      chromeName && !chromeName.toLowerCase().startsWith('unnamed') && /\.[a-z0-9]{2,5}$/i.test(chromeName);
    newFilename += chromeNameIsUsable ? chromeName : deriveFilenameFromUrl(task.imagesToDownload[index], item.mime, index);
  }

  suggest({
    filename: newFilename.replace(/\\/g, '/').replace(/\/{2,}/g, '/'),
    conflictAction: 'uniquify',
  });

  task.indices.delete(item.id);
  tasksByDownloadId.delete(item.id);
}

function cleanupCompletedDownloadTasks(delta) {
  if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
    tasksByDownloadId.delete(delta.id);
  }
}

chrome.downloads.onDeterminingFilename.addListener(suggestNewFilename);
chrome.downloads.onChanged.addListener(cleanupCompletedDownloadTasks);

// Media inspection scan connection
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dow-media-scan') return;

  let scannedTabId = null;

  port.onMessage.addListener((message) => {
    if (message?.action !== 'startMediaScan') return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      if (!activeTab || activeTab.id == null) {
        port.postMessage({ action: 'mediaScanReady', success: false });
        return;
      }

      scannedTabId = activeTab.id;
      activeMediaScanTabs.add(scannedTabId);
      if (!detectedMedia[scannedTabId]) detectedMedia[scannedTabId] = [];
      mediaContexts[scannedTabId] = {
        title: activeTab.title ? activeTab.title.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo).*$/i, '').trim() : '',
        thumbnail: '',
        logicalKey: ''
      };

      const target = { tabId: scannedTabId, allFrames: true };
      chrome.scripting.executeScript({ target, files: ['content.js'] })
        .then(() => chrome.tabs.sendMessage(scannedTabId, { action: 'setMediaPreviewEnabled', enabled: true }))
        .catch(() => {});

      port.postMessage({ action: 'mediaScanReady', success: true });
    });
  });

  port.onDisconnect.addListener(() => {
    if (scannedTabId != null) {
      activeMediaScanTabs.delete(scannedTabId);
      chrome.tabs.sendMessage(scannedTabId, { action: 'setMediaPreviewEnabled', enabled: false }).catch(() => {});
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    detectedMedia[tabId] = [];
    delete mediaContexts[tabId];
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
    chrome.storage.local.remove(`tab_${tabId}`);
  }
});

function normalizedStreamKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;

    if (host.includes('mediadelivery.net') || host.includes('b-cdn.net') || host.includes('bunny')) {
      const id = u.pathname.match(/\/([a-zA-Z0-9_-]{12,})/);
      if (id) return `bunny:${id[1]}`;
      return `bunny:${u.pathname.replace(/\/[^/]*$/, '')}`;
    }

    if (host.includes('fbcdn') || host.includes('facebook')) {
      const id = u.pathname.match(/\/(\d{8,})_/) || url.match(/[?&](?:v|video_id)=(\d+)/);
      if (id) return `fb:${id[1]}`;
      return `fb:${u.pathname.replace(/\/[^/]*$/, '')}`;
    }

    if (host.includes('dailymotion') || host.includes('dmcdn')) {
      return `dm:${u.pathname.replace(/\/[^/]*$/, '')}`;
    }

    if (host.includes('googlevideo')) {
      const id = url.match(/[?&](?:id|docid)=([^&]+)/);
      if (id) return `yt:${id[1]}`;
    }

    return `${host}${u.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

function isUnsupportedMediaUrl(url) {
  return /(?:license|widevine|playready|fairplay|drm|\.metrics\/track-session)/i.test(url);
}

function isGenericMediaTitle(title) {
  if (!title) return true;
  const clean = title.trim().toLowerCase();
  return /^(?:page media|media stream|page video stream|video stream|video file \(mp4\)|web stream|bunnystream|bunnystream video|mediadelivery|playlist|master|direct stream|detected video)$/i.test(clean);
}

function selectMediaTitle(candidateTitle, contextTitle, fallbackTitle) {
  if (!isGenericMediaTitle(candidateTitle)) return candidateTitle;
  if (!isGenericMediaTitle(contextTitle)) return contextTitle;
  if (!isGenericMediaTitle(fallbackTitle)) return fallbackTitle;
  return 'Detected Video Stream';
}

function isMediaSegmentResponse(url, responseHeaders) {
  if (/\.(?:ts|m4s|m4a|cmfv|cmfa)(?:[?#]|$)/i.test(url) || /[?&](?:range|byterange)=/i.test(url)) return true;
  const contentRange = responseHeaders?.find((header) => header.name.toLowerCase() === 'content-range')?.value;
  const contentType = responseHeaders?.find((header) => header.name.toLowerCase() === 'content-type')?.value || '';
  return Boolean(contentRange) || /(?:video\/mp2t|video\/iso\.segment|audio\/iso\.segment)/i.test(contentType);
}

function addDetectedMedia(tabId, media) {
  if (!media?.url || isUnsupportedMediaUrl(media.url)) return;
  if (!detectedMedia[tabId]) detectedMedia[tabId] = [];

  const key = normalizedStreamKey(media.url);
  const context = mediaContexts[tabId] || {};
  const logicalKey = media.logicalKey || context.logicalKey || '';
  const existing = detectedMedia[tabId].find((item) => item.key === key || (logicalKey && item.logicalKey === logicalKey));

  if (existing) {
    if (!existing.sourceUrls) existing.sourceUrls = [existing.url];
    if (!existing.sourceUrls.includes(media.url)) existing.sourceUrls.push(media.url);
    if (!existing.thumbnail || existing.thumbnail.includes('unsplash')) existing.thumbnail = media.thumbnail || context.thumbnail || existing.thumbnail;
    if (!existing.previewUrl && media.previewUrl) existing.previewUrl = media.previewUrl;
    if (isGenericMediaTitle(existing.title)) {
      existing.title = selectMediaTitle(media.title, context.title, existing.title);
    }
    chrome.storage.local.set({ [`tab_${tabId}`]: detectedMedia[tabId] });
    return;
  }

  const url = media.url;
  const isHls = /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url) || /manifest|playlist/i.test(url);
  const isAudio = /\.(?:mp3|m4a|aac|ogg|wav)(?:[?#]|$)/i.test(url);
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const isBunny = host.includes('mediadelivery.net') || host.includes('b-cdn.net') || host.includes('bunny');

  let defaultThumb = media.thumbnail || context.thumbnail;
  if (!defaultThumb || defaultThumb.includes('unsplash')) {
    if (isBunny) {
      defaultThumb = url.replace(/\/[^/]+\.m3u8.*$/i, '/thumbnail.jpg');
    } else {
      defaultThumb = 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80';
    }
  }

  const item = {
    url,
    key,
    title: selectMediaTitle(media.title, context.title, isAudio ? 'Audio Stream' : isBunny ? 'BunnyStream Video' : 'Page Video Stream'),
    thumbnail: defaultThumb,
    type: media.type || (isBunny ? 'BunnyStream (HLS)' : isHls ? 'HLS Stream (.m3u8)' : isAudio ? 'Audio Stream' : 'Video Stream'),
    logicalKey,
    sourceUrls: [url],
    previewUrl: !isHls && media.previewUrl ? media.previewUrl : '',
    timestamp: Date.now()
  };

  detectedMedia[tabId].push(item);
  chrome.storage.local.set({ [`tab_${tabId}`]: detectedMedia[tabId] });
  chrome.action.setBadgeText({ tabId, text: String(detectedMedia[tabId].length) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#a3e635' });
}

// 2. Sniff Network Requests for Media Files & HLS Streams across all tabs
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details.url || details.tabId < 0) return;

    const url = details.url;

    // Ignore HLS/DASH media segments and metrics tracking
    if (/\.(ts|m4s)(\?|$)/i.test(url) || url.includes('/.metrics/')) return;

    const isHls = url.includes('.m3u8') || url.includes('.mpd');
    const isDirectMedia = url.match(/\.(mp4|webm|mov|m4v|flv)(\?.*)?$/i);
    const isYtStream = url.includes('googlevideo.com/videoplayback') && (url.includes('mime=video') || url.includes('mime=audio')) && !url.includes('range=');

    if (isHls || isDirectMedia || isYtStream) {
      if (!detectedMedia[details.tabId]) {
        detectedMedia[details.tabId] = [];
      }

      const key = normalizedStreamKey(url);
      const exists = detectedMedia[details.tabId].some(item => item.key === key);
      if (!exists) {
        let title = "Media Stream";
        let thumbnail = "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80";
        let type = isHls ? 'HLS Stream (.m3u8)' : isYtStream ? 'YouTube Stream' : 'Video File (MP4)';

        const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
        const ytMatch = url.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

        if (ytMatch) {
          title = `YouTube Stream (${ytMatch[1]})`;
          thumbnail = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        } else if (url.includes('videoplayback')) {
          title = "YouTube Video Stream";
        } else if (host.includes('mediadelivery.net') || host.includes('b-cdn.net') || host.includes('bunny')) {
          title = 'BunnyStream Video';
          type = 'BunnyStream (HLS)';
          thumbnail = url.replace(/\/[^/]+\.m3u8.*$/i, '/thumbnail.jpg');
        } else if (host.includes('dailymotion') || host.includes('dmcdn')) {
          title = 'Dailymotion Video';
          type = 'HLS Stream (.m3u8)';
        } else if (host.includes('fbcdn') || host.includes('facebook')) {
          title = 'Facebook Video';
          type = 'Video Stream';
        }

        // Fetch tab info to assign page title
        chrome.tabs.get(details.tabId, (tab) => {
          if (tab && tab.title) {
            const cleanTabTitle = tab.title.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo).*$/i, '').trim();
            if (cleanTabTitle && isGenericMediaTitle(title)) {
              title = cleanTabTitle;
            }
          }
          addDetectedMedia(details.tabId, { url, title, thumbnail, type });
        });
      }
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!details.url || details.tabId < 0) return;
    if (isMediaSegmentResponse(details.url, details.responseHeaders)) return;
    const contentType = details.responseHeaders?.find((header) => header.name.toLowerCase() === 'content-type')?.value || '';
    if (!/^(?:video|audio)\/|application\/(?:vnd\.apple\.mpegurl|dash\+xml)/i.test(contentType)) return;

    chrome.tabs.get(details.tabId, (tab) => {
      const pageTitle = tab ? tab.title.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo).*$/i, '').trim() : 'Detected Video';
      addDetectedMedia(details.tabId, { 
        url: details.url, 
        title: pageTitle,
        type: `Media Response (${contentType.split(';')[0]})` 
      });
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedMedia[tabId];
  delete mediaContexts[tabId];
  chrome.storage.local.remove(`tab_${tabId}`);
});

// Single Consolidated Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'downloadImages') {
    downloadImagesTask({
      imagesToDownload: request.imagesToDownload,
      options: request.options,
      indices: new Map(),
    }).then(sendResponse);
    return true;
  }

  if (request.action === 'mediaCandidate' && sender.tab) {
    const tabId = sender.tab.id;
    addDetectedMedia(tabId, {
      url: request.candidate.url,
      title: request.candidate.title,
      thumbnail: request.candidate.thumbnail,
      logicalKey: request.candidate.logicalKey,
      previewUrl: request.candidate.previewUrl
    });
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'mediaPreviewFrame' && sender.tab) {
    const tabId = sender.tab.id;
    if (tabId && detectedMedia[tabId]) {
      detectedMedia[tabId].forEach(item => {
        if (request.preview.frame && !item.thumbnail.includes('b-cdn.net')) {
          item.thumbnail = request.preview.frame;
        }
        if (request.preview.duration && !item.duration) {
          item.duration = request.preview.duration;
        }
        if (request.preview.title && isGenericMediaTitle(item.title)) {
          item.title = request.preview.title;
        }
      });
      chrome.storage.local.set({ [`tab_${tabId}`]: detectedMedia[tabId] });
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'pageMetadata' && sender.tab) {
    const tabId = sender.tab.id;
    mediaContexts[tabId] = {
      title: request.metadata.title || '',
      thumbnail: request.metadata.thumbnail || '',
      logicalKey: request.metadata.logicalKey || ''
    };

    if (detectedMedia[tabId]) {
      detectedMedia[tabId].forEach(item => {
        if (isGenericMediaTitle(item.title) && request.metadata.title) item.title = request.metadata.title;
        if ((!item.thumbnail || item.thumbnail.includes('unsplash')) && request.metadata.thumbnail) item.thumbnail = request.metadata.thumbnail;
      });
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'getDetectedMedia') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        sendResponse({ media: [], tabUrl: '', tabTitle: '' });
        return;
      }

      const activeTab = tabs[0];
      
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id, allFrames: true },
        files: ['content.js']
      }).catch(() => {});

      let mediaList = detectedMedia[activeTab.id] || [];
      const tabUrl = activeTab.url || '';
      const tabTitle = activeTab.title ? activeTab.title.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo).*$/i, '').trim() : '';

      mediaList.forEach(item => {
        if (isGenericMediaTitle(item.title) && tabTitle) {
          item.title = tabTitle;
        }
      });

      const isMediaPage = tabUrl.includes('youtube.com') || 
                          tabUrl.includes('vimeo.com') || 
                          tabUrl.includes('tiktok.com') || 
                          tabUrl.includes('kick.com') || 
                          tabUrl.includes('music.apple.com') || 
                          tabUrl.includes('apple.com');

      if (isMediaPage) {
        let thumbnail = "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&q=80";
        let type = tabUrl.includes('/shorts/') ? 'YouTube Short' : 'Web Video Stream';

        const ytMatch = tabUrl.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          thumbnail = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        }

        if (tabUrl.includes('music.apple.com') || tabUrl.includes('apple.com')) {
          type = 'Apple Music Album';
        } else if (tabUrl.includes('list=')) {
          type = 'YouTube Playlist';
        }

        mediaList = mediaList.filter(m => !m.url.includes('videoplayback'));

        const exists = mediaList.some(m => m.url === tabUrl);
        if (!exists) {
          mediaList.unshift({
            url: tabUrl,
            title: tabTitle.replace(/ - YouTube$/, '').replace(/ - Apple Music$/, ''),
            thumbnail: thumbnail,
            type: type,
            timestamp: Date.now()
          });
        }
      }

      sendResponse({ media: mediaList, tabUrl: tabUrl, tabTitle: tabTitle });
    });
    return true;
  }

  if (request.action === 'refreshTabMedia') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        sendResponse({ success: true });
        return;
      }

      const tabId = tabs[0].id;
      detectedMedia[tabId] = [];
      chrome.action.setBadgeText({ tabId: tabId, text: '' });
      
      chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['content.js']
      }).then(() => {
        sendResponse({ success: true });
      }).catch(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === 'sendToDowQueue') {
    fetch('http://localhost:8085/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: request.url,
        title: request.title,
        thumbnail: request.thumbnail,
        platform: request.platform || 'Extension'
      })
    })
    .then(res => res.json())
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }

  if (request.action === 'openSidePanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs?.[0];
      if (activeTab && chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ windowId: activeTab.windowId }).catch(() => {
          chrome.sidePanel.open({ tabId: activeTab.id }).catch(() => {});
        });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  sendResponse({ success: false, reason: 'Unknown action' });
  return false;
});
