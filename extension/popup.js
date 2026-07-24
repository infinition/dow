/**
 * DOW EXTENSION POPUP - INTEGRATED MEDIA STREAMS, IMAGE DOWNLOADER & BOOKMARKLETS SUITE
 */

let imageDownloaderLoaded = false;
let bookmarkletsInitialized = false;
let currentActiveTab = 'streams';
let currentActiveTabUrl = '';
let currentActiveTabTitle = '';
let selectedBookmarkletTag = 'All';

function formatThumbnailUrl(url) {
  if (!url || url.includes('unsplash')) {
    return 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80';
  }
  if (url.includes('b-cdn.net') || url.includes('mediadelivery') || url.includes('vimeocdn')) {
    return `http://localhost:8085/api/proxy-image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

document.addEventListener('DOMContentLoaded', () => {
  const pageTitleEl = document.getElementById('page-title');
  const mediaListEl = document.getElementById('media-list');
  const downloadsListEl = document.getElementById('downloads-list');
  const streamCountEl = document.getElementById('stream-count');
  const dlCountEl = document.getElementById('dl-count');

  const refreshStreamsBtn = document.getElementById('refresh-streams-btn');
  const clearCompletedBtn = document.getElementById('clear-completed-btn');
  const openAppBtn = document.getElementById('open-app-btn');

  // Tab Navigation with Active-Tab Scoping
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      currentActiveTab = tabId;

      const targetContent = document.getElementById(`tab-${tabId}`);
      if (targetContent) targetContent.classList.add('active');

      if (tabId === 'streams') {
        loadDetectedMedia();
      } else if (tabId === 'images') {
        if (!imageDownloaderLoaded) {
          imageDownloaderLoaded = true;
          import('./src/Popup/Popup.js').catch(err => console.error('Image Downloader load error:', err));
        }
      } else if (tabId === 'downloads') {
        pollActiveDownloads();
      } else if (tabId === 'bookmarklets') {
        initBookmarkletsTab();
      }
    });
  });

  const sidepanelToggleBtn = document.getElementById('sidepanel-toggle-btn');
  if (sidepanelToggleBtn) {
    sidepanelToggleBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openSidePanel' }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          chrome.windows.getCurrent(currentWindow => {
            if (chrome.sidePanel && chrome.sidePanel.open) {
              chrome.sidePanel.open({ windowId: currentWindow.id }).catch(() => {});
            }
          });
        }
      });
    });
  }


  if (openAppBtn) {
    openAppBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    });
  }

  if (refreshStreamsBtn) {
    refreshStreamsBtn.addEventListener('click', () => {
      refreshStreamsBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Scanning`;
      
      chrome.runtime.sendMessage({ action: 'refreshTabMedia' }, () => {
        if (chrome.runtime.lastError) {}
        setTimeout(() => {
          loadDetectedMedia(() => {
            refreshStreamsBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Refresh`;
          });
        }, 300);
      });
    });
  }

  if (clearCompletedBtn) {
    clearCompletedBtn.addEventListener('click', () => {
      fetch('http://localhost:8085/api/clear-active', { method: 'POST' })
        .then(() => pollActiveDownloads());
    });
  }

  // Event Delegation for Streams Tab
  if (mediaListEl) {
    mediaListEl.addEventListener('click', (e) => {
      // 0. Card Options Expand/Collapse Toggle
      const optionsBtn = e.target.closest('.toggle-card-options-btn');
      if (optionsBtn) {
        const card = optionsBtn.closest('.media-card');
        const panel = card ? card.querySelector('.card-options-panel') : null;
        const chevron = optionsBtn.querySelector('.options-chevron');
        if (panel) {
          panel.classList.toggle('hidden');
          if (chevron) chevron.className = panel.classList.contains('hidden') ? 'fa-solid fa-chevron-down options-chevron' : 'fa-solid fa-chevron-up options-chevron';
        }
        return;
      }

      // 1. Accordion Toggle for Playlist Tracks Unfolding on Any Site
      const accordionBtn = e.target.closest('.toggle-popup-tracks-btn');
      if (accordionBtn) {
        const card = accordionBtn.closest('.media-card');
        const panel = card ? card.querySelector('.popup-tracks-panel') : null;
        const chevron = accordionBtn.querySelector('.popup-chevron');
        const tracksListContainer = card ? card.querySelector('.popup-tracks-list') : null;
        const countBadge = card ? card.querySelector('.popup-selected-count') : null;
        const url = accordionBtn.getAttribute('data-url');

        if (panel) {
          panel.classList.toggle('hidden');
          if (chevron) chevron.className = panel.classList.contains('hidden') ? 'fa-solid fa-chevron-down popup-chevron' : 'fa-solid fa-chevron-up popup-chevron';

          if (!panel.classList.contains('hidden') && tracksListContainer && !tracksListContainer.getAttribute('data-loaded')) {
            tracksListContainer.innerHTML = `<div style="font-size: 0.68rem; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Loading tracks...</div>`;

            fetch(`http://localhost:8085/api/info?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(currentActiveTabUrl)}`)
              .then(r => r.json())
              .then(info => {
                tracksListContainer.setAttribute('data-loaded', 'true');
                if (info && info.entries && info.entries.length > 0) {
                  tracksListContainer.innerHTML = info.entries.map(t => `
                    <label style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-size: 0.68rem; color: #f8fafc; background: rgba(255,255,255,0.03); padding: 3px 6px; border-radius: 4px;">
                      <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                        <input type="checkbox" class="popup-track-chk" data-index="${t.index}" checked style="accent-color: #6366f1; cursor: pointer;">
                        <span style="color: #6366f1; font-weight: 700; width: 20px;">#${t.index}</span>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.title)}</span>
                      </div>
                      <span style="color: #94a3b8; font-family: monospace; font-size: 0.65rem;">${escapeHtml(t.duration || '')}</span>
                    </label>
                  `).join('');

                  if (countBadge) countBadge.textContent = `${info.entries.length} / ${info.entries.length} selected`;
                  updatePopupTrackBadge(card);
                } else {
                  tracksListContainer.innerHTML = `<div style="font-size: 0.68rem; color: #f43f5e;">No tracks found.</div>`;
                }
              })
              .catch(() => {
                tracksListContainer.innerHTML = `<div style="font-size: 0.68rem; color: #f43f5e;">Error loading tracks.</div>`;
              });
          }
        }
        return;
      }

      // 2. Select All / Deselect All in Popup Card
      const selectAllCheck = e.target.closest('.popup-select-all');
      if (selectAllCheck) {
        const card = selectAllCheck.closest('.media-card');
        if (card) {
          const chks = card.querySelectorAll('.popup-track-chk');
          chks.forEach(c => c.checked = selectAllCheck.checked);
          updatePopupTrackBadge(card);
        }
        return;
      }

      // 3. Track Checkbox Toggle
      const trackChk = e.target.closest('.popup-track-chk');
      if (trackChk) {
        const card = trackChk.closest('.media-card');
        if (card) updatePopupTrackBadge(card);
        return;
      }

      // 4. Action Buttons (MP4, MP3, M4A, STT Only, Queue)
      const btn = e.target.closest('.btn, .btn-stt-only');
      if (!btn) return;

      const card = btn.closest('.media-card');
      const action = btn.getAttribute('data-action');
      const url = btn.getAttribute('data-url');
      let title = card ? (card.querySelector('.media-title-text')?.textContent || btn.getAttribute('data-title')) : btn.getAttribute('data-title');
      const thumb = card ? (card.querySelector('.media-thumb')?.src || btn.getAttribute('data-thumb')) : btn.getAttribute('data-thumb');

      if (!title || /^(?:playlist|master|media stream|direct stream|detected video|page media)$/i.test(title.trim())) {
        title = currentActiveTabTitle || 'Web Video Stream';
      }

      // Standalone STT / Lyrics Only
      if (action === 'stt-only') {
        const sttSel = card ? card.querySelector('.stt-sel') : null;
        const selectedLang = sttSel ? sttSel.value : 'fr';

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        fetch('http://localhost:8085/api/download-subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            title: title,
            lang: selectedLang,
            referer: currentActiveTabUrl
          })
        })
        .then(r => r.json())
        .then(data => {
          btn.disabled = false;
          if (data && data.success) {
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Subtitles Saved!`;
            btn.style.background = "rgba(34, 197, 94, 0.25)";
            btn.style.color = "#4ade80";
          } else {
            btn.innerHTML = `No Subtitles`;
          }
        })
        .catch(() => {
          btn.disabled = false;
          btn.innerHTML = `Error`;
        });
        return;
      }

      if (action === 'queue') {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        chrome.runtime.sendMessage({
          action: 'sendToDowQueue',
          url: url, title: title, thumbnail: thumb, platform: 'Chrome Extension'
        }, (res) => {
          if (chrome.runtime.lastError) {}
          btn.className = "btn added";
          btn.innerHTML = `<i class="fa-solid fa-check"></i> Queued`;
        });
        return;
      }

      if (action === 'mp4' || action === 'mp3' || action === 'm4a') {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        const isAudio = action === 'mp3' || action === 'm4a';
        const audioFmt = isAudio ? action : null;
        const ext = isAudio ? `.${action}` : '.mp4';
        const filename = `${title}${ext}`;
        const isAppleMusic = url.includes('music.apple.com') || url.includes('apple.com');
        const isPlaylist = !url.match(/\.(m3u8|mpd|mp4|webm|mov|m4v|flv)(\?.*)?$/i) && (url.includes('list=') || url.includes('/playlist/') || isAppleMusic);

        let formatId = 'bestvideo+bestaudio/best';
        let subLang = null;
        let embedSubs = true;
        let embedLyrics = true;
        let selectedIndices = null;

        if (card) {
          const sttCheck = card.querySelector('.stt-chk');
          const sttSel = card.querySelector('.stt-sel');
          const sttEmbedCheck = card.querySelector('.stt-embed-chk');
          const embedLyricsChk = card.querySelector('.embed-lyrics-chk');
          const formatSelect = card.querySelector('.mp4-format-select');

          if (formatSelect && !isAudio) {
            formatId = formatSelect.value || 'bestvideo+bestaudio/best';
          }

          if (sttCheck && sttCheck.checked) {
            subLang = sttSel ? sttSel.value : 'fr';
            embedSubs = sttEmbedCheck ? sttEmbedCheck.checked : true;
          }

          if (embedLyricsChk) {
            embedLyrics = embedLyricsChk.checked;
          }

          const trackChks = card.querySelectorAll('.popup-track-chk');
          if (trackChks && trackChks.length > 0) {
            selectedIndices = [];
            trackChks.forEach(c => {
              if (c.checked) selectedIndices.push(parseInt(c.getAttribute('data-index')));
            });
          }
        }

        fetch('http://localhost:8085/api/download-to-disk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url,
            title: title,
            filename: filename,
            format_id: formatId,
            is_audio: isAudio,
            audio_format: audioFmt,
            is_playlist: isPlaylist,
            is_apple_music: isAppleMusic,
            sub_lang: subLang,
            embed_subs: embedSubs,
            embed_lyrics: embedLyrics,
            selected_indices: selectedIndices,
            thumbnail: thumb,
            referer: currentActiveTabUrl
          })
        })
        .then(r => r.json())
        .then(() => {
          btn.className = "btn added";
          btn.innerHTML = `<i class="fa-solid fa-check"></i> Added`;
          pollActiveDownloads();
        })
        .catch(() => {
          btn.disabled = false;
          btn.innerHTML = `Error`;
        });
      }
    });

    mediaListEl.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') {
        e.target.src = 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80';
      }
    }, true);
  }

  function updatePopupTrackBadge(card) {
    if (!card) return;
    const countBadge = card.querySelector('.popup-selected-count');
    const chks = card.querySelectorAll('.popup-track-chk');
    if (!countBadge || !chks || chks.length === 0) return;

    const checked = card.querySelectorAll('.popup-track-chk:checked').length;
    countBadge.textContent = `${checked} / ${chks.length} selected`;
  }

  // Event Delegation for Downloads Tab
  if (downloadsListEl) {
    downloadsListEl.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('.download-cancel-btn');
      if (cancelBtn) {
        const id = cancelBtn.getAttribute('data-id') || '';
        const filename = cancelBtn.getAttribute('data-filename') || '';
        cancelBtn.disabled = true;
        cancelBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Stopping...';

        fetch('http://localhost:8085/api/cancel-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, filename })
        })
          .then(response => {
            if (!response.ok) throw new Error('Cancellation failed.');
            return pollActiveDownloads();
          })
          .catch(() => {
            cancelBtn.disabled = false;
            cancelBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
          });
        return;
      }

      const folderBtn = e.target.closest('.folder-btn');
      if (folderBtn) {
        const filePath = folderBtn.getAttribute('data-path');
        fetch('http://localhost:8085/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath })
        });
      }
    });
  }

  // Load Detected Media
  function loadDetectedMedia(cb) {
    chrome.runtime.sendMessage({ action: 'getDetectedMedia' }, (response) => {
      if (chrome.runtime.lastError) {
        if (cb) cb();
        return;
      }

      if (cb) cb();
      if (!response) return;

      const { media, tabUrl, tabTitle } = response;
      currentActiveTabUrl = tabUrl || '';
      currentActiveTabTitle = tabTitle ? tabTitle.replace(/\s*[|-]\s*(?:MachineLearnia|YouTube|Vimeo).*$/i, '').trim() : '';

      if (pageTitleEl) pageTitleEl.innerHTML = `<i class="fa-solid fa-globe"></i> ${escapeHtml(currentActiveTabTitle || tabUrl || 'Active Page')}`;

      const items = [...media];

      items.forEach(item => {
        if (!item.title || /^(?:playlist|master|media stream|direct stream|detected video|page media)$/i.test(item.title.trim())) {
          item.title = currentActiveTabTitle || 'Web Video Stream';
        }
      });

      const isPlaylistSite = tabUrl && (
        tabUrl.includes('list=') ||
        tabUrl.includes('music.apple.com') ||
        tabUrl.includes('apple.com') ||
        tabUrl.includes('/playlist') ||
        tabUrl.includes('/album/') ||
        tabUrl.includes('soundcloud.com/')
      );

      const isResolvableVideoPage = tabUrl && (
        /dailymotion\.com\/video\//i.test(tabUrl) ||
        /dai\.ly\//i.test(tabUrl) ||
        /facebook\.com\/(?:watch|reel|share\/[rv]\/|[^/?#]+\/videos\/)/i.test(tabUrl) ||
        /fb\.watch\//i.test(tabUrl)
      );

      if (isPlaylistSite || isResolvableVideoPage) {
        fetch(`http://localhost:8085/api/info?url=${encodeURIComponent(tabUrl)}&referer=${encodeURIComponent(tabUrl)}`)
          .then(r => r.json())
          .then(info => {
            if (info && info.title) {
              const resolvedCard = {
                url: tabUrl,
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration,
                type: info.isAppleMusic ? `Apple Music Album (${info.videoCount || 0} tracks)` : info.isPlaylist ? `Media Playlist (${info.videoCount || 0} tracks)` : 'Web Video',
                isPlaylist: !!info.isPlaylist,
                isAppleMusic: !!info.isAppleMusic,
                videoCount: info.videoCount || 0,
                timestamp: Date.now()
              };

              if (isResolvableVideoPage && !info.isPlaylist) {
                renderMediaList([resolvedCard]);
                return;
              }

              const existingIdx = items.findIndex(i => i.url === tabUrl);
              if (existingIdx >= 0) {
                items[existingIdx] = resolvedCard;
              } else {
                items.unshift(resolvedCard);
              }
              renderMediaList(items);
            } else {
              renderMediaList(items);
            }
          })
          .catch(() => renderMediaList(items));
      } else {
        renderMediaList(items);
      }
    });
  }

  function renderMediaList(items) {
    if (streamCountEl) streamCountEl.textContent = items.length;

    if (items.length === 0) {
      mediaListEl.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-cloud-arrow-down empty-icon"></i>
          <p>No media streams detected on this page.</p>
        </div>
      `;
      return;
    }

    // Auto-number duplicate titles on the same page
    const titleCounts = {};
    items.forEach(item => {
      let t = item.title || "Web Video Stream";
      if (/^(?:playlist|master|media stream|direct stream|detected video|page media)$/i.test(t.trim())) {
        t = currentActiveTabTitle || "Web Video Stream";
      }
      titleCounts[t] = (titleCounts[t] || 0) + 1;
    });

    const titleCounters = {};

    mediaListEl.innerHTML = items.map((item, index) => {
      const rawThumb = item.thumbnail || "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80";
      const thumb = formatThumbnailUrl(rawThumb);
      let initialTitle = item.title || "Web Video Stream";
      if (/^(?:playlist|master|media stream|direct stream|detected video|page media)$/i.test(initialTitle.trim())) {
        initialTitle = currentActiveTabTitle || "Web Video Stream";
      }

      if (titleCounts[initialTitle] > 1) {
        titleCounters[initialTitle] = (titleCounters[initialTitle] || 0) + 1;
        initialTitle = `${initialTitle} #${titleCounters[initialTitle]}`;
      }

      const isAppleMusic = item.isAppleMusic || item.url.includes('music.apple.com');
      const isHlsOrDirect = item.url.match(/\.(m3u8|mpd|mp4|webm|mov|m4v|flv)(\?.*)?$/i);
      const isPlaylist = !isHlsOrDirect && (item.isPlaylist || item.url.includes('list=') || item.url.includes('/playlist/') || item.url.includes('/album/') || isAppleMusic);
      const isAudioOnly = isAppleMusic || (item.type && item.type.toLowerCase().includes('apple music')) || (item.type && item.type.toLowerCase().includes('audio'));
      const typeLabel = isAppleMusic ? (item.type || 'Apple Music Album') : isPlaylist ? (item.type || 'Media Playlist') : item.type;

      return `
        <div class="media-card" data-card-index="${index}" data-card-url="${escapeHtml(item.url)}">
          <div class="media-preview-group" style="align-items: center;">
            <div style="position: relative; width: 70px; height: 42px; flex-shrink: 0; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); background: #000;">
              <img class="media-thumb" src="${escapeHtml(thumb)}" alt="Jacket Cover" style="width: 100%; height: 100%; object-fit: cover;">
              <span class="thumb-duration-badge" style="position: absolute; bottom: 2px; right: 2px; background: rgba(0,0,0,0.85); color: #fbbf24; font-size: 0.58rem; font-weight: 800; padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(251,191,36,0.4);">
                ${escapeHtml(item.duration || '04:55')}
              </span>
            </div>
            <div class="media-info" style="display: flex; flex-direction: column; justify-content: center; gap: 3px;">
              <div class="media-title-text" title="${escapeHtml(initialTitle)}" style="font-size: 0.78rem;">${escapeHtml(initialTitle)}</div>
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span class="media-type-tag" style="font-size: 0.62rem; padding: 1px 5px;">${escapeHtml(typeLabel)}</span>
                <button class="toggle-card-options-btn" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8; padding: 2px 7px; border-radius: 4px; font-size: 0.64rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
                  <i class="fa-solid fa-sliders"></i> Options <i class="fa-solid fa-chevron-down options-chevron"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- COLLAPSIBLE OPTIONS PANEL (HIDDEN BY DEFAULT) -->
          <div class="card-options-panel hidden" style="margin-top: 2px;">
            ${isAudioOnly ? `
              <!-- CLEAN AUDIO LYRICS CONTROLS -->
              <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.35); padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); margin-bottom: 4px;">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: #10b981; font-size: 0.68rem; font-weight: 600;">
                  <input type="checkbox" class="embed-lyrics-chk" checked style="accent-color: #10b981; cursor: pointer;">
                  <i class="fa-solid fa-music"></i> Embed Synced Lyrics (LRCLIB)
                </label>

                <button class="btn-stt-only" data-action="stt-only" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(initialTitle)}" style="background: rgba(6, 182, 212, 0.2); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.4); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 3px;">
                  <i class="fa-solid fa-file-arrow-down"></i> Lyrics File (.lrc / .srt)
                </button>
              </div>
            ` : `
              <!-- VIDEO STT & SUBTITLES CONTROLS + FORMAT RESOLUTION SELECTOR -->
              <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.7rem; background: rgba(0,0,0,0.35); padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); margin-bottom: 4px;">
                <!-- RESOLUTION SELECTOR DROPDOWN -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                  <span style="font-size: 0.68rem; color: #38bdf8; font-weight: 700;"><i class="fa-solid fa-sliders"></i> Quality:</span>
                  <select class="mp4-format-select" style="flex: 1; background: #0b0d14; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 4px; padding: 2px 6px; font-size: 0.68rem; font-weight: 700; outline: none;">
                    <option value="bestvideo+bestaudio/best">🎬 MP4 (Best Quality)</option>
                    <option value="720p">🎬 MP4 720p HD</option>
                    <option value="1080p">🎬 MP4 1080p Full HD</option>
                    <option value="480p">🎬 MP4 480p</option>
                  </select>
                </div>

                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; color: #06b6d4; font-weight: 600;">
                      <input type="checkbox" class="stt-chk" style="accent-color: #06b6d4; cursor: pointer;"> Subtitles (STT)
                    </label>
                    <select class="stt-sel" style="background: #0b0d14; color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 1px 4px; font-size: 0.68rem; outline: none;">
                      <option value="fr">🇫🇷 FR</option>
                      <option value="en">🇬🇧 EN</option>
                      <option value="es">🇪🇸 ES</option>
                      <option value="de">🇩🇪 DE</option>
                      <option value="auto">✨ Auto</option>
                    </select>
                  </div>

                  <button class="btn-stt-only" data-action="stt-only" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(initialTitle)}" style="background: rgba(6, 182, 212, 0.2); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.4); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 3px;">
                    <i class="fa-solid fa-file-arrow-down"></i> Subtitles Only
                  </button>
                </div>

                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; color: #a855f7; font-size: 0.68rem; font-weight: 600;">
                  <input type="checkbox" class="stt-embed-chk" checked style="accent-color: #a855f7; cursor: pointer;">
                  <i class="fa-solid fa-film"></i> Embed STT inside MP4
                </label>

                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; color: #10b981; font-size: 0.68rem; font-weight: 600;">
                  <input type="checkbox" class="embed-lyrics-chk" checked style="accent-color: #10b981; cursor: pointer;">
                  <i class="fa-solid fa-music"></i> Embed lyrics in audio
                </label>
              </div>
            `}
          </div>

          <!-- UNIVERSAL PLAYLIST UNFOLDING ACCORDION -->
          ${isPlaylist ? `
            <div class="popup-playlist-accordion" style="margin: 4px 0;">
              <button class="toggle-popup-tracks-btn" data-url="${escapeHtml(item.url)}" style="width: 100%; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.35); color: #818cf8; padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                <span><i class="fa-solid fa-list-ol"></i> Unfold playlist tracks</span>
                <i class="fa-solid fa-chevron-down popup-chevron"></i>
              </button>
              <div class="popup-tracks-panel hidden" style="margin-top: 4px; max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.4); border-radius: 6px; padding: 6px; border: 1px solid rgba(255,255,255,0.08);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 0.68rem; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                  <label style="cursor: pointer; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                    <input type="checkbox" class="popup-select-all" checked style="accent-color: #06b6d4; cursor: pointer;"> Select All
                  </label>
                  <span class="popup-selected-count" style="color: #94a3b8;">Loading...</span>
                </div>
                <div class="popup-tracks-list" style="display: flex; flex-direction: column; gap: 4px;">
                  <!-- Populated dynamically when unfolded -->
                </div>
              </div>
            </div>
          ` : ''}

          <!-- Dynamic Compact Action Grid -->
          <div class="action-grid" style="grid-template-columns: ${isAudioOnly ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)'}; gap: 4px; margin-top: 4px;">
            ${!isAudioOnly ? `
              <button class="btn btn-mp4" data-action="mp4" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(initialTitle)}" data-thumb="${escapeHtml(thumb)}" style="padding: 5px 2px; font-size: 0.7rem;">
                <i class="fa-solid fa-film"></i> ${isPlaylist ? 'Playlist' : 'MP4'}
              </button>
            ` : ''}
            <button class="btn btn-mp3" data-action="mp3" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(initialTitle)}" data-thumb="${escapeHtml(thumb)}" style="padding: 5px 2px; font-size: 0.7rem;">
              <i class="fa-solid fa-music"></i> MP3
            </button>
            <button class="btn btn-m4a" data-action="m4a" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(initialTitle)}" data-thumb="${escapeHtml(thumb)}" style="padding: 5px 2px; font-size: 0.7rem;">
              <i class="fa-solid fa-headphones"></i> M4A
            </button>
            <button class="btn btn-queue" data-action="queue" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(initialTitle)}" data-thumb="${escapeHtml(thumb)}" style="padding: 5px 2px; font-size: 0.7rem;">
              <i class="fa-solid fa-bolt"></i> Queue
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Asynchronously resolve formats, titles & durations for every card
    document.querySelectorAll('.media-card[data-card-url]').forEach(card => {
      const url = card.getAttribute('data-card-url');
      if (!url) return;

      fetch(`http://localhost:8085/api/info?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(currentActiveTabUrl)}`)
        .then(r => r.json())
        .then(info => {
          if (!info) return;

          const titleEl = card.querySelector('.media-title-text');
          const badgeEl = card.querySelector('.thumb-duration-badge');
          const selectEl = card.querySelector('.mp4-format-select');
          const imgEl = card.querySelector('.media-thumb');

          if (info.title && !/^(?:playlist|master|media stream|direct stream|video stream)$/i.test(info.title.trim()) && titleEl) {
            titleEl.textContent = info.title;
            titleEl.setAttribute('title', info.title);
          } else if (currentActiveTabTitle && titleEl && /^(?:playlist|master|media stream|direct stream|detected video)$/i.test(titleEl.textContent.trim())) {
            titleEl.textContent = currentActiveTabTitle;
            titleEl.setAttribute('title', currentActiveTabTitle);
          }

          if (info.thumbnail && !info.thumbnail.includes('unsplash') && imgEl) {
            imgEl.src = formatThumbnailUrl(info.thumbnail);
          }

          if (info.duration && badgeEl && info.duration !== 'Direct Stream') {
            badgeEl.textContent = info.duration;
          }

          if (info.variants && info.variants.length > 0 && selectEl) {
            const videoVariants = info.variants.filter(v => !v.isAudio);
            if (videoVariants.length > 0) {
              selectEl.innerHTML = videoVariants.map(v => `
                <option value="${escapeHtml(v.format_id || 'best')}" ${v.isBest ? 'selected' : ''}>
                  🎬 ${escapeHtml(v.quality)} (${escapeHtml(v.resolution || 'MP4')})
                </option>
              `).join('');
            }
          }
        })
        .catch(() => {});
    });
  }

  // Poll Active Downloads Status (Only when downloads tab or initial load)
  function pollActiveDownloads() {
    if (currentActiveTab !== 'downloads' && currentActiveTab !== 'streams') return;

    fetch('http://localhost:8085/api/active-downloads')
      .then(r => r.json())
      .then(data => {
        if (!data || !data.downloads) return;

        const downloads = data.downloads;
        if (dlCountEl) dlCountEl.textContent = downloads.filter(d => d.status === 'downloading').length;

        if (downloads.length === 0) {
          downloadsListEl.innerHTML = `
            <div class="empty-state">
              <i class="fa-solid fa-inbox empty-icon"></i>
              <p>No active downloads in queue.</p>
            </div>
          `;
          return;
        }

        downloadsListEl.innerHTML = downloads.map(item => `
          <div class="media-card">
            <div class="download-title-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div class="media-title-text" title="${escapeHtml(item.filename)}" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.filename)}</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="media-type-tag" style="background: ${item.status === 'completed' ? 'rgba(16, 185, 129, 0.2)' : item.status === 'error' ? 'rgba(239, 68, 68, 0.2)' : item.status === 'cancelled' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(99, 102, 241, 0.2)'}; color: ${item.status === 'completed' ? '#10b981' : item.status === 'error' ? '#ef4444' : item.status === 'cancelled' ? '#f59e0b' : '#6366f1'}; border: 1px solid rgba(255,255,255,0.1);">
                  ${item.status === 'completed' ? 'Completed' : item.status === 'error' ? 'Error' : item.status === 'cancelled' ? 'Cancelled' : 'Downloading'}
                </span>
                ${item.status === 'downloading' ? `
                  <button class="download-cancel-btn" data-id="${escapeHtml(String(item.id ?? ''))}" data-filename="${escapeHtml(item.filename || '')}" title="Stop this download" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 2px 8px; font-size: 0.68rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;">
                    <i class="fa-solid fa-stop"></i> Stop
                  </button>
                ` : ''}
              </div>
            </div>
            ${item.isPlaylist ? `
              <div style="font-size: 0.72rem; color: #06b6d4; font-weight: 700; margin-top: 2px;">
                <i class="fa-solid fa-list-check"></i> Track ${item.currentVideoIndex || 1} of ${item.totalVideos || 1}
              </div>
              <div style="font-size: 0.68rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px;">
                ▶ ${escapeHtml(item.currentTrackTitle || 'Downloading...')}
              </div>
            ` : ''}
            <div class="progress-bar-wrapper">
              <div class="progress-bar-fill" style="width: ${item.percent || 0}%;"></div>
            </div>
            <div class="progress-text">
              <span>${item.status === 'completed' ? 'Saved in Downloads folder' : item.status === 'cancelled' ? 'Download stopped' : item.isPlaylist ? `Track ${item.currentVideoIndex}/${item.totalVideos}` : 'Downloading...'}</span>
              <span>${Math.round(item.percent || 0)}% (${item.speed || ''})</span>
            </div>
            ${item.status === 'completed' ? `
              <button class="folder-btn" data-path="${escapeHtml(item.outputPath || '')}">
                <i class="fa-solid fa-folder-open"></i> Open File Location
              </button>
            ` : ''}
          </div>
        `).join('');
      })
      .catch(() => {});
  }

  // Guarantee every stored bookmarklet keeps at least one tag.
  function normalizeBookmarklet(b) {
    const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean) : [];
    if (tags.length === 0) tags.push('Custom');
    return { ...b, tags };
  }

  // Persistence for custom bookmarklets.
  // Primary store: chrome.storage.local (durable, ~10 MB, survives restarts).
  // Mirror: chrome.storage.sync (best-effort, follows the user's Chrome account
  // across devices; large one-liners may exceed the sync per-item quota, in which
  // case they simply stay local). localStorage is only a non-extension fallback.
  function loadCustomBookmarklets(callback) {
    fetch('http://localhost:8085/api/bookmarklets/custom')
      .then(r => r.ok ? r.json() : [])
      .then(serverList => {
        if (Array.isArray(serverList) && serverList.length > 0) {
          return callback(serverList.map(normalizeBookmarklet));
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['dow_custom_bookmarklets'], (localRes) => {
            const localList = (localRes && localRes.dow_custom_bookmarklets) || [];
            callback(localList.map(normalizeBookmarklet));
          });
        } else {
          try {
            const stored = JSON.parse(localStorage.getItem('dow_custom_bookmarklets') || '[]');
            callback(stored.map(normalizeBookmarklet));
          } catch {
            callback([]);
          }
        }
      })
      .catch(() => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['dow_custom_bookmarklets'], (localRes) => {
            const localList = (localRes && localRes.dow_custom_bookmarklets) || [];
            callback(localList.map(normalizeBookmarklet));
          });
        } else {
          try {
            const stored = JSON.parse(localStorage.getItem('dow_custom_bookmarklets') || '[]');
            callback(stored.map(normalizeBookmarklet));
          } catch {
            callback([]);
          }
        }
      });
  }

  function saveCustomBookmarklets(customList, callback) {
    const list = customList.map(normalizeBookmarklet);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ dow_custom_bookmarklets: list });
    }
    try {
      localStorage.setItem('dow_custom_bookmarklets', JSON.stringify(list));
    } catch {}

    fetch('http://localhost:8085/api/bookmarklets/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(list)
    })
    .then(() => { if (callback) callback(); })
    .catch(() => { if (callback) callback(); });
  }

  // Bookmarklet Catalog Engine for Popup
  function initBookmarkletsTab() {
    if (bookmarkletsInitialized) return;

    const targetStatusEl = document.getElementById('bookmarklet-target-status');
    const searchInput = document.getElementById('popup-bookmarklet-search');
    const tagsContainer = document.getElementById('popup-bookmarklet-tags');
    const listContainer = document.getElementById('popup-bookmarklet-list');
    const addBtn = document.getElementById('add-bookmarklet-btn');
    const formPanel = document.getElementById('custom-bookmarklet-form-panel');
    const closeFormBtn = document.getElementById('close-custom-bm-btn');
    const saveBmBtn = document.getElementById('save-custom-bm-btn');
    const bmNameInput = document.getElementById('custom-bm-name');
    const bmTagsInput = document.getElementById('custom-bm-tags');
    const bmCodeInput = document.getElementById('custom-bm-code');

    if (!listContainer) return;

    bookmarkletsInitialized = true;

    if (addBtn && formPanel) {
      addBtn.addEventListener('click', () => {
        formPanel.classList.toggle('hidden');
      });
    }
    if (closeFormBtn && formPanel) {
      closeFormBtn.addEventListener('click', () => {
        formPanel.classList.add('hidden');
      });
    }

    if (saveBmBtn) {
      saveBmBtn.addEventListener('click', () => {
        const name = bmNameInput ? bmNameInput.value.trim() : '';
        const rawCode = bmCodeInput ? bmCodeInput.value.trim() : '';
        const rawTags = bmTagsInput ? bmTagsInput.value.trim() : '';

        if (!name) {
          alert('Please enter a name for the bookmarklet.');
          return;
        }
        if (!rawCode) {
          alert('Please paste the JavaScript code for the bookmarklet.');
          return;
        }

        let jsCode = rawCode;
        if (!/^javascript:/i.test(jsCode)) {
          jsCode = 'javascript:' + jsCode;
        }

        // Use the user's chosen tags; normalizeBookmarklet guarantees at least
        // one ('Custom') if they left the field empty.
        const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

        const newBookmarklet = {
          id: 'custom-' + Date.now(),
          name: name,
          description: 'Custom user bookmarklet',
          tags: tags,
          icon: 'fa-wand-magic-sparkles',
          bookmarklet: jsCode,
          isCustom: true
        };

        loadCustomBookmarklets((customs) => {
          customs.push(newBookmarklet);
          saveCustomBookmarklets(customs, () => {
            if (bmNameInput) bmNameInput.value = '';
            if (bmCodeInput) bmCodeInput.value = '';
            if (bmTagsInput) bmTagsInput.value = '';
            if (formPanel) formPanel.classList.add('hidden');
            refreshBookmarkletCatalog();
          });
        });
      });
    }

    let fullCatalog = [];

    function refreshBookmarkletCatalog() {
      // Defensively guarantee every base-catalog entry carries a tag too.
      const baseCatalog = (self.DOW_BOOKMARKLETS || []).map(b => {
        const tags = Array.isArray(b.tags) ? b.tags.filter(Boolean) : [];
        return tags.length ? b : { ...b, tags: ['Untagged'] };
      });
      loadCustomBookmarklets((customs) => {
        fullCatalog = [...customs, ...baseCatalog];

        // Extract all unique tags
        const tagsSet = new Set(['All']);
        fullCatalog.forEach(b => (b.tags || []).forEach(t => tagsSet.add(t)));
        const allTags = Array.from(tagsSet);

        if (tagsContainer) {
          tagsContainer.innerHTML = allTags.map(tag => `
            <button class="bookmarklet-popup-tag ${tag === selectedBookmarkletTag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
              ${escapeHtml(tag)}
            </button>
          `).join('');
        }

        renderBookmarkletList();
      });
    }

    // Update target page status
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (targetStatusEl) {
        if (tab?.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://'))) {
          targetStatusEl.className = 'bookmarklet-target-status unavailable';
          targetStatusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Bookmarklets cannot run on browser system pages.`;
        } else {
          targetStatusEl.className = 'bookmarklet-target-status';
          targetStatusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #a3e635;"></i> Ready to run on: <strong>${escapeHtml(tab?.title || tab?.url || 'Active Tab')}</strong>`;
        }
      }
    });

    if (tagsContainer) {
      tagsContainer.addEventListener('click', (e) => {
        const tagBtn = e.target.closest('.bookmarklet-popup-tag');
        if (tagBtn) {
          selectedBookmarkletTag = tagBtn.getAttribute('data-tag');
          document.querySelectorAll('.bookmarklet-popup-tag').forEach(b => b.classList.remove('active'));
          tagBtn.classList.add('active');
          renderBookmarkletList();
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', renderBookmarkletList);
    }

    function renderBookmarkletList() {
      const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

      const filtered = fullCatalog.filter(b => {
        const matchesTag = selectedBookmarkletTag === 'All' || (b.tags || []).includes(selectedBookmarkletTag);
        const matchesSearch = !query || 
                              b.name.toLowerCase().includes(query) || 
                              (b.description && b.description.toLowerCase().includes(query)) || 
                              (b.tags || []).some(t => t.toLowerCase().includes(query));
        return matchesTag && matchesSearch;
      });

      if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="bookmarklet-popup-empty">No matching bookmarklets found.</div>`;
        return;
      }

      listContainer.innerHTML = filtered.map(b => {
        const iconClass = b.icon || 'fa-wand-magic-sparkles';
        const deleteButtonHtml = b.isCustom ? `
          <button class="bookmarklet-popup-delete icon-btn-xs" data-id="${escapeHtml(b.id)}" title="Delete custom bookmarklet">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        ` : '';

        return `
          <div class="bookmarklet-popup-card">
            <div class="bookmarklet-popup-icon">
              <i class="fa-solid ${escapeHtml(iconClass)}"></i>
            </div>
            <div style="overflow: hidden;">
              <div class="bookmarklet-popup-title">${escapeHtml(b.name)}</div>
              <div class="bookmarklet-popup-description">${escapeHtml(b.description || '')}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${deleteButtonHtml}
              <button class="bookmarklet-popup-run" data-id="${escapeHtml(b.id)}" title="Run on active tab">
                <i class="fa-solid fa-play"></i> Run
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    refreshBookmarkletCatalog();

    // Run or Delete Bookmarklet execution handler
    listContainer.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.bookmarklet-popup-delete');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        if (confirm('Delete this custom bookmarklet?')) {
          loadCustomBookmarklets((customs) => {
            const updated = customs.filter(b => b.id !== id);
            saveCustomBookmarklets(updated, () => {
              refreshBookmarkletCatalog();
            });
          });
        }
        return;
      }

      const runBtn = e.target.closest('.bookmarklet-popup-run');
      if (!runBtn) return;

      const id = runBtn.getAttribute('data-id');
      const bookmarkletItem = fullCatalog.find(b => b.id === id);
      if (!bookmarkletItem) return;

      runBtn.disabled = true;
      runBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs?.[0];
        if (!activeTab || !activeTab.id) {
          runBtn.disabled = false;
          runBtn.innerHTML = `<i class="fa-solid fa-play"></i> Run`;
          return;
        }

        let codeToExecute = '';
        if (bookmarkletItem.bookmarklet) {
          codeToExecute = bookmarkletItem.bookmarklet.replace(/^javascript:/i, '').trim();
          if (codeToExecute.startsWith('void(') && codeToExecute.endsWith(')')) {
            codeToExecute = codeToExecute.slice(5, -1);
          }
          try {
            codeToExecute = decodeURIComponent(codeToExecute);
          } catch {}
        }

        const executeOptions = {
          target: { tabId: activeTab.id },
          world: 'MAIN',
          func: (jsCode) => {
            try {
              const scriptEl = document.createElement('script');
              scriptEl.textContent = jsCode;
              (document.head || document.documentElement).appendChild(scriptEl);
              scriptEl.remove();
            } catch (e) {
              window.eval(jsCode);
            }
          },
          args: [codeToExecute]
        };

        chrome.scripting.executeScript(executeOptions)
        .then(() => {
          runBtn.style.background = "rgba(34, 197, 94, 0.25)";
          runBtn.style.color = "#4ade80";
          runBtn.innerHTML = `<i class="fa-solid fa-check"></i> Done`;
          setTimeout(() => {
            runBtn.disabled = false;
            runBtn.style.background = "";
            runBtn.style.color = "";
            runBtn.innerHTML = `<i class="fa-solid fa-play"></i> Run`;
          }, 2000);
        })
        .catch((err) => {
          // Fallback if world: MAIN fails (e.g. Chrome restricted pages)
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: (jsCode) => {
              try {
                const scriptEl = document.createElement('script');
                scriptEl.textContent = jsCode;
                (document.head || document.documentElement).appendChild(scriptEl);
                scriptEl.remove();
              } catch (e) {
                window.eval(jsCode);
              }
            },
            args: [codeToExecute]
          })
          .then(() => {
            runBtn.style.background = "rgba(34, 197, 94, 0.25)";
            runBtn.style.color = "#4ade80";
            runBtn.innerHTML = `<i class="fa-solid fa-check"></i> Done`;
            setTimeout(() => {
              runBtn.disabled = false;
              runBtn.style.background = "";
              runBtn.style.color = "";
              runBtn.innerHTML = `<i class="fa-solid fa-play"></i> Run`;
            }, 2000);
          })
          .catch((fallbackErr) => {
            runBtn.disabled = false;
            runBtn.innerHTML = `Error`;
            console.error('Bookmarklet execution error:', fallbackErr);
          });
        });
      });
    });
  }

  loadDetectedMedia();
  pollActiveDownloads();
  setInterval(pollActiveDownloads, 1500);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
}
