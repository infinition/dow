/**
 * DOW COMPANION EXTENSION - BACKGROUND SERVICE WORKER
 * Handles Image Downloader batch downloads (filename shaping via onDeterminingFilename)
 * and opening the side panel. No network sniffing: this worker only wakes on a download
 * event or an explicit message from the popup.
 */

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