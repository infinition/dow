/**
 * DOW EXTENSION MAIN APPLICATION CONTROLLER - PLAYLIST UNFOLDING & TRACK SELECTION SUPPORT
 */

window.DowApp = {
  currentMediaData: null,
  selectedTrackIndices: [],

  init() {
    console.log("Initializing Dow Extension...");
    
    this.bindNavigation();
    this.bindExtractorEvents();
    this.bindSmartNamingTags();
    this.bindSubtitlesEvents();
    this.initBookmarklets();

    if (window.DowSniffer) window.DowSniffer.init();
    if (window.DowHistory) window.DowHistory.renderHistory();
    if (window.DowPlayer) window.DowPlayer.init();

    const urlParams = new URLSearchParams(window.location.search);
    const autoUrl = urlParams.get('auto_url');
    if (autoUrl) {
      const urlInput = document.getElementById('url-input');
      if (urlInput) {
        urlInput.value = autoUrl;
        setTimeout(() => this.handleAnalyze(true), 500);
      }
    }

    this.processedQueueIds = new Set();
    setInterval(() => this.pollQueue(), 2000);

    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        if (window.DowHistory) window.DowHistory.clearHistory();
      });
    }

    const clearQueueBtn = document.getElementById('clear-queue-btn');
    if (clearQueueBtn) {
      clearQueueBtn.addEventListener('click', () => {
        fetch('http://localhost:8085/api/clear-active', { method: 'POST' })
          .then(() => {
            if (window.DowDownloader) window.DowDownloader.clearCompleted();
            this.showToast("Completed downloads cleared.", "info");
          });
      });
    }

    const downloadChromeThemeBtn = document.getElementById('download-chrome-theme-btn');
    if (downloadChromeThemeBtn) {
      downloadChromeThemeBtn.addEventListener('click', () => {
        downloadChromeThemeBtn.disabled = true;
        downloadChromeThemeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing theme...';

        chrome.runtime.sendMessage({ action: 'downloadDowChromeTheme' }, (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            downloadChromeThemeBtn.disabled = false;
            downloadChromeThemeBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download DOW Chrome Theme';
            this.showToast('Unable to download the DOW Chrome theme.', 'error');
            return;
          }

          downloadChromeThemeBtn.innerHTML = '<i class="fa-solid fa-download"></i> Theme download started';
          this.showToast('The DOW Chrome theme download has started.', 'success');
        });
      });
    }

    const variantsGrid = document.getElementById('variants-grid');
    if (variantsGrid) {
      variantsGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.download-variant-btn');
        if (btn) {
          const index = parseInt(btn.getAttribute('data-index'));
          this.triggerDownload(index);
        }
      });
    }

    const downloadsList = document.getElementById('downloads-list');
    if (downloadsList) {
      downloadsList.addEventListener('click', (e) => {
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
  },

  bindSubtitlesEvents() {
    const dlSubBtn = document.getElementById('download-subtitles-btn');
    if (dlSubBtn) {
      dlSubBtn.addEventListener('click', () => {
        const urlInput = document.getElementById('url-input')?.value.trim();
        const targetUrl = this.currentMediaData?.url || urlInput;
        const targetTitle = this.currentMediaData?.title || 'subtitles';
        const langSelect = document.getElementById('subtitle-lang-select');
        const selectedLang = langSelect ? langSelect.value : 'fr';

        if (!targetUrl) return;

        dlSubBtn.disabled = true;
        dlSubBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading...`;

        fetch('http://localhost:8085/api/download-subtitles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetUrl,
            title: targetTitle,
            lang: selectedLang
          })
        })
        .then(r => r.json())
        .then(data => {
          dlSubBtn.disabled = false;
          dlSubBtn.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Download Subtitles (.srt)`;
          if (data && data.success) {
            this.showToast(`Subtitles (.srt) saved to Downloads.`, "success");
          } else {
            this.showToast("No subtitles found for this language.", "error");
          }
        })
        .catch(() => {
          dlSubBtn.disabled = false;
          dlSubBtn.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Download Subtitles (.srt)`;
          this.showToast("Subtitle download failed.", "error");
        });
      });
    }
  },

  async pollQueue() {
    try {
      const res = await fetch('http://localhost:8085/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.queue || data.queue.length === 0) return;

      for (const item of data.queue) {
        if (!this.processedQueueIds.has(item.id)) {
          this.processedQueueIds.add(item.id);

          this.showToast(`⚡ Stream queued: "${item.title}"`, 'info');

          const mediaData = await window.DowExtractor.analyze(item.url);
          if (mediaData && mediaData.variants && mediaData.variants.length > 0) {
            if (item.thumbnail && !item.thumbnail.includes('unsplash')) {
              mediaData.thumbnail = item.thumbnail;
            }
            if (item.title && item.title !== "Web Media Stream") {
              mediaData.title = item.title;
            }

            if (window.DowDownloader) {
              window.DowDownloader.startDownload(mediaData, mediaData.variants[0]);
              this.switchTab('downloads');
            }
          }
        }
      }
    } catch {
      // Ignore background errors
    }
  },

  bindNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });
  },

  initBookmarklets() {
    const searchInput = document.getElementById('bookmarklet-search-input');
    const tagList = document.getElementById('bookmarklet-tags');
    const bookmarkletList = document.getElementById('bookmarklet-list');
    const bookmarklets = Array.isArray(window.DOW_BOOKMARKLETS) ? window.DOW_BOOKMARKLETS : [];
    let selectedTag = 'All';

    if (!tagList || !bookmarkletList) return;

    const render = () => {
      const query = searchInput?.value.trim().toLowerCase() || '';
      const visibleBookmarklets = bookmarklets.filter((bookmarklet) => {
        const haystack = [bookmarklet.name, bookmarklet.description, ...bookmarklet.tags].join(' ').toLowerCase();
        return (!query || haystack.includes(query)) && (selectedTag === 'All' || bookmarklet.tags.includes(selectedTag));
      });

      bookmarkletList.replaceChildren();
      if (visibleBookmarklets.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'bookmarklet-empty-state';
        emptyState.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><h3>No bookmarklets found</h3><p>Try another search or tag.</p>';
        bookmarkletList.append(emptyState);
        return;
      }

      visibleBookmarklets.forEach((bookmarklet) => {
        const card = document.createElement('article');
        card.className = 'bookmarklet-card';

        const icon = document.createElement('i');
        icon.className = `fa-solid ${bookmarklet.icon}`;
        icon.setAttribute('aria-hidden', 'true');

        const heading = document.createElement('h3');
        heading.textContent = bookmarklet.name;
        const description = document.createElement('p');
        description.textContent = bookmarklet.description;
        const tags = document.createElement('div');
        tags.className = 'bookmarklet-card-tags';
        bookmarklet.tags.forEach((tag) => {
          const tagElement = document.createElement('span');
          tagElement.textContent = tag;
          tags.append(tagElement);
        });

        const bookmarkLink = document.createElement('a');
        bookmarkLink.className = 'bookmarklet-save-link';
        bookmarkLink.href = bookmarklet.bookmarklet;
        bookmarkLink.draggable = true;
        bookmarkLink.title = 'Drag this link to the Chrome bookmarks bar';
        bookmarkLink.innerHTML = '<i class="fa-solid fa-bookmark"></i> Drag to Bookmarks';
        bookmarkLink.addEventListener('click', (event) => event.preventDefault());
        bookmarkLink.addEventListener('dragstart', (event) => {
          event.dataTransfer.setData('text/uri-list', bookmarklet.bookmarklet);
          event.dataTransfer.setData('text/plain', bookmarklet.bookmarklet);
          event.dataTransfer.effectAllowed = 'copy';
        });

        card.append(icon, heading, description, tags, bookmarkLink);
        bookmarkletList.append(card);
      });
    };

    const allTags = ['All', ...new Set(bookmarklets.flatMap((bookmarklet) => bookmarklet.tags))];
    allTags.forEach((tag) => {
      const tagButton = document.createElement('button');
      tagButton.type = 'button';
      tagButton.className = 'bookmarklet-tag';
      tagButton.textContent = tag;
      tagButton.classList.toggle('active', tag === selectedTag);
      tagButton.addEventListener('click', () => {
        selectedTag = tag;
        tagList.querySelectorAll('.bookmarklet-tag').forEach((button) => button.classList.toggle('active', button.textContent === tag));
        render();
      });
      tagList.append(tagButton);
    });

    searchInput?.addEventListener('input', render);
    render();
  },

  switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const targetBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    const targetTab = document.getElementById(`tab-${tabId}`);

    if (targetBtn) targetBtn.classList.add('active');
    if (targetTab) targetTab.classList.add('active');
  },

  bindExtractorEvents() {
    const analyzeBtn = document.getElementById('analyze-btn');
    const urlInput = document.getElementById('url-input');
    const pasteBtn = document.getElementById('paste-btn');

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => this.handleAnalyze());
    }

    if (urlInput) {
      urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAnalyze();
      });
    }

    if (pasteBtn) {
      pasteBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            urlInput.value = text;
            this.showToast("Pasted from clipboard!", "info");
            this.handleAnalyze();
          }
        } catch {
          this.showToast("Could not access clipboard.", "error");
        }
      });
    }

    document.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const type = pill.getAttribute('data-demo');
        let demoUrl = "";
        switch (type) {
          case 'hls': demoUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"; break;
          case 'youtube': demoUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; break;
          case 'vimeo': demoUrl = "https://vimeo.com/76979871"; break;
          case 'tiktok': demoUrl = "https://www.tiktok.com/@demo/video/123456789"; break;
          case 'mp4': demoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"; break;
        }
        if (urlInput) urlInput.value = demoUrl;
        this.handleAnalyze();
      });
    });

    const previewBtn = document.getElementById('preview-media-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        if (this.currentMediaData && window.DowPlayer) {
          const firstVariant = this.currentMediaData.variants[0];
          window.DowPlayer.openPreview(this.currentMediaData.title, firstVariant ? firstVariant.url : "");
        }
      });
    }
  },

  async handleAnalyze(autoStartDownload = false) {
    const urlInput = document.getElementById('url-input');
    const analyzeBtn = document.getElementById('analyze-btn');
    const url = urlInput?.value.trim();

    if (!url) {
      this.showToast("Please enter a valid video or stream URL.", "error");
      return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`;

    try {
      const mediaData = await window.DowExtractor.analyze(url);
      this.currentMediaData = mediaData;
      this.displayResults(mediaData);
      this.showToast(`Found ${mediaData.variants.length} download formats!`, "success");

      if (autoStartDownload && mediaData.variants.length > 0) {
        this.triggerDownload(0);
      }
    } catch (err) {
      console.error(err);
      this.showToast("Failed to analyze stream URL.", "error");
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> <span>Analyze</span>`;
    }
  },

  displayResults(mediaData) {
    const resultsContainer = document.getElementById('extraction-results');
    const titleEl = document.getElementById('media-title');
    const thumbEl = document.getElementById('media-thumb');
    const platformTag = document.getElementById('media-platform-tag');
    const durationTag = document.getElementById('media-duration-tag');
    const uploaderTag = document.getElementById('media-uploader-tag');
    const variantsGrid = document.getElementById('variants-grid');
    const subtitlesSection = document.getElementById('subtitles-section');

    if (titleEl) titleEl.textContent = mediaData.title;
    if (thumbEl) {
      thumbEl.src = mediaData.thumbnail;
      thumbEl.alt = mediaData.title;
    }
    if (platformTag) platformTag.textContent = mediaData.isPlaylist ? `Playlist (${mediaData.videoCount || 0} tracks)` : mediaData.platform;
    if (durationTag) durationTag.textContent = mediaData.duration || `${mediaData.videoCount || 0} items`;
    if (uploaderTag) uploaderTag.textContent = mediaData.uploader;

    if (subtitlesSection) {
      subtitlesSection.classList.remove('hidden');
      const langSelect = document.getElementById('subtitle-lang-select');
      if (langSelect && mediaData.subtitles && mediaData.subtitles.length > 0) {
        langSelect.innerHTML = mediaData.subtitles.map(s => `<option value="${s.code}">${s.name}</option>`).join('');
      }
    }

    this.selectedTrackIndices = (mediaData.entries || []).map(e => e.index);
    this.renderPlaylistAccordion(mediaData);

    variantsGrid.innerHTML = mediaData.variants.map((v, index) => {
      const isAudio = v.isAudio || v.format === 'MP3' || v.format === 'M4A';
      const icon = v.format === 'MP3' ? 'fa-music' : v.format === 'M4A' ? 'fa-headphones' : 'fa-film';
      const isPlaylist = v.isPlaylist;

      return `
        <div class="variant-card ${v.isBest ? 'best-quality' : ''}">
          ${mediaData.thumbnail ? `
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px;">
              <img src="${escapeHtml(mediaData.thumbnail)}" style="width: 70px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);" alt="Jacket">
              <div style="font-size: 0.8rem; font-weight: 700; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(mediaData.title)}
              </div>
            </div>
          ` : ''}
          
          <div class="variant-header">
            <span class="quality-title">${v.quality}</span>
            <span class="format-badge">${v.format}</span>
          </div>
          <div class="variant-details">
            <span><i class="fa-solid ${isPlaylist ? 'fa-list-check' : 'fa-expand'}"></i> ${isPlaylist ? `${mediaData.videoCount || 'Multiple'} Videos in Subfolder` : `Resolution: ${v.resolution}`}</span>
            <span><i class="fa-solid fa-gauge"></i> ${isPlaylist ? 'Rate-Limit Tolerant' : `Bitrate: ${v.bitrate}`}</span>
          </div>

          <div style="margin: 10px 0; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 6px; display: flex; flex-direction: column; gap: 6px; font-size: 0.75rem; border: 1px solid rgba(255,255,255,0.08);">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 600; color: #a3e635;">
                <input type="checkbox" id="sub-check-${index}" style="accent-color: #a3e635; cursor: pointer;">
                <i class="fa-solid fa-closed-captioning"></i> Download STT (.srt)
              </label>
              <select id="sub-lang-mini-${index}" style="background: rgba(11,13,20,0.9); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; outline: none;">
                <option value="fr">🇫🇷 FR</option>
                <option value="en">🇬🇧 EN</option>
                <option value="es">🇪🇸 ES</option>
                <option value="de">🇩🇪 DE</option>
                <option value="auto">✨ Auto</option>
              </select>
            </div>
            ${!isAudio ? `
              <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; color: #f97316; font-size: 0.7rem; margin-top: 2px; font-weight: 600;">
                <input type="checkbox" id="sub-embed-check-${index}" checked style="accent-color: #f97316; cursor: pointer;">
                <i class="fa-solid fa-film"></i> Embed STT in the MP4 video file
              </label>
            ` : ''}
          </div>

          <button class="download-variant-btn" data-index="${index}">
            <i class="fa-solid ${icon}"></i> Download ${isPlaylist ? `Selected Tracks (${v.format})` : isAudio ? `Audio (${v.format})` : 'Video'}
          </button>
        </div>
      `;
    }).join('');

    resultsContainer.classList.remove('hidden');
    resultsContainer.scrollIntoView({ behavior: 'smooth' });
  },

  renderPlaylistAccordion(mediaData) {
    let accordionContainer = document.getElementById('playlist-accordion-box');
    if (!accordionContainer) {
      accordionContainer = document.createElement('div');
      accordionContainer.id = 'playlist-accordion-box';
      accordionContainer.style.marginBottom = '1.5rem';
      
      const subtitlesSection = document.getElementById('subtitles-section');
      if (subtitlesSection && subtitlesSection.parentNode) {
        subtitlesSection.parentNode.insertBefore(accordionContainer, subtitlesSection);
      }
    }

    if (!mediaData.isPlaylist || !mediaData.entries || mediaData.entries.length === 0) {
      accordionContainer.innerHTML = '';
      return;
    }

    accordionContainer.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1rem; color: #f8fafc;">
        <button id="toggle-playlist-tracks-btn" style="width: 100%; background: rgba(249, 115, 22, 0.15); border: 1px solid rgba(249, 115, 22, 0.3); color: #fb923c; padding: 10px; border-radius: 8px; font-family: inherit; font-size: 0.9rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
          <span><i class="fa-solid fa-list-ol"></i> Show playlist tracks (${mediaData.entries.length} tracks)</span>
          <i class="fa-solid fa-chevron-down" id="accordion-chevron"></i>
        </button>

        <div id="playlist-tracks-panel" class="hidden" style="margin-top: 12px; max-height: 320px; overflow-y: auto; padding-right: 4px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08);">
            <label style="cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; color: #a3e635;">
              <input type="checkbox" id="select-all-playlist-tracks" checked style="accent-color: #a3e635; cursor: pointer;">
              Select / deselect all
            </label>
            <span style="font-size: 0.8rem; color: #94a3b8;"><span id="selected-tracks-badge">${mediaData.entries.length}</span> / ${mediaData.entries.length} tracks selected</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${mediaData.entries.map(t => `
              <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 10px; flex: 1; overflow: hidden;">
                  <input type="checkbox" class="track-select-item" data-index="${t.index}" checked style="accent-color: #f97316; cursor: pointer;">
                  <span style="font-size: 0.78rem; font-weight: 700; color: #f97316; width: 24px;">#${t.index}</span>
                  <span style="font-size: 0.82rem; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.title)}</span>
                </label>
                <span style="font-size: 0.75rem; color: #94a3b8; font-family: monospace; margin-left: 8px;">${escapeHtml(t.duration || '')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    const toggleBtn = document.getElementById('toggle-playlist-tracks-btn');
    const panel = document.getElementById('playlist-tracks-panel');
    const chevron = document.getElementById('accordion-chevron');
    const selectAllCheck = document.getElementById('select-all-playlist-tracks');
    const badgeEl = document.getElementById('selected-tracks-badge');

    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        if (chevron) chevron.className = panel.classList.contains('hidden') ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
      });
    }

    if (selectAllCheck) {
      selectAllCheck.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.track-select-item').forEach(chk => {
          chk.checked = isChecked;
        });
        this.updateSelectedIndices(mediaData);
      });
    }

    document.querySelectorAll('.track-select-item').forEach(chk => {
      chk.addEventListener('change', () => {
        this.updateSelectedIndices(mediaData);
      });
    });
  },

  updateSelectedIndices(mediaData) {
    const selected = [];
    document.querySelectorAll('.track-select-item').forEach(chk => {
      if (chk.checked) {
        selected.push(parseInt(chk.getAttribute('data-index')));
      }
    });

    this.selectedTrackIndices = selected;
    const badgeEl = document.getElementById('selected-tracks-badge');
    if (badgeEl) badgeEl.textContent = selected.length;
  },

  triggerDownload(variantIndex) {
    if (!this.currentMediaData || !this.currentMediaData.variants[variantIndex]) return;

    const variant = { ...this.currentMediaData.variants[variantIndex] };
    
    const subCheck = document.getElementById(`sub-check-${variantIndex}`);
    const subLangSelect = document.getElementById(`sub-lang-mini-${variantIndex}`);
    const subEmbedCheck = document.getElementById(`sub-embed-check-${variantIndex}`);

    if (subCheck && subCheck.checked) {
      variant.subLang = subLangSelect ? subLangSelect.value : 'fr';
      variant.embedSubs = subEmbedCheck ? subEmbedCheck.checked : true;
    }

    if (this.currentMediaData.isPlaylist && this.selectedTrackIndices.length > 0) {
      variant.selectedIndices = this.selectedTrackIndices;
    }

    if (window.DowDownloader) {
      window.DowDownloader.startDownload(this.currentMediaData, variant);
      this.switchTab('downloads');
      this.showToast(`Started downloading ${variant.quality} (${variant.selectedIndices ? variant.selectedIndices.length : 'All'} tracks)!`, "info");
    }
  },

  bindSmartNamingTags() {
    const input = document.getElementById('smart-naming-input');
    document.querySelectorAll('.naming-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        if (input) {
          const val = tag.getAttribute('data-tag');
          input.value += `_${val}`;
        }
      });
    });
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
}

document.addEventListener('DOMContentLoaded', () => window.DowApp.init());
