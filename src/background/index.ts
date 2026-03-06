import type { RuntimeMessage } from '../types/messages';

const CONTEXT_MENU_ID = 'notebooklm-add-link';

async function sendToActiveTab(message: RuntimeMessage): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    console.warn('[NLM-Assistant][background] failed to send message', error);
  }
}

function buildTextDataUrl(content: string): string {
  return `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'NotebookLMへURLをクイック追加',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (!tab?.id) return;
  if (!info.linkUrl) return;

  await chrome.tabs.sendMessage(tab.id, {
    type: 'OPEN_QUICK_ADD',
    payload: {
      addType: 'url',
      content: info.linkUrl,
      title: '右クリックリンク追加'
    }
  } satisfies RuntimeMessage);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-quick-add') return;
  await sendToActiveTab({ type: 'OPEN_QUICK_ADD' });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_MARKDOWN') {
    chrome.downloads.download(
      {
        url: buildTextDataUrl(message.payload.content),
        filename: message.payload.filename,
        saveAs: false,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }

  if (message.type === 'DOWNLOAD_DATA_URL') {
    chrome.downloads.download(
      {
        url: message.payload.dataUrl,
        filename: message.payload.filename,
        saveAs: false,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, downloadId });
      }
    );
    return true;
  }

  if (message.type === 'SHOW_DOWNLOADED_FILE') {
    try {
      chrome.downloads.show(message.payload.downloadId);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: (error as Error).message });
    }
    return true;
  }

  sendResponse({ ok: false, error: 'Unhandled message type' });
  return false;
});
