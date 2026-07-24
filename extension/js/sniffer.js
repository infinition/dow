/**
 * DOW SNIFFER & M3U8 RECONSTRUCTOR
 */

window.DowSniffer = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const parseBtn = document.getElementById('m3u8-parse-btn');
    if (parseBtn) {
      parseBtn.addEventListener('click', () => this.parseRawM3u8Text());
    }

    const dropZone = document.getElementById('m3u8-dropzone');
    const fileInput = document.getElementById('m3u8-file-input');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) this.handleFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) this.handleFile(e.target.files[0]);
      });
    }
  },

  parseRawM3u8Text() {
    const rawText = document.getElementById('m3u8-input')?.value || "";
    const customTitle = document.getElementById('m3u8-custom-title')?.value || "";

    if (!rawText.trim()) {
      if (window.DowApp) window.DowApp.showToast("Please paste raw m3u8 or chunk text first.", "error");
      return;
    }

    const parsedData = this.processM3u8Content(rawText, customTitle);
    
    if (window.DowApp) {
      window.DowApp.switchTab('extractor');
      window.DowApp.displayResults(parsedData);
      window.DowApp.showToast("Successfully reconstructed HLS stream!", "success");
    }
  },

  handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const title = file.name.replace(/\.[^/.]+$/, "");
      const parsedData = this.processM3u8Content(content, title);

      if (window.DowApp) {
        window.DowApp.switchTab('extractor');
        window.DowApp.displayResults(parsedData);
        window.DowApp.showToast(`Loaded playlist file "${file.name}"!`, "success");
      }
    };
    reader.readAsText(file);
  },

  processM3u8Content(text, titleHint) {
    const lines = text.split('\n');
    const chunkUrls = [];

    for (let line of lines) {
      line = line.trim();
      if (line.length > 0 && !line.startsWith('#')) {
        chunkUrls.push(line);
      }
    }

    const title = titleHint.trim() || `Reconstructed Stream (${chunkUrls.length} Segments)`;

    return {
      title: title,
      thumbnail: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&q=80",
      platform: "Reconstructed m3u8 Stream",
      duration: `${chunkUrls.length} segments`,
      uploader: "Sniffer Source",
      variants: [
        {
          quality: "Reconstructed HD",
          format_id: "best",
          resolution: "1920x1080",
          format: "MP4",
          bitrate: `${chunkUrls.length} Chunks`,
          url: chunkUrls[0] || "http://localhost:8085",
          isBest: true
        }
      ]
    };
  }
};
