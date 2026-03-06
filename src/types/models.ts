export type QuickAddType = 'text' | 'url' | 'clipboardImage';
export type MergeMode = 'simple' | 'structured';

export interface QuickAddPayload {
  type: QuickAddType;
  title: string;
  memo: string;
  content: string;
  imageDataUrl?: string;
  sourceUrl?: string;
}

export interface SourceItem {
  id: string;
  title: string;
  body: string;
  url?: string;
  domPathHint?: string;
}

export interface ExtensionSettings {
  shortcutDescription: string;
  backupPathPrefix: string;
  structuredMergeTemplate: string;
  enableDevLogs: boolean;
}

export interface BackupRequest {
  mode: 'before-delete' | 'before-merge' | 'manual';
  projectName: string;
  sources: SourceItem[];
  mergedContent?: string;
}

export interface DeleteResult {
  success: number;
  failed: number;
  skipped: number;
  failures: string[];
}

export interface MergeResult {
  title: string;
  markdown: string;
}
