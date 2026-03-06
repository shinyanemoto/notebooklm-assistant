import {
  buildBackupFilename,
  buildChatExportFilename,
  buildImageFilename,
  createBackupMarkdown,
  createChatExportMarkdown
} from '../backup/backup';
import { logger } from '../lib/logger';
import { NOTEBOOKLM_SELECTORS } from '../selectors/notebooklm';
import { getSettings } from '../lib/storage';
import { mergeSources } from '../merge/merge';
import type { RuntimeMessage, RuntimeResponse } from '../types/messages';
import type { ExtensionSettings, MergeMode, QuickAddPayload } from '../types/models';
import { NotebookLMAdapter, type SourceRecord } from './notebooklm-adapter';

interface UiState {
  settings: ExtensionSettings;
  sources: SourceRecord[];
  selectedIds: Set<string>;
  lastBackupIds: Set<string>;
  clipboardImageDataUrl: string | null;
  customPrompts: CustomPrompt[];
}

interface CustomPrompt {
  id: string;
  title: string;
  text: string;
}

const adapter = new NotebookLMAdapter();
const state: UiState = {
  settings: {
    shortcutDescription: '',
    backupPathPrefix: '',
    structuredMergeTemplate: '',
    enableDevLogs: true
  },
  sources: [],
  selectedIds: new Set<string>(),
  lastBackupIds: new Set<string>(),
  clipboardImageDataUrl: null,
  customPrompts: []
};

const ids = {
  fabWrap: 'nlm-fab-wrap',
  quickModal: 'nlm-quick-modal',
  managerModal: 'nlm-manager-modal',
  status: 'nlm-status',
  sourceList: 'nlm-source-list',
  mergePreview: 'nlm-merge-preview',
  deleteButton: 'nlm-delete-button',
  deleteTarget: 'nlm-delete-target',
  dryRun: 'nlm-dry-run',
  backupInfo: 'nlm-backup-info'
};

const CHAT_EXPORT_PROMPT =
  '全ソースを内容変更することなく出して。省略せず、各ソースのタイトルと本文をそのまま列挙してください。';
const CUSTOM_PROMPTS_STORAGE_KEY = 'nlm_custom_prompts';
const URL_MATCH_REGEX = /https?:\/\/[^\s<>"'`]+/g;
const ROLE_PROMPT_DEFAULT = `【役割定義】
あなたは、私の業務を強力にサポートする「タスク整理エージェント：伴走くん」です。
提供されたすべてのソース（メモ、URL、スクショ、画像）を「処理すべき生データ」として扱い、それらを構造化・整理することがあなたの使命です。

【基本スタイル】

ソース絶対主義： 推測で語らず、必ずソースの内容に基づいて回答してください。

簡潔・明快： 回答は箇条書きやMarkdown形式を多用し、一目で状況がわかるようにしてください。

時間の扱い： あなたは「現在時刻」を知りません。日付に関する指示がある場合は、ソース内の記述を最優先し、不明な場合は「期限：未設定」として扱ってください。

【コア・コマンド】
ユーザーから以下のキーワードが出た場合、対応するアクションを実行してください。

「整理して」

現在読み込まれているすべてのソースを横断的に解析し、以下の形式で出力してください。

## 📅 [日付：ソースに記載があれば]

### ✅ 完了済み （完了と判断できるタスク）

### 🚀 進行中・未完了 （未完了のタスクと次のアクション）

### 📝 アイデア・備忘録 （タスクではないが残すべき情報）

「圧縮して」

ソース群の情報を統合し、**「明日これだけをソースとしてアップロードすれば業務を再開できる」**という、究極に無駄を削ぎ落とした1つの構造化テキスト（Markdown）を出力してください。

【禁止事項】

ソースにない外部情報を勝手に付け加えないでください。

「お疲れ様です」などの過度な挨拶は不要です。構造化に全力を出してください。`;

function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getById<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element not found: ${id}`);
  }
  return el as T;
}

function setStatus(message: string, level: 'info' | 'success' | 'error' = 'info'): void {
  const targets = [document.getElementById(ids.status), document.getElementById('nlm-quick-status')].filter(Boolean) as HTMLElement[];
  for (const el of targets) {
    el.textContent = message;
    el.setAttribute('data-level', level);
  }
}

function sanitizePathPrefix(prefix: string): string {
  if (!prefix) return '';
  return prefix.replace(/^\/+/, '').replace(/\/+/g, '/');
}

function withPrefix(pathPrefix: string, filename: string): string {
  const normalized = sanitizePathPrefix(pathPrefix);
  if (!normalized) return filename;
  const suffix = normalized.endsWith('/') ? normalized : `${normalized}/`;
  return `${suffix}${filename}`;
}

async function sendRuntimeMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  const response = await chrome.runtime.sendMessage(message);
  return (response ?? { ok: false, error: 'No response' }) as RuntimeResponse;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function makeCustomPromptId(): string {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeCustomPromptList(input: unknown): CustomPrompt[] {
  if (!Array.isArray(input)) return [];
  const list: CustomPrompt[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' && rec.id ? rec.id : makeCustomPromptId();
    const title = typeof rec.title === 'string' ? rec.title : '';
    const text = typeof rec.text === 'string' ? rec.text : '';
    list.push({ id, title, text });
  }
  return list;
}

async function loadCustomPrompts(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(CUSTOM_PROMPTS_STORAGE_KEY);
    state.customPrompts = sanitizeCustomPromptList(result?.[CUSTOM_PROMPTS_STORAGE_KEY]);
  } catch (error) {
    logger.warn('content', 'failed to load custom prompts', error);
    state.customPrompts = [];
  }
}

async function saveCustomPrompts(): Promise<void> {
  try {
    await chrome.storage.local.set({ [CUSTOM_PROMPTS_STORAGE_KEY]: state.customPrompts });
  } catch (error) {
    logger.warn('content', 'failed to save custom prompts', error);
  }
}

function renderCustomPromptList(): void {
  const root = document.getElementById('nlm-custom-prompt-list');
  if (!root) return;

  if (state.customPrompts.length === 0) {
    root.innerHTML = '<div class="nlm-empty">追加プロンプトはまだありません。</div>';
    return;
  }

  root.innerHTML = state.customPrompts
    .map((prompt) => {
      return `
        <div class="nlm-custom-card" data-prompt-id="${esc(prompt.id)}">
          <div class="nlm-row">
            <label>タイトル</label>
            <input type="text" data-field="title" value="${esc(prompt.title)}" placeholder="例: 要約用プロンプト" />
          </div>
          <div class="nlm-row">
            <label>本文</label>
            <textarea rows="6" data-field="text" placeholder="プロンプト本文を入力">${esc(prompt.text)}</textarea>
          </div>
          <div class="nlm-actions">
            <button data-action="copy">コピー</button>
            <button data-action="delete">削除</button>
          </div>
        </div>
      `;
    })
    .join('');

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-field="title"]'))) {
    input.addEventListener('input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const card = target.closest<HTMLElement>('[data-prompt-id]');
      const promptId = card?.dataset.promptId;
      if (!promptId) return;
      const idx = state.customPrompts.findIndex((item) => item.id === promptId);
      if (idx < 0) return;
      state.customPrompts[idx].title = target.value;
      void saveCustomPrompts();
    });
  }

  for (const textarea of Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea[data-field="text"]'))) {
    textarea.addEventListener('input', (event) => {
      const target = event.currentTarget as HTMLTextAreaElement;
      const card = target.closest<HTMLElement>('[data-prompt-id]');
      const promptId = card?.dataset.promptId;
      if (!promptId) return;
      const idx = state.customPrompts.findIndex((item) => item.id === promptId);
      if (idx < 0) return;
      state.customPrompts[idx].text = target.value;
      void saveCustomPrompts();
    });
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-action="copy"]'))) {
    button.addEventListener('click', async (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const card = target.closest<HTMLElement>('[data-prompt-id]');
      const promptId = card?.dataset.promptId;
      if (!promptId) return;
      const prompt = state.customPrompts.find((item) => item.id === promptId);
      if (!prompt || !prompt.text.trim()) {
        setStatus('コピー対象の本文が空です。', 'error');
        return;
      }
      const ok = await copyTextToClipboard(prompt.text.trim());
      setStatus(ok ? '追加プロンプトをコピーしました。' : 'コピーに失敗しました。', ok ? 'success' : 'error');
    });
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-action="delete"]'))) {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const card = target.closest<HTMLElement>('[data-prompt-id]');
      const promptId = card?.dataset.promptId;
      if (!promptId) return;
      state.customPrompts = state.customPrompts.filter((item) => item.id !== promptId);
      void saveCustomPrompts();
      renderCustomPromptList();
      setStatus('追加プロンプトを削除しました。', 'info');
    });
  }
}

function dedupeSources(sources: SourceRecord[]): SourceRecord[] {
  const map = new Map<string, SourceRecord>();
  for (const source of sources) {
    const key = [
      source.id || '',
      source.domPathHint || '',
      source.title || '',
      source.url || '',
      source.body.slice(0, 80)
    ].join('::');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, source);
      continue;
    }
    if (!existing.deleteButtonEl && source.deleteButtonEl) {
      map.set(key, source);
    }
  }
  return Array.from(map.values());
}

function selectedSources(): SourceRecord[] {
  return state.sources.filter((s) => state.selectedIds.has(s.id));
}

function deleteTargets(): SourceRecord[] {
  const target = getById<HTMLSelectElement>(ids.deleteTarget).value;
  if (target === 'all') return [...state.sources];
  return selectedSources();
}

function updateDeleteButtonState(): void {
  const deleteBtn = getById<HTMLButtonElement>(ids.deleteButton);
  const targets = deleteTargets();
  const backedUp = targets.every((t) => state.lastBackupIds.has(t.id));
  deleteBtn.disabled = targets.length === 0;
  deleteBtn.textContent = backedUp
    ? '一括削除（バックアップ済み対象のみ）'
    : '一括削除（先にバックアップ実行）';
}

function renderSourceList(): void {
  const root = getById<HTMLDivElement>(ids.sourceList);
  if (state.sources.length === 0) {
    root.innerHTML = '<div class="nlm-empty">ソースが見つかりません。ソースパネルを表示後に再取得してください。</div>';
    updateDeleteButtonState();
    return;
  }

  root.innerHTML = state.sources
    .map((source) => {
      const checked = state.selectedIds.has(source.id) ? 'checked' : '';
      const urlText = source.url ? `<div class="nlm-url">${esc(source.url)}</div>` : '';
      return `
        <label class="nlm-source-row">
          <input type="checkbox" data-source-id="${esc(source.id)}" ${checked} />
          <span class="nlm-source-meta">
            <strong>${esc(source.title)}</strong>
            <span>${esc(source.body.slice(0, 120) || '本文抽出不可')}</span>
            ${urlText}
          </span>
        </label>
      `;
    })
    .join('');

  for (const checkbox of Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    checkbox.addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const sourceId = input.dataset.sourceId;
      if (!sourceId) return;
      if (input.checked) state.selectedIds.add(sourceId);
      else state.selectedIds.delete(sourceId);
      updateDeleteButtonState();
    });
  }

  updateDeleteButtonState();
}

async function refreshSources(): Promise<void> {
  try {
    const scanned = await adapter.scanSources();
    state.sources = dedupeSources(scanned);
    state.selectedIds = new Set(state.sources.map((s) => s.id));
    renderSourceList();
    const deduped = scanned.length - state.sources.length;
    const extra = deduped > 0 ? `（重複整理 ${deduped} 件）` : '';
    setStatus(`ソースを${state.sources.length}件読み込みました。${extra}`, 'success');
  } catch (error) {
    logger.error('content', error);
    setStatus(`ソース読み込み失敗: ${(error as Error).message}`, 'error');
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

async function readClipboardImage(): Promise<string> {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error('Clipboard APIが利用できません。');
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith('image/')) {
        const blob = await item.getType(type);
        return await blobToDataUrl(blob);
      }
    }
  }
  throw new Error('クリップボード画像が見つかりません。');
}

function updateImagePreview(): void {
  const preview = getById<HTMLImageElement>('nlm-qa-image-preview');
  const clearButton = getById<HTMLButtonElement>('nlm-qa-clear-image');
  if (state.clipboardImageDataUrl) {
    preview.src = state.clipboardImageDataUrl;
    preview.style.display = 'block';
    clearButton.style.display = 'inline-block';
    return;
  }

  preview.removeAttribute('src');
  preview.style.display = 'none';
  clearButton.style.display = 'none';
}

function resetQuickForm(): void {
  getById<HTMLTextAreaElement>('nlm-qa-input').value = '';
  getById<HTMLInputElement>('nlm-qa-title').value = '';
  getById<HTMLTextAreaElement>('nlm-qa-memo').value = '';
  state.clipboardImageDataUrl = null;
  updateImagePreview();
}

async function ensureClipboardImageLoaded(): Promise<void> {
  const dataUrl = await readClipboardImage();
  state.clipboardImageDataUrl = dataUrl;
  updateImagePreview();
}

type ImageDownloadInfo = {
  relativePath: string;
  filename: string;
  downloadId: number;
};

async function downloadImageBackup(dataUrl: string): Promise<ImageDownloadInfo> {
  const relativePath = withPrefix(state.settings.backupPathPrefix, buildImageFilename());
  const filename = relativePath.split('/').pop() || relativePath;
  const response = await sendRuntimeMessage({
    type: 'DOWNLOAD_DATA_URL',
    payload: {
      filename: relativePath,
      dataUrl
    }
  });
  if (!response.ok) {
    throw new Error(response.error || '画像バックアップ保存に失敗しました');
  }
  if (typeof response.downloadId !== 'number') {
    throw new Error('ダウンロードIDの取得に失敗しました');
  }
  return { relativePath, filename, downloadId: response.downloadId };
}

function formatTimestampToSecond(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = `${now.getMonth() + 1}`.padStart(2, '0');
  const dd = `${now.getDate()}`.padStart(2, '0');
  const hh = `${now.getHours()}`.padStart(2, '0');
  const mi = `${now.getMinutes()}`.padStart(2, '0');
  const ss = `${now.getSeconds()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function timestampForFilename(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = `${now.getMonth() + 1}`.padStart(2, '0');
  const dd = `${now.getDate()}`.padStart(2, '0');
  const hh = `${now.getHours()}`.padStart(2, '0');
  const mi = `${now.getMinutes()}`.padStart(2, '0');
  const ss = `${now.getSeconds()}`.padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function compactTimestamp(timestamp: string): string {
  return timestamp.replaceAll('-', '').replaceAll(':', '').replaceAll(' ', '_');
}

function defaultTitleFromContent(type: QuickAddPayload['type'], content: string, timestamp: string): string {
  if (type === 'clipboardImage') {
    return `Clipboard_Image_${compactTimestamp(timestamp)}`;
  }

  if (content) {
    return `貼り付け_${compactTimestamp(timestamp)}`;
  }
  return `テキスト_${compactTimestamp(timestamp)}`;
}

function appendQuickAddTimestampMemo(memo: string, timestamp: string): string {
  if (memo.includes('追加日時:')) return memo;
  return [memo, `追加日時: ${timestamp}`].filter(Boolean).join('\n');
}

async function revealDownloadedFile(downloadId: number): Promise<void> {
  const response = await sendRuntimeMessage({
    type: 'SHOW_DOWNLOADED_FILE',
    payload: { downloadId }
  });
  if (!response.ok) {
    throw new Error(response.error || 'ダウンロードファイル表示に失敗しました');
  }
}

function sanitizeFilenameStem(text: string): string {
  const safe = text
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return safe.slice(0, 48) || 'merged_source';
}

function buildClipboardImageUploadMeta(payload: QuickAddPayload, timestamp: string, downloadInfo: ImageDownloadInfo): string {
  const presumedPath = `~/Downloads/${downloadInfo.relativePath}`;
  return [
    '# クリップボード画像アップロード情報',
    '',
    `- 追加日時: ${timestamp}`,
    `- 保存先（Downloads相対パス）: ${downloadInfo.relativePath}`,
    `- 想定フルパス: ${presumedPath}`,
    `- 保存ファイル名: ${downloadInfo.filename}`,
    payload.sourceUrl ? `- 元ページ: ${payload.sourceUrl}` : '- 元ページ: （不明）',
    payload.title ? `- タイトル: ${payload.title}` : '- タイトル: （未設定）',
    payload.memo ? `- メモ: ${payload.memo}` : '- メモ: （なし）'
  ].join('\n');
}

async function downloadMarkdownFile(filename: string, content: string): Promise<{ downloadId: number }> {
  const response = await sendRuntimeMessage({
    type: 'DOWNLOAD_MARKDOWN',
    payload: {
      filename,
      content
    }
  });

  if (!response.ok) {
    throw new Error(response.error || 'Markdownファイル保存に失敗しました');
  }
  if (typeof response.downloadId !== 'number') {
    throw new Error('ダウンロードIDの取得に失敗しました');
  }
  return { downloadId: response.downloadId };
}

function buildQuickPayload(timestamp: string): QuickAddPayload {
  const inputText = getById<HTMLTextAreaElement>('nlm-qa-input').value.trim();
  const manualTitle = getById<HTMLInputElement>('nlm-qa-title').value.trim();
  const memo = getById<HTMLTextAreaElement>('nlm-qa-memo').value.trim();

  const type: QuickAddPayload['type'] = state.clipboardImageDataUrl ? 'clipboardImage' : 'text';

  const title = manualTitle || defaultTitleFromContent(type, inputText, timestamp);

  if (type === 'clipboardImage') {
    const mergedMemo = [memo, inputText].filter(Boolean).join('\n');
    return {
      type,
      title,
      memo: mergedMemo,
      content: inputText,
      imageDataUrl: state.clipboardImageDataUrl ?? undefined,
      sourceUrl: location.href
    };
  }

  return {
    type,
    title,
    memo,
    content: inputText,
    sourceUrl: location.href
  };
}

async function executeQuickAdd(): Promise<void> {
  const timestamp = formatTimestampToSecond();
  const payload = buildQuickPayload(timestamp);

  if (!payload.content && payload.type !== 'clipboardImage') {
    setStatus('貼り付け内容が空です。テキストまたはURLを貼り付けてください。', 'error');
    return;
  }

  if (payload.type === 'clipboardImage') {
    if (!payload.imageDataUrl) {
      setStatus('クリップボード画像がありません。Ctrl+Vか「クリップボード画像を読み込む」を実行してください。', 'error');
      return;
    }

    setStatus('画像をバックアップ保存中...', 'info');
    let downloadInfo: ImageDownloadInfo;
    try {
      downloadInfo = await downloadImageBackup(payload.imageDataUrl);
    } catch (error) {
      setStatus(`画像バックアップ保存に失敗しました: ${(error as Error).message}`, 'error');
      return;
    }

    const memoWithTimestamp = appendQuickAddTimestampMemo(payload.memo, timestamp);
    const metadataText = buildClipboardImageUploadMeta(
      { ...payload, memo: memoWithTimestamp },
      timestamp,
      downloadInfo
    );

    let copiedMeta = false;
    try {
      await navigator.clipboard.writeText(metadataText);
      copiedMeta = true;
    } catch {
      copiedMeta = false;
    }

    try {
      await revealDownloadedFile(downloadInfo.downloadId);
    } catch (error) {
      logger.warn('content', 'failed to reveal downloaded file', error);
    }

    resetQuickForm();
    hideQuickModal();
    setStatus('NotebookLMの「ファイルをアップロード」を起動中...', 'info');
    const prepared = await adapter.prepareManualFileUpload();
    if (prepared) {
      const copiedLabel = copiedMeta ? ' メタデータはクリップボードにコピー済みです。' : '';
      setStatus(
        `画像を保存しました。表示されたファイル選択で ${downloadInfo.filename}（${downloadInfo.relativePath}）を選択してください。${copiedLabel}`,
        'success'
      );
      return;
    }

    const copiedLabel = copiedMeta ? ' メタデータはクリップボードにコピー済みです。' : '';
    setStatus(
      `画像を保存しました。手動でソース追加を開き「ファイルをアップロード」から ${downloadInfo.relativePath} を選択してください。${copiedLabel}`,
      'error'
    );
    return;
  }

  setStatus('NotebookLMへ追加中...', 'info');
  const payloadWithTimestamp: QuickAddPayload = {
    ...payload,
    memo: appendQuickAddTimestampMemo(payload.memo, timestamp)
  };
  const result = await adapter.addSource(payloadWithTimestamp);
  if (result.success) {
    setStatus('追加フローを実行しました。', 'success');
    resetQuickForm();
    hideQuickModal();
    return;
  }

  if (result.fallbackText) {
    try {
      await navigator.clipboard.writeText(result.fallbackText);
      setStatus(`自動追加失敗: ${result.reason} フォールバック本文をクリップボードへコピーしました。`, 'error');
    } catch {
      setStatus(`自動追加失敗: ${result.reason}`, 'error');
    }
    return;
  }

  setStatus(`追加失敗: ${result.reason || '不明なエラー'}`, 'error');
}

async function createBackup(mode: 'before-delete' | 'before-merge' | 'manual', targets: SourceRecord[], merged?: string): Promise<boolean> {
  if (targets.length === 0) {
    setStatus('バックアップ対象がありません。', 'error');
    return false;
  }

  const markdown = createBackupMarkdown({
    mode,
    projectName: adapter.getProjectName(),
    sources: targets,
    mergedContent: merged
  });

  const filename = withPrefix(
    state.settings.backupPathPrefix,
    buildBackupFilename(mode === 'before-merge' ? 'merge_backup' : 'backup')
  );

  const response = await sendRuntimeMessage({
    type: 'DOWNLOAD_MARKDOWN',
    payload: {
      filename,
      content: markdown
    }
  });

  if (!response.ok) {
    setStatus(`バックアップ失敗: ${response.error || '不明なエラー'}`, 'error');
    return false;
  }

  state.lastBackupIds = new Set(targets.map((t) => t.id));
  getById<HTMLDivElement>(ids.backupInfo).textContent = `最新バックアップ対象: ${targets.length}件`;
  updateDeleteButtonState();
  setStatus(`バックアップ保存完了: ${filename}`, 'success');
  return true;
}

async function backupAllSourcesAsRawSingleFile(): Promise<void> {
  setStatus('チャットへ全ソース出力プロンプトを送信中...', 'info');
  const exportResult = await adapter.exportAllSourcesViaChat(CHAT_EXPORT_PROMPT);
  if (!exportResult.success || !exportResult.responseText) {
    if (exportResult.fallbackText) {
      try {
        await navigator.clipboard.writeText(exportResult.fallbackText);
        setStatus(
          `チャット自動送信失敗: ${exportResult.reason || '不明なエラー'} 定型プロンプトをクリップボードにコピーしました。`,
          'error'
        );
      } catch {
        setStatus(`チャット自動送信失敗: ${exportResult.reason || '不明なエラー'}`, 'error');
      }
      return;
    }
    setStatus(`チャット自動送信失敗: ${exportResult.reason || '不明なエラー'}`, 'error');
    return;
  }

  const markdown = createChatExportMarkdown({
    projectName: adapter.getProjectName(),
    prompt: CHAT_EXPORT_PROMPT,
    responseText: exportResult.responseText
  });
  const filename = withPrefix(state.settings.backupPathPrefix, buildChatExportFilename());

  setStatus('チャット最終回答をMarkdown保存中...', 'info');
  const response = await sendRuntimeMessage({
    type: 'DOWNLOAD_MARKDOWN',
    payload: {
      filename,
      content: markdown
    }
  });
  if (!response.ok) {
    try {
      await navigator.clipboard.writeText(exportResult.responseText);
      setStatus(`保存失敗: ${response.error || '不明なエラー'} 最終回答本文をクリップボードへコピーしました。`, 'error');
    } catch {
      setStatus(`保存失敗: ${response.error || '不明なエラー'}`, 'error');
    }
    return;
  }

  if (state.sources.length > 0) {
    state.lastBackupIds = new Set(state.sources.map((source) => source.id));
  }
  getById<HTMLDivElement>(ids.backupInfo).textContent = '最新バックアップ対象: チャット経由全ソース出力';
  updateDeleteButtonState();
  setStatus(`チャット経由バックアップ保存完了: ${filename}`, 'success');
}

async function previewMerge(): Promise<void> {
  const targets = selectedSources();
  if (targets.length === 0) {
    setStatus('統合対象ソースを選択してください。', 'error');
    return;
  }

  const mode = getById<HTMLSelectElement>('nlm-merge-mode').value as MergeMode;
  const titleInput = getById<HTMLInputElement>('nlm-merge-title').value.trim() || `統合ソース_${new Date().toISOString().slice(0, 10)}`;
  const notes = getById<HTMLTextAreaElement>('nlm-merge-notes').value.trim();

  const merged = mergeSources(targets, mode, state.settings.structuredMergeTemplate, titleInput, notes);
  getById<HTMLTextAreaElement>(ids.mergePreview).value = merged.markdown;
  setStatus(`統合プレビューを生成しました（${targets.length}件）。`, 'success');
}

async function addMergedSource(): Promise<void> {
  const targets = selectedSources();
  if (targets.length === 0) {
    setStatus('統合対象ソースを選択してください。', 'error');
    return;
  }

  const mode = getById<HTMLSelectElement>('nlm-merge-mode').value as MergeMode;
  const titleInput = getById<HTMLInputElement>('nlm-merge-title').value.trim() || `統合ソース_${new Date().toISOString().slice(0, 10)}`;
  const notes = getById<HTMLTextAreaElement>('nlm-merge-notes').value.trim();

  const merged = mergeSources(targets, mode, state.settings.structuredMergeTemplate, titleInput, notes);
  getById<HTMLTextAreaElement>(ids.mergePreview).value = merged.markdown;

  const backedUp = await createBackup('before-merge', targets, merged.markdown);
  if (!backedUp) return;

  const result = await adapter.addSource({
    type: 'text',
    title: merged.title,
    memo: '統合ソース',
    content: merged.markdown,
    sourceUrl: location.href
  });

  if (result.success) {
    setStatus('統合ソースの追加フローを実行しました。', 'success');
    return;
  }

  if (result.fallbackText) {
    try {
      await navigator.clipboard.writeText(result.fallbackText);
      setStatus('統合自動追加に失敗したため本文をクリップボードへコピーしました。', 'error');
    } catch {
      setStatus('統合自動追加に失敗しました。', 'error');
    }
    return;
  }

  setStatus(`統合追加失敗: ${result.reason || '不明なエラー'}`, 'error');
}

async function exportMergedForManualUpload(): Promise<void> {
  const targets = selectedSources();
  if (targets.length === 0) {
    setStatus('統合対象ソースを選択してください。', 'error');
    return;
  }

  const mode = getById<HTMLSelectElement>('nlm-merge-mode').value as MergeMode;
  const titleInput = getById<HTMLInputElement>('nlm-merge-title').value.trim() || `統合ソース_${new Date().toISOString().slice(0, 10)}`;
  const notes = getById<HTMLTextAreaElement>('nlm-merge-notes').value.trim();
  const merged = mergeSources(targets, mode, state.settings.structuredMergeTemplate, titleInput, notes);
  getById<HTMLTextAreaElement>(ids.mergePreview).value = merged.markdown;

  const backedUp = await createBackup('before-merge', targets, merged.markdown);
  if (!backedUp) return;

  const relativePath = withPrefix(
    state.settings.backupPathPrefix,
    `notebooklm_merged_${sanitizeFilenameStem(merged.title)}_${timestampForFilename()}.md`
  );

  setStatus('統合Markdownを保存中...', 'info');
  let downloadId = -1;
  try {
    const result = await downloadMarkdownFile(relativePath, merged.markdown);
    downloadId = result.downloadId;
  } catch (error) {
    setStatus(`統合Markdown保存失敗: ${(error as Error).message}`, 'error');
    return;
  }

  try {
    await revealDownloadedFile(downloadId);
  } catch (error) {
    logger.warn('content', 'failed to reveal merged markdown file', error);
  }

  hideManagerModal();
  setStatus('NotebookLMの「ファイルをアップロード」を起動中...', 'info');
  const opened = await adapter.prepareManualFileUpload();
  if (opened) {
    setStatus(`統合ファイルを保存しました。ファイル選択で ${relativePath} を選択してください。`, 'success');
    return;
  }

  setStatus(`統合ファイルを保存しました。手動で「ファイルをアップロード」から ${relativePath} を選択してください。`, 'error');
}

async function executeDelete(): Promise<void> {
  const targets = deleteTargets();
  if (targets.length === 0) {
    setStatus('削除対象がありません。', 'error');
    return;
  }

  const backedUp = targets.every((target) => state.lastBackupIds.has(target.id));
  if (!backedUp) {
    setStatus('削除前に同一対象のバックアップを実行してください。', 'error');
    return;
  }

  const token = window.prompt(`${targets.length}件を削除します。実行するには DELETE と入力してください。`, '');
  if (token !== 'DELETE') {
    setStatus('削除をキャンセルしました。', 'info');
    return;
  }

  const dryRun = getById<HTMLInputElement>(ids.dryRun).checked;
  setStatus(`一括削除を実行中... 対象 ${targets.length}件`, 'info');
  const result = await adapter.deleteSources(targets, dryRun);
  const summary = `削除結果: success=${result.success}, failed=${result.failed}, skipped=${result.skipped}`;
  if (result.failed > 0) {
    const details = result.failures.slice(0, 3).join(' / ');
    setStatus(`${summary} / ${details}`, 'error');
  } else {
    setStatus(summary, 'success');
  }

  if (!dryRun) {
    await refreshSources();
  }
}

function findSafetyNoticeElement(): HTMLElement | null {
  const hints = ['NotebookLMは不正確な場合があります', '回答は再確認してください', 'NotebookLM can make mistakes'];
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('span, p, div'));
  let best: { score: number; node: HTMLElement } | null = null;
  for (const node of nodes) {
    const text = (node.textContent || '').trim();
    if (!text) continue;
    if (hints.some((hint) => text.includes(hint))) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 80 && rect.height > 8) {
        const score = rect.top + rect.width * 0.01;
        if (!best || score > best.score) {
          best = { score, node };
        }
      }
    }
  }
  return best?.node ?? null;
}

function findChatComposerElement(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], input[type="text"]'));
  let best: { score: number; node: HTMLElement } | null = null;

  for (const node of candidates) {
    if (node.closest('#nlm-assistant-root')) continue;

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    if (rect.width < 160 || rect.height < 20) continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const text = [
      node.getAttribute('placeholder') || '',
      node.getAttribute('aria-label') || '',
      node.getAttribute('data-placeholder') || ''
    ].join(' ').toLowerCase();

    const hint = ['入力を開始', 'start typing', 'message', 'chat'].some((keyword) => text.includes(keyword)) ? 1000 : 0;
    const score = hint + rect.bottom;
    if (!best || score > best.score) {
      best = { score, node };
    }
  }

  return best?.node ?? null;
}

function hasVisibleSourcePanelSearch(): boolean {
  const sourceSearchHints = ['ウェブで新しいソースを検索', 'search web', 'web search'];
  const fields = Array.from(document.querySelectorAll<HTMLElement>('input, textarea'));
  return fields.some((field) => {
    if (field.closest('#nlm-assistant-root')) return false;
    const rect = field.getBoundingClientRect();
    const style = window.getComputedStyle(field);
    if (rect.width < 180 || rect.height < 20) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const text = `${field.getAttribute('placeholder') || ''} ${field.getAttribute('aria-label') || ''}`;
    return sourceSearchHints.some((hint) => text.toLowerCase().includes(hint.toLowerCase()));
  });
}

function isChatOnlyLayout(composer: HTMLElement | null): boolean {
  if (!composer) return false;
  const rect = composer.getBoundingClientRect();
  if (rect.width / window.innerWidth < 0.58) return false;
  return !hasVisibleSourcePanelSearch();
}

function positionFabWrap(): void {
  const wrap = document.getElementById(ids.fabWrap);
  if (!wrap) return;

  const composer = findChatComposerElement();
  if (isChatOnlyLayout(composer) && composer) {
    const composerRect = composer.getBoundingClientRect();
    const bottom = Math.max(20, window.innerHeight - composerRect.top + 8);
    wrap.style.top = 'auto';
    wrap.style.left = '16px';
    wrap.style.right = 'auto';
    wrap.style.bottom = `${Math.round(bottom)}px`;
    return;
  }

  const notice = findSafetyNoticeElement();
  if (notice) {
    const rect = notice.getBoundingClientRect();
    const top = Math.max(8, rect.top - wrap.offsetHeight - 8);
    const left = Math.max(8, rect.left);
    wrap.style.top = `${top}px`;
    wrap.style.left = `${left}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    return;
  }

  wrap.style.left = 'auto';
  wrap.style.top = 'auto';
  wrap.style.right = '16px';
  wrap.style.bottom = '20px';
}

function setupFabAutoPosition(): void {
  let rafId = 0;
  const schedule = (): void => {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      positionFabWrap();
    });
  };

  schedule();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });

  setInterval(schedule, 1000);
}

function isVisibleElement(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function isLinkifyEligibleTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest('#nlm-assistant-root')) return false;
  if (parent.closest('a, code, pre, textarea, input, button, [role="textbox"], [contenteditable="true"]')) return false;
  const text = node.textContent || '';
  URL_MATCH_REGEX.lastIndex = 0;
  return URL_MATCH_REGEX.test(text);
}

function normalizeUrlToken(token: string): { url: string; trailing: string } {
  const trailingChars = '.,!?:;)]}、。」』】＞';
  let url = token;
  let trailing = '';
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (!trailingChars.includes(last)) break;
    trailing = `${last}${trailing}`;
    url = url.slice(0, -1);
  }
  return { url, trailing };
}

function isHttpUrl(text: string): boolean {
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function linkifySingleTextNode(node: Text): boolean {
  const parent = node.parentNode;
  if (!parent) return false;
  const raw = node.textContent || '';
  URL_MATCH_REGEX.lastIndex = 0;
  if (!URL_MATCH_REGEX.test(raw)) return false;

  URL_MATCH_REGEX.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let changed = false;

  for (const match of raw.matchAll(URL_MATCH_REGEX)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      fragment.appendChild(document.createTextNode(raw.slice(lastIndex, start)));
    }

    const { url, trailing } = normalizeUrlToken(token);
    if (isHttpUrl(url)) {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      link.className = 'nlm-auto-link';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      fragment.appendChild(link);
      if (trailing) {
        fragment.appendChild(document.createTextNode(trailing));
      }
      changed = true;
    } else {
      fragment.appendChild(document.createTextNode(token));
    }
    lastIndex = start + token.length;
  }

  if (lastIndex < raw.length) {
    fragment.appendChild(document.createTextNode(raw.slice(lastIndex)));
  }

  if (!changed) return false;
  parent.replaceChild(fragment, node);
  return true;
}

function linkifyContainerUrls(container: HTMLElement): number {
  if (!isVisibleElement(container)) return 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && isLinkifyEligibleTextNode(node)) {
      nodes.push(node);
    }
  }

  let changed = 0;
  for (const node of nodes) {
    if (linkifySingleTextNode(node)) changed += 1;
  }
  return changed;
}

function findMessageContainer(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const selector = NOTEBOOKLM_SELECTORS.assistantMessageContainers.join(',');
  if (!selector) return null;

  if (node instanceof HTMLElement) {
    return node.closest<HTMLElement>(selector);
  }
  if (node.parentElement) {
    return node.parentElement.closest<HTMLElement>(selector);
  }
  return null;
}

function setupChatUrlLinkifier(): void {
  const pending = new Set<HTMLElement>();
  let scheduled = false;

  const scheduleFlush = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const container of Array.from(pending)) {
        pending.delete(container);
        if (container.closest('#nlm-assistant-root')) continue;
        linkifyContainerUrls(container);
      }
    });
  };

  const enqueue = (node: Node | null): void => {
    const container = findMessageContainer(node);
    if (!container) return;
    if (container.closest('#nlm-assistant-root')) return;
    pending.add(container);
    scheduleFlush();
  };

  const seed = (): void => {
    const selector = NOTEBOOKLM_SELECTORS.assistantMessageContainers.join(',');
    if (!selector) return;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.closest('#nlm-assistant-root')) continue;
      const text = el.textContent || '';
      if (!text.includes('http://') && !text.includes('https://')) continue;
      pending.add(el);
    }
    scheduleFlush();
  };

  seed();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        enqueue(mutation.target);
      }
      if (mutation.type === 'childList') {
        enqueue(mutation.target);
        for (const node of Array.from(mutation.addedNodes)) {
          enqueue(node);
        }
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });

  setInterval(seed, 2000);
}

function showQuickModal(prefill?: { content?: string; title?: string; memo?: string }): void {
  const modal = getById<HTMLDivElement>(ids.quickModal);
  modal.style.display = 'flex';
  const quickStatus = document.getElementById('nlm-quick-status');
  if (quickStatus) {
    quickStatus.textContent = '待機中';
    quickStatus.setAttribute('data-level', 'info');
  }

  if (prefill?.content) {
    getById<HTMLTextAreaElement>('nlm-qa-input').value = prefill.content;
  }
  if (prefill?.title) {
    getById<HTMLInputElement>('nlm-qa-title').value = prefill.title;
  }
  if (prefill?.memo) {
    getById<HTMLTextAreaElement>('nlm-qa-memo').value = prefill.memo;
  }
}

function hideQuickModal(): void {
  getById<HTMLDivElement>(ids.quickModal).style.display = 'none';
}

function showManagerModal(): void {
  getById<HTMLDivElement>(ids.managerModal).style.display = 'flex';
  renderCustomPromptList();
}

function hideManagerModal(): void {
  getById<HTMLDivElement>(ids.managerModal).style.display = 'none';
}

function injectStyles(): void {
  if (document.getElementById('nlm-assistant-style')) return;
  const style = document.createElement('style');
  style.id = 'nlm-assistant-style';
  style.textContent = `
    .nlm-fab-wrap { position: fixed; right: 16px; bottom: 20px; z-index: 2147483640; display: flex; flex-direction: row; gap: 8px; align-items: center; }
    .nlm-fab { border: 0; border-radius: 999px; padding: 10px 14px; background: #1f4c3f; color: #fff; font-size: 12px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
    .nlm-fab.secondary { background: #2f3f56; }
    .nlm-modal { position: fixed; inset: 0; z-index: 2147483646; background: rgba(0, 0, 0, 0.45); display: none; align-items: center; justify-content: center; }
    .nlm-panel { width: min(840px, 92vw); max-height: 88vh; overflow: auto; background: #fff; border-radius: 10px; padding: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; }
    .nlm-panel h2 { margin: 0 0 10px; font-size: 18px; }
    .nlm-row { display: grid; gap: 8px; margin-bottom: 10px; }
    .nlm-row label { font-size: 12px; color: #444; }
    .nlm-row input, .nlm-row textarea, .nlm-row select { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 12px; }
    .nlm-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .nlm-actions button { border: 0; border-radius: 6px; padding: 8px 10px; cursor: pointer; background: #ececec; }
    .nlm-actions .primary { background: #1f4c3f; color: white; }
    .nlm-actions .danger { background: #7f1d1d; color: white; }
    .nlm-auto-link { color: #0b57d0; text-decoration: underline; word-break: break-all; }
    .nlm-status { margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 12px; background: #eff6ff; }
    .nlm-status[data-level="success"] { background: #dcfce7; }
    .nlm-status[data-level="error"] { background: #fee2e2; }
    .nlm-source-list { border: 1px solid #ddd; border-radius: 8px; padding: 8px; max-height: 220px; overflow: auto; }
    .nlm-source-row { display: grid; grid-template-columns: 18px 1fr; gap: 8px; padding: 6px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
    .nlm-source-row:last-child { border-bottom: 0; }
    .nlm-source-meta { display: grid; gap: 3px; }
    .nlm-source-meta span { color: #555; }
    .nlm-url { color: #0f4c81; font-size: 11px; word-break: break-all; }
    .nlm-empty { color: #666; font-size: 12px; }
    #nlm-qa-image-preview { width: 100%; max-height: 180px; object-fit: contain; border: 1px solid #ddd; border-radius: 6px; display: none; }
    #nlm-qa-clear-image { display: none; }
    .nlm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .nlm-note { font-size: 12px; color: #4b5563; }
    .nlm-custom-card { border: 1px solid #ddd; border-radius: 8px; padding: 8px; margin-bottom: 10px; background: #fafafa; }
    @media (max-width: 800px) { .nlm-grid-2 { grid-template-columns: 1fr; } .nlm-panel { width: 95vw; } }
  `;
  document.head.appendChild(style);
}

function renderShell(): void {
  const root = document.createElement('div');
  root.id = 'nlm-assistant-root';
  root.innerHTML = `
    <div id="${ids.fabWrap}" class="nlm-fab-wrap">
      <button id="nlm-open-quick" class="nlm-fab">クイック追加</button>
      <button id="nlm-open-manager" class="nlm-fab secondary">その他</button>
    </div>

    <div id="${ids.quickModal}" class="nlm-modal">
      <div class="nlm-panel">
        <h2>クイック追加（ワンステップ）</h2>
        <div class="nlm-note">テキスト/URL/画像を同じ入力欄に貼り付けて「実行」。画像は Ctrl+V か画像読込ボタンで取得できます。</div>
        <div class="nlm-row">
          <label>入力欄（テキスト・URL・画像メモ共通）</label>
          <textarea id="nlm-qa-input" rows="8" placeholder="ここにテキストまたはURLを貼り付け。画像はCtrl+Vで貼り付け可能"></textarea>
        </div>
        <div class="nlm-row">
          <label>画像プレビュー（検出時のみ）</label>
          <img id="nlm-qa-image-preview" alt="clipboard preview" />
          <div class="nlm-actions">
            <button id="nlm-read-clipboard">クリップボード画像を読み込む</button>
            <button id="nlm-qa-clear-image">画像をクリア</button>
            <button id="nlm-use-current-url">現在のURLを入力</button>
          </div>
        </div>
        <div class="nlm-grid-2">
          <div class="nlm-row">
            <label>タイトル（任意）</label>
            <input id="nlm-qa-title" type="text" placeholder="未入力なら自動生成" />
          </div>
          <div class="nlm-row">
            <label>補足メモ（任意）</label>
            <textarea id="nlm-qa-memo" rows="2" placeholder="任意"></textarea>
          </div>
        </div>
        <div class="nlm-actions">
          <button id="nlm-qa-cancel">キャンセル</button>
          <button id="nlm-qa-submit" class="primary">実行</button>
        </div>
        <div id="nlm-quick-status" class="nlm-status" data-level="info">待機中</div>
      </div>
    </div>

    <div id="${ids.managerModal}" class="nlm-modal">
      <div class="nlm-panel">
        <h2>その他</h2>

        <div class="nlm-row">
          <label>テンプレプロンプト: 全ソースエクスポート</label>
          <textarea id="nlm-template-export" rows="4">${CHAT_EXPORT_PROMPT}</textarea>
          <div class="nlm-actions">
            <button id="nlm-copy-template-export" class="primary">全ソースプロンプトをコピー</button>
          </div>
        </div>

        <div class="nlm-row">
          <label>テンプレプロンプト: カスタム役割（伴走くん）</label>
          <textarea id="nlm-template-role" rows="14">${ROLE_PROMPT_DEFAULT}</textarea>
          <div class="nlm-actions">
            <button id="nlm-copy-template-role" class="primary">伴走くんプロンプトをコピー</button>
          </div>
        </div>

        <div class="nlm-row">
          <label>追加プロンプト（追加/削除可能）</label>
          <div class="nlm-actions">
            <button id="nlm-add-custom-prompt">プロンプト枠を追加</button>
          </div>
          <div id="nlm-custom-prompt-list"></div>
        </div>

        <div class="nlm-grid-2">
          <div class="nlm-row">
            <label>保存ファイル名（任意）</label>
            <input id="nlm-summary-title" type="text" placeholder="source_summary_YYYYMMDD_HHMMSS" />
          </div>
          <div class="nlm-row">
            <label>補足（任意）</label>
            <input id="nlm-summary-note" type="text" placeholder="保存メモ" />
          </div>
        </div>

        <div class="nlm-row">
          <label>ソースのまとめ（保存用テキスト）</label>
          <textarea id="nlm-summary-text" rows="12" placeholder="ここにまとめ結果を貼り付けて保存します"></textarea>
        </div>

        <div class="nlm-actions">
          <button id="nlm-summary-copy">まとめをクリップボードへコピー</button>
          <button id="nlm-summary-save" class="primary">まとめをテキスト保存（.txt）</button>
          <button id="nlm-close-manager">閉じる</button>
        </div>

        <div id="${ids.status}" class="nlm-status" data-level="info">待機中</div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
}

function bindQuickInputPasteHandler(): void {
  const input = getById<HTMLTextAreaElement>('nlm-qa-input');
  input.addEventListener('paste', (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    event.preventDefault();
    blobToDataUrl(file)
      .then((dataUrl) => {
        state.clipboardImageDataUrl = dataUrl;
        updateImagePreview();
        setStatus('画像を貼り付けから検出しました。', 'success');
      })
      .catch((error) => {
        setStatus(`画像貼り付け処理失敗: ${(error as Error).message}`, 'error');
      });
  });
}

function bindEvents(): void {
  getById<HTMLButtonElement>('nlm-open-quick').addEventListener('click', () => {
    showQuickModal();
  });

  getById<HTMLButtonElement>('nlm-open-manager').addEventListener('click', async () => {
    showManagerModal();
    setStatus('待機中', 'info');
  });

  getById<HTMLButtonElement>('nlm-read-clipboard').addEventListener('click', async () => {
    try {
      await ensureClipboardImageLoaded();
      setStatus('クリップボード画像を読み込みました。', 'success');
    } catch (error) {
      setStatus(`画像読み込み失敗: ${(error as Error).message}`, 'error');
    }
  });

  getById<HTMLButtonElement>('nlm-qa-clear-image').addEventListener('click', () => {
    state.clipboardImageDataUrl = null;
    updateImagePreview();
    setStatus('画像をクリアしました。', 'info');
  });

  getById<HTMLButtonElement>('nlm-use-current-url').addEventListener('click', () => {
    getById<HTMLTextAreaElement>('nlm-qa-input').value = location.href;
  });

  getById<HTMLButtonElement>('nlm-qa-submit').addEventListener('click', async () => {
    await executeQuickAdd();
  });

  getById<HTMLButtonElement>('nlm-qa-cancel').addEventListener('click', hideQuickModal);
  getById<HTMLButtonElement>('nlm-close-manager').addEventListener('click', hideManagerModal);

  getById<HTMLButtonElement>('nlm-copy-template-export').addEventListener('click', async () => {
    const text = getById<HTMLTextAreaElement>('nlm-template-export').value.trim();
    if (!text) {
      setStatus('全ソーステンプレが空です。', 'error');
      return;
    }
    const ok = await copyTextToClipboard(text);
    setStatus(ok ? '全ソーステンプレをコピーしました。' : 'コピーに失敗しました。', ok ? 'success' : 'error');
  });

  getById<HTMLButtonElement>('nlm-copy-template-role').addEventListener('click', async () => {
    const text = getById<HTMLTextAreaElement>('nlm-template-role').value.trim();
    if (!text) {
      setStatus('伴走くんテンプレが空です。', 'error');
      return;
    }
    const ok = await copyTextToClipboard(text);
    setStatus(ok ? '伴走くんテンプレをコピーしました。' : 'コピーに失敗しました。', ok ? 'success' : 'error');
  });

  getById<HTMLButtonElement>('nlm-add-custom-prompt').addEventListener('click', () => {
    const nextIndex = state.customPrompts.length + 1;
    state.customPrompts.push({
      id: makeCustomPromptId(),
      title: `追加プロンプト${nextIndex}`,
      text: ''
    });
    void saveCustomPrompts();
    renderCustomPromptList();
    setStatus('追加プロンプト枠を追加しました。', 'success');
  });

  getById<HTMLButtonElement>('nlm-summary-copy').addEventListener('click', async () => {
    const text = getById<HTMLTextAreaElement>('nlm-summary-text').value.trim();
    if (!text) {
      setStatus('保存テキストが空です。', 'error');
      return;
    }
    const ok = await copyTextToClipboard(text);
    setStatus(ok ? 'まとめテキストをコピーしました。' : 'コピーに失敗しました。', ok ? 'success' : 'error');
  });

  getById<HTMLButtonElement>('nlm-summary-save').addEventListener('click', async () => {
    const summaryText = getById<HTMLTextAreaElement>('nlm-summary-text').value.trim();
    const manualName = getById<HTMLInputElement>('nlm-summary-title').value.trim();
    const note = getById<HTMLInputElement>('nlm-summary-note').value.trim();
    if (!summaryText) {
      setStatus('保存対象のテキストが空です。', 'error');
      return;
    }

    const filenameStem = sanitizeFilenameStem(manualName || `source_summary_${timestampForFilename()}`);
    const filename = withPrefix(state.settings.backupPathPrefix, `${filenameStem}.txt`);
    const payload = note
      ? `${summaryText}\n\n---\n補足: ${note}\n保存日時: ${formatTimestampToSecond()}`
      : summaryText;

    setStatus('テキスト保存中...', 'info');
    const response = await sendRuntimeMessage({
      type: 'DOWNLOAD_MARKDOWN',
      payload: {
        filename,
        content: payload
      }
    });
    if (!response.ok) {
      setStatus(`保存失敗: ${response.error || '不明なエラー'}`, 'error');
      return;
    }
    setStatus(`テキスト保存完了: ${filename}`, 'success');
  });

  getById<HTMLDivElement>(ids.quickModal).addEventListener('click', (event) => {
    if (event.target === event.currentTarget) hideQuickModal();
  });

  getById<HTMLDivElement>(ids.managerModal).addEventListener('click', (event) => {
    if (event.target === event.currentTarget) hideManagerModal();
  });

  bindQuickInputPasteHandler();
}

function registerMessageHandler(): void {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'OPEN_QUICK_ADD') {
      showQuickModal({
        content: message.payload?.content,
        title: message.payload?.title,
        memo: message.payload?.memo
      });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'OPEN_MANAGER') {
      showManagerModal();
      sendResponse({ ok: true });
      return false;
    }

    sendResponse({ ok: false, error: 'Unhandled message' });
    return false;
  });
}

async function init(): Promise<void> {
  if (!adapter.isNotebookLMPage()) {
    return;
  }

  state.settings = await getSettings();
  await loadCustomPrompts();
  logger.setEnabled(state.settings.enableDevLogs);

  injectStyles();
  renderShell();
  bindEvents();
  registerMessageHandler();
  updateImagePreview();
  renderCustomPromptList();
  setStatus('待機中', 'info');
  setupFabAutoPosition();
  setupChatUrlLinkifier();
  logger.info('content', 'NotebookLM assistant initialized');
}

void init();
