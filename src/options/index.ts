import { DEFAULT_SETTINGS } from '../lib/defaults';
import { getSettings, saveSettings } from '../lib/storage';

function getById<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element not found: ${id}`);
  }
  return el as T;
}

function setStatus(text: string, isError = false): void {
  const el = getById<HTMLDivElement>('status');
  el.textContent = text;
  el.className = isError ? 'error' : 'ok';
}

async function init(): Promise<void> {
  const settings = await getSettings();
  getById<HTMLInputElement>('shortcutDescription').value = settings.shortcutDescription;
  getById<HTMLInputElement>('backupPathPrefix').value = settings.backupPathPrefix;
  getById<HTMLTextAreaElement>('structuredMergeTemplate').value = settings.structuredMergeTemplate;
  getById<HTMLInputElement>('enableDevLogs').checked = settings.enableDevLogs;

  getById<HTMLButtonElement>('save').addEventListener('click', async () => {
    try {
      await saveSettings({
        shortcutDescription: getById<HTMLInputElement>('shortcutDescription').value.trim() || DEFAULT_SETTINGS.shortcutDescription,
        backupPathPrefix: getById<HTMLInputElement>('backupPathPrefix').value.trim(),
        structuredMergeTemplate:
          getById<HTMLTextAreaElement>('structuredMergeTemplate').value.trim() || DEFAULT_SETTINGS.structuredMergeTemplate,
        enableDevLogs: getById<HTMLInputElement>('enableDevLogs').checked
      });
      setStatus('保存しました。');
    } catch (error) {
      setStatus(`保存失敗: ${(error as Error).message}`, true);
    }
  });

  getById<HTMLButtonElement>('reset').addEventListener('click', async () => {
    getById<HTMLInputElement>('shortcutDescription').value = DEFAULT_SETTINGS.shortcutDescription;
    getById<HTMLInputElement>('backupPathPrefix').value = DEFAULT_SETTINGS.backupPathPrefix;
    getById<HTMLTextAreaElement>('structuredMergeTemplate').value = DEFAULT_SETTINGS.structuredMergeTemplate;
    getById<HTMLInputElement>('enableDevLogs').checked = DEFAULT_SETTINGS.enableDevLogs;
    setStatus('初期値を反映しました。保存してください。');
  });
}

void init();
