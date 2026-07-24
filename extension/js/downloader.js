/**
 * DOW EXTENSION DOWNLOAD MANAGER COMPONENT - TRACK-BY-TRACK PLAYLIST SUPPORT
 */

window.DowDownloader = {
  activeDownloads: [],

  init() {
    this.bindEvents();
    this.pollActiveDownloads();
    setInterval(() => this.pollActiveDownloads(), 1000);
  },

  bindEvents() {
    const listEl = document.getElementById('downloads-list');
    if (listEl) {
      listEl.addEventListener('click', (e) => {
        const folderBtn = e.target.closest('.folder-btn');
        if (folderBtn) {
          const filePath = folderBtn.getAttribute('data-path');
          fetch('http://localhost:8085/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath })
          });
          return;
        }

        const cancelBtn = e.target.closest('.download-cancel-btn');
        if (cancelBtn) {
          const id = cancelBtn.getAttribute('data-id') || '';
          const filename = cancelBtn.getAttribute('data-filename') || '';
          cancelBtn.disabled = true;
          cancelBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

          fetch('http://localhost:8085/api/cancel-download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, filename })
          })
            .catch(() => {})
            .finally(() => {
              // Optimistically drop it; the next poll reconciles with the server.
              this.activeDownloads = this.activeDownloads.filter(
                (d) => !((id && String(d.id ?? '') === id) || d.filename === filename)
              );
              this.renderDownloads();
              this.pollActiveDownloads();
            });
        }
      });
    }
  },

  async startDownload(mediaData, variant) {
    const isPlaylist = variant.isPlaylist || mediaData.isPlaylist || mediaData.url?.includes('list=');
    const isAudio = variant.isAudio || variant.format === 'MP3' || variant.format === 'M4A';
    const audioFmt = variant.audioFormat || (variant.format === 'M4A' ? 'm4a' : 'mp3');
    const ext = isAudio ? `.${audioFmt}` : '.mp4';
    const filename = `${mediaData.title}${ext}`;

    try {
      const res = await fetch('http://localhost:8085/api/download-to-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mediaData.url || document.getElementById('url-input')?.value,
          title: mediaData.title,
          filename: filename,
          format_id: variant.format_id || 'bestvideo+bestaudio/best',
          quality: variant.quality,
          is_audio: isAudio,
          audio_format: audioFmt,
          is_playlist: isPlaylist,
          video_count: mediaData.videoCount || 1,
          thumbnail: mediaData.thumbnail,
          platform: mediaData.platform
        })
      });

      const data = await res.json();
      if (data && data.success) {
        this.pollActiveDownloads();
      }
    } catch (err) {
      console.error(err);
    }
  },

  async pollActiveDownloads() {
    try {
      const res = await fetch('http://localhost:8085/api/active-downloads');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.downloads) return;

      this.activeDownloads = data.downloads;
      this.renderDownloads();
    } catch {
      // Ignore background fetch errors
    }
  },

  clearCompleted() {
    this.activeDownloads = this.activeDownloads.filter(d => d.status === 'downloading');
    this.renderDownloads();
  },

  renderDownloads() {
    const listEl = document.getElementById('downloads-list');
    const badgeEl = document.getElementById('queue-count');

    const downloadingCount = this.activeDownloads.filter(d => d.status === 'downloading').length;
    if (badgeEl) badgeEl.textContent = downloadingCount;

    if (!listEl) return;

    if (this.activeDownloads.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-inbox empty-icon"></i>
          <p>No active downloads in queue.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.activeDownloads.map(item => {
      const isPlaylist = item.isPlaylist;
      const trackProgressText = isPlaylist 
          ? `<div class="playlist-track-badge"><i class="fa-solid fa-list-check"></i> Track ${item.currentVideoIndex || 1} of ${item.totalVideos || 1}</div>
            <div class="track-title-text" title="${escapeHtml(item.currentTrackTitle || '')}"><i class="fa-solid fa-compact-disc fa-spin"></i> ${escapeHtml(item.currentTrackTitle || 'Downloading track...')}</div>`
        : '';

      return `
        <div class="download-card ${item.status}">
          <div class="download-thumb-box">
            <img src="${escapeHtml(item.thumbnail || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80')}" alt="Thumb">
          </div>
          <div class="download-info">
            <div class="download-title-row">
              <span class="download-filename" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
              <div class="download-title-actions">
                <span class="download-status-badge ${item.status}">${item.status === 'completed' ? 'Completed' : item.status === 'error' ? 'Failed' : item.status === 'cancelled' ? 'Cancelled' : 'Downloading...'}</span>
                ${item.status === 'downloading' ? `
                  <button class="download-cancel-btn" data-id="${escapeHtml(String(item.id ?? ''))}" data-filename="${escapeHtml(item.filename || '')}" title="Cancel this download">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                ` : ''}
              </div>
            </div>
            
            ${trackProgressText}

            <div class="download-progress-bar">
              <div class="fill" style="width: ${item.percent || 0}%;"></div>
            </div>
            <div class="download-stats">
              <span>${item.status === 'completed' ? 'Saved to Downloads' : `${Math.round(item.percent || 0)}% ${isPlaylist ? `(Track ${item.currentVideoIndex}/${item.totalVideos})` : ''}`}</span>
              <span><i class="fa-solid fa-bolt"></i> ${item.speed || ''} &nbsp;|&nbsp; <i class="fa-solid fa-clock"></i> ETA: ${item.eta || '...'}</span>
            </div>
            ${item.status === 'completed' ? `
              <div style="margin-top: 8px;">
                <button class="folder-btn" data-path="${escapeHtml(item.outputPath || '')}">
                  <i class="fa-solid fa-folder-open"></i> Open file location
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
}

document.addEventListener('DOMContentLoaded', () => window.DowDownloader.init());
