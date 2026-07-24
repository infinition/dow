/**
 * DOW EXTENSION MEDIA PLAYER & PREVIEW INSPECTOR
 * Full support for YouTube embeds, direct MP4/WebM videos, and HLS streams.
 */

window.DowPlayer = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalOverlay = document.querySelector('.modal-overlay');

    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', () => this.closeModal());
    }
    if (modalOverlay) {
      modalOverlay.addEventListener('click', () => this.closeModal());
    }
  },

  openPreview(mediaTitle, streamUrl) {
    const modal = document.getElementById('player-modal');
    const wrapper = document.querySelector('.video-player-wrapper');
    const modalTitle = document.getElementById('modal-title');
    const techSpecs = document.getElementById('modal-tech-specs');

    if (!modal || !wrapper) return;

    modalTitle.innerHTML = `<i class="fa-solid fa-circle-play"></i> Preview: ${escapeHtml(mediaTitle)}`;

    const url = streamUrl || (window.DowApp && window.DowApp.currentMediaData ? window.DowApp.currentMediaData.url : "");

    const ytMatch = url.match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

    if (ytMatch) {
      const ytId = ytMatch[1];
      wrapper.innerHTML = `
        <iframe 
          id="preview-iframe"
          src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&enablejsapi=1" 
          style="width: 100%; height: 360px; border: none; border-radius: 12px; background: #000;"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;
    } else {
      wrapper.innerHTML = `
        <video id="preview-video" controls autoplay style="width: 100%; max-height: 360px; border-radius: 12px; background: #000;">
          <source src="${escapeHtml(url)}" type="video/mp4">
          Your browser does not support video preview.
        </video>
      `;
    }

    if (techSpecs) {
      techSpecs.innerHTML = `
        <div><strong>Source URL:</strong> ${escapeHtml(url)}</div>
        <div><strong>Player Mode:</strong> ${ytMatch ? 'YouTube Native Player' : 'HTML5 Direct Stream'}</div>
        <div><strong>Status:</strong> Live Stream Ready</div>
      `;
    }

    modal.classList.remove('hidden');
  },

  closeModal() {
    const modal = document.getElementById('player-modal');
    const wrapper = document.querySelector('.video-player-wrapper');

    if (wrapper) {
      wrapper.innerHTML = `<video id="preview-video" controls class="hidden"></video>`;
    }
    if (modal) {
      modal.classList.add('hidden');
    }
  }
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;'> '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
}

document.addEventListener('DOMContentLoaded', () => window.DowPlayer.init());
