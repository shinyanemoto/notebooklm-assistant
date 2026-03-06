import { DEFAULT_SETTINGS } from './defaults';
import type { ExtensionSettings } from '../types/models';

const KEY = 'settings';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[KEY] ?? {})
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: settings });
}
