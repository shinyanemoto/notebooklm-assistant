import type { BackupRequest } from '../types/models';

function formatDateParts(date: Date): { stamp: string; display: string } {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mi = `${date.getMinutes()}`.padStart(2, '0');
  return {
    stamp: `${yyyy}${mm}${dd}_${hh}${mi}`,
    display: `${yyyy}-${mm}-${dd} ${hh}:${mi}`
  };
}

export function buildBackupFilename(kind: 'backup' | 'merge_backup', now: Date = new Date()): string {
  const { stamp } = formatDateParts(now);
  if (kind === 'merge_backup') {
    return `notebooklm_merge_backup_${stamp}.md`;
  }
  return `notebooklm_backup_${stamp}.md`;
}

export function buildImageFilename(now: Date = new Date()): string {
  const { stamp } = formatDateParts(now);
  return `notebooklm_clipboard_image_${stamp}.png`;
}

export function createBackupMarkdown(request: BackupRequest, now: Date = new Date()): string {
  const { display } = formatDateParts(now);
  const titleList = request.sources.map((s) => `- ${s.title}`).join('\n');

  const blocks = request.sources
    .map((source, i) => {
      return [
        `### ${i + 1}. ${source.title}`,
        source.url ? `- URL: ${source.url}` : '- URL: （なし）',
        '',
        source.body || '（本文抽出不可）'
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const mergedInfo = request.mergedContent
    ? `\n## 統合候補（統合前スナップショット）\n\n${request.mergedContent}\n`
    : '';

  return [
    '# NotebookLM バックアップ',
    '',
    `- バックアップ日時: ${display}`,
    `- プロジェクト: ${request.projectName}`,
    `- 目的: ${request.mode}`,
    '- 備考: 統合前/削除前の生データ退避',
    '',
    '## 対象ソース一覧',
    titleList || '- （対象なし）',
    '',
    '## 各ソース本文',
    blocks || '（本文なし）',
    mergedInfo
  ].join('\n');
}
