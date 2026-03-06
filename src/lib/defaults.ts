import type { ExtensionSettings } from '../types/models';

export const DEFAULT_STRUCTURED_TEMPLATE = `# {{title}}

## 概要
{{summary}}

## 元ソース一覧
{{sourceList}}

## 統合本文
{{body}}

## 補足メモ
{{notes}}
`;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcutDescription: 'Ctrl+Shift+S (Mac: Command+Shift+S)',
  backupPathPrefix: 'NotebookLMBackups/',
  structuredMergeTemplate: DEFAULT_STRUCTURED_TEMPLATE,
  enableDevLogs: true
};
