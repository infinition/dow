/**
 * DOW HISTORY & SMART NAMING ENGINE
 */

window.DowHistory = {
  STORAGE_KEY: 'dow_download_history_v1',

  getHistory() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addRecord(downloadJob) {
    const history = this.getHistory();
    const newRecord = {
      id: downloadJob.id,
      title: downloadJob.title,
      filename: downloadJob.filename,
      quality: downloadJob.quality,
      format: downloadJob.format,
      platform: downloadJob.platform,
      thumbnail: downloadJob.thumbnail,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString()
    };

    history.unshift(newRecord);
    if (history.length > 50) history.pop();

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn("Failed to persist history", e);
    }

    this.renderHistory();
  },

  clearHistory() {
    localStorage.removeItem(this.STORAGE_KEY);
    this.renderHistory();
    if (window.DowApp) window.DowApp.showToast("Download history cleared.", "info");
  },

  formatFilename(title, quality, format) {
    const templateInput = document.getElementById('smart-naming-input')?.value || "{title}_[{quality}]_{date}";
    const dateStr = new Date().toISOString().slice(0, 10);
    const ext = format.toLowerCase().includes('mp3') ? 'mp3' : 'mp4';
    
    let filename = templateInput
      .replace(/\{title\}/g, title.replace(/[^a-zA-Z0-9 _-]/g, ""))
      .replace(/\{quality\}/g, quality.replace(/[^a-zA-Z0-9_-]/g, ""))
      .replace(/\{date\}/g, dateStr)
      .replace(/\{format\}/g, ext)
      .replace(/\{website\}/g, "Dow");

    if (!filename.endsWith(`.${ext}`)) {
      filename += `.${ext}`;
    }

    return filename;
  },

  renderHistory(filterText = "") {
    const listContainer = document.getElementById('history-list');
    if (!listContainer) return;

    let history = this.getHistory();
    if (filterText.trim().length > 0) {
      const q = filterText.toLowerCase();
      history = history.filter(item => 
        item.title.toLowerCase().includes(q) || 
        item.filename.toLowerCase().includes(q) ||
        item.platform.toLowerCase().includes(q)
      );
    }

    if (history.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <h3>No download history yet</h3>
          <p>Downloaded files will appear here.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = history.map(item => `
      <div class="history-card">
        <div class="download-title-group">
          <i class="fa-solid ${item.format.includes('MP3') ? 'fa-music' : 'fa-film'} download-type-icon"></i>
          <div>
            <div class="download-name">${this.escapeHtml(item.filename)}</div>
            <div class="download-meta">${item.platform} • ${item.quality} • Saved at ${item.timestamp} (${item.date})</div>
          </div>
        </div>
        <div>
          <span class="tag platform-tag"><i class="fa-solid fa-circle-check"></i> Saved</span>
        </div>
      </div>
    `).join('');
  },

  escapeHtml(str) {
    return str.replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
  }
};
