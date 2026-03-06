import type { RuntimeMessage } from '../types/messages';

function setStatus(text: string, isError = false): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = isError ? 'error' : 'ok';
}

async function sendToActiveTab(message: RuntimeMessage): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    setStatus('アクティブタブが見つかりません。', true);
    return;
  }
  if (!tab.url?.includes('notebooklm.google.com')) {
    setStatus('NotebookLMタブで実行してください。', true);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, message);
    window.close();
  } catch (error) {
    setStatus(`送信失敗: ${(error as Error).message}`, true);
  }
}

function bind(): void {
  const quick = document.getElementById('open-quick');
  const manager = document.getElementById('open-manager');
  const options = document.getElementById('open-options');

  quick?.addEventListener('click', async () => {
    await sendToActiveTab({ type: 'OPEN_QUICK_ADD' });
  });

  manager?.addEventListener('click', async () => {
    await sendToActiveTab({ type: 'OPEN_MANAGER' });
  });

  options?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

bind();
