/**
 * DOW EXTENSION POPUP - IMAGE DOWNLOADER & BOOKMARKLETS SUITE
 */

let imageDownloaderLoaded = false;
let bookmarkletsInitialized = false;
let selectedBookmarkletTag = 'All';

function loadImageDownloader() {
  if (imageDownloaderLoaded) return;
  imageDownloaderLoaded = true;
  import('./src/Popup/Popup.js').catch(err => console.error('Image Downloader load error:', err));
}

document.addEventListener('DOMContentLoaded', () => {

  // Tab Navigation with Active-Tab Scoping
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');

      const targetContent = document.getElementById(`tab-${tabId}`);
      if (targetContent) targetContent.classList.add('active');

      if (tabId === 'images') {
        loadImageDownloader();
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


  // Guarantee every stored bookmarklet keeps at least one tag.
  function normalizeBookmarklet(b) {
    const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean) : [];
    if (tags.length === 0) tags.push('Custom');
    return { ...b, tags };
  }

  // Persistence for custom bookmarklets.
  // Store: chrome.storage.local (durable, ~10 MB, survives restarts). It was already the
  // primary store; the local Dow server used to mirror it to a JSON file, and that mirror
  // went away with the server. localStorage is only a non-extension fallback.
  function loadCustomBookmarklets(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['dow_custom_bookmarklets'], (res) => {
        const list = (res && res.dow_custom_bookmarklets) || [];
        callback(list.map(normalizeBookmarklet));
      });
      return;
    }

    try {
      const stored = JSON.parse(localStorage.getItem('dow_custom_bookmarklets') || '[]');
      callback(stored.map(normalizeBookmarklet));
    } catch {
      callback([]);
    }
  }

  function saveCustomBookmarklets(customList, callback) {
    const list = customList.map(normalizeBookmarklet);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ dow_custom_bookmarklets: list }, () => {
        if (callback) callback();
      });
      return;
    }

    try {
      localStorage.setItem('dow_custom_bookmarklets', JSON.stringify(list));
    } catch {}
    if (callback) callback();
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

  // Image Downloader is the default tab, so mount it straight away rather than waiting
  // for a tab click.
  loadImageDownloader();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
}