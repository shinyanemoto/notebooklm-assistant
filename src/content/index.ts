import { buildBackupFilename, buildImageFilename, createBackupMarkdown } from '../backup/backup';
import { logger } from '../lib/logger';
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
  clipboardImageDataUrl: null
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

function dedupeSources(sources: SourceRecord[]): SourceRecord[] {
  const map = new Map<string, SourceRecord>();
  for (const source of sources) {
    const key = `${source.title}::${source.body.slice(0, 80)}`;
    if (!map.has(key)) {
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
  deleteBtn.disabled = targets.length === 0 || !backedUp;
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
    setStatus(`ソースを${state.sources.length}件読み込みました。`, 'success');
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

async function writeImageDataUrlToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    const ClipboardItemCtor = (window as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem }).ClipboardItem;
    if (!clipboard || !clipboard.write || !ClipboardItemCtor) {
      return false;
    }

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const mime = blob.type || 'image/png';
    const item = new ClipboardItemCtor({ [mime]: blob });
    await clipboard.write([item]);
    return true;
  } catch (error) {
    logger.warn('content', 'writeImageDataUrlToClipboard failed', error);
    return false;
  }
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

async function ensureClipboardImageLoaded(): Promise<void> {
  const dataUrl = await readClipboardImage();
  state.clipboardImageDataUrl = dataUrl;
  updateImagePreview();
}

async function downloadImageBackup(dataUrl: string): Promise<void> {
  const filename = withPrefix(state.settings.backupPathPrefix, buildImageFilename());
  const response = await sendRuntimeMessage({
    type: 'DOWNLOAD_DATA_URL',
    payload: {
      filename,
      dataUrl
    }
  });
  if (!response.ok) {
    throw new Error(response.error || '画像バックアップ保存に失敗しました');
  }
}

function defaultTitleFromContent(type: QuickAddPayload['type'], content: string): string {
  if (type === 'clipboardImage') {
    return `Clipboard Image ${new Date().toISOString().slice(0, 10)}`;
  }

  const firstLine = content.split('\n').map((v) => v.trim()).find(Boolean) || 'テキスト追加';
  return firstLine.slice(0, 40);
}

function buildQuickPayload(): QuickAddPayload {
  const inputText = getById<HTMLTextAreaElement>('nlm-qa-input').value.trim();
  const manualTitle = getById<HTMLInputElement>('nlm-qa-title').value.trim();
  const memo = getById<HTMLTextAreaElement>('nlm-qa-memo').value.trim();

  const type: QuickAddPayload['type'] = state.clipboardImageDataUrl ? 'clipboardImage' : 'text';

  const title = manualTitle || defaultTitleFromContent(type, inputText);

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
  const payload = buildQuickPayload();

  if (payload.type === 'clipboardImage' && payload.imageDataUrl) {
    try {
      await downloadImageBackup(payload.imageDataUrl);
    } catch (error) {
      setStatus(`画像バックアップ失敗: ${(error as Error).message}`, 'error');
      return;
    }
  }

  if (!payload.content && payload.type !== 'clipboardImage') {
    setStatus('貼り付け内容が空です。テキストまたはURLを貼り付けてください。', 'error');
    return;
  }

  setStatus('NotebookLMへ追加中...', 'info');
  const result = await adapter.addSource(payload);
  if (result.success) {
    setStatus('追加フローを実行しました。', 'success');
    hideQuickModal();
    return;
  }

  if (payload.type === 'clipboardImage') {
    const uploadPickerOpened = await adapter.prepareManualImageUpload();
    const dialogOpened = uploadPickerOpened ? true : await adapter.openSourceDialog();
    const clipboardPrepared = payload.imageDataUrl ? await writeImageDataUrlToClipboard(payload.imageDataUrl) : false;
    const instructions = [
      `画像の自動追加に失敗: ${result.reason || '不明なエラー'}`,
      dialogOpened ? 'NotebookLMのソース追加ダイアログを開きました。' : 'NotebookLMのソース追加ダイアログを開けませんでした。',
      uploadPickerOpened
        ? 'ファイル選択を開きました。直近の notebooklm_clipboard_image_*.png を選択して取り込んでください。'
        : (clipboardPrepared
          ? '画像をクリップボードへ再セットしました。ダイアログ上で Ctrl/Cmd+V して、挿入（または追加）を押してください。'
          : '画像のクリップボード再セットに失敗しました。ダイアログ上で手動アップロードしてください。')
    ];
    setStatus(instructions.join(' '), 'error');
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
  const result = await adapter.deleteSources(targets, dryRun);
  const summary = `削除結果: success=${result.success}, failed=${result.failed}, skipped=${result.skipped}`;
  if (result.failed > 0) {
    setStatus(`${summary} / ${result.failures[0]}`, 'error');
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
      <button id="nlm-open-manager" class="nlm-fab secondary">整理/統合</button>
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
        <h2>ソース整理 / 統合 / バックアップ / 削除</h2>

        <div class="nlm-actions">
          <button id="nlm-refresh-sources">ソース再取得</button>
          <button id="nlm-select-all">全選択</button>
          <button id="nlm-clear-selection">選択解除</button>
          <button id="nlm-close-manager">閉じる</button>
        </div>

        <div class="nlm-row">
          <label>ソース一覧</label>
          <div id="${ids.sourceList}" class="nlm-source-list"></div>
        </div>

        <div class="nlm-grid-2">
          <div class="nlm-row">
            <label>マージ方式</label>
            <select id="nlm-merge-mode">
              <option value="simple">単純連結</option>
              <option value="structured">構造化</option>
            </select>
          </div>
          <div class="nlm-row">
            <label>統合タイトル</label>
            <input id="nlm-merge-title" type="text" placeholder="統合ソース_YYYY-MM-DD" />
          </div>
        </div>

        <div class="nlm-row">
          <label>補足メモ</label>
          <textarea id="nlm-merge-notes" rows="2" placeholder="統合時のメモ"></textarea>
        </div>

        <div class="nlm-actions">
          <button id="nlm-backup-selected">選択ソースをバックアップ</button>
          <button id="nlm-preview-merge">統合プレビュー生成</button>
          <button id="nlm-add-merged" class="primary">統合ソースを追加（事前バックアップ付き）</button>
        </div>

        <div class="nlm-row">
          <label>統合プレビュー（Markdown）</label>
          <textarea id="${ids.mergePreview}" rows="10" placeholder="ここに統合Markdownが表示されます"></textarea>
        </div>

        <div class="nlm-grid-2">
          <div class="nlm-row">
            <label>削除対象</label>
            <select id="${ids.deleteTarget}">
              <option value="selected">チェックしたソース</option>
              <option value="all">表示中の全ソース</option>
            </select>
          </div>
          <div class="nlm-row">
            <label><input id="${ids.dryRun}" type="checkbox" /> Dry-run (削除せずシミュレーション)</label>
            <div id="${ids.backupInfo}" class="nlm-empty">最新バックアップ対象: なし</div>
          </div>
        </div>

        <div class="nlm-actions">
          <button id="${ids.deleteButton}" class="danger" disabled>一括削除（バックアップ済み対象のみ）</button>
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
    await refreshSources();
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

  getById<HTMLButtonElement>('nlm-refresh-sources').addEventListener('click', async () => {
    await refreshSources();
  });

  getById<HTMLButtonElement>('nlm-select-all').addEventListener('click', () => {
    state.selectedIds = new Set(state.sources.map((s) => s.id));
    renderSourceList();
  });

  getById<HTMLButtonElement>('nlm-clear-selection').addEventListener('click', () => {
    state.selectedIds = new Set();
    renderSourceList();
  });

  getById<HTMLButtonElement>('nlm-backup-selected').addEventListener('click', async () => {
    await createBackup('manual', selectedSources());
  });

  getById<HTMLButtonElement>('nlm-preview-merge').addEventListener('click', async () => {
    await previewMerge();
  });

  getById<HTMLButtonElement>('nlm-add-merged').addEventListener('click', async () => {
    await addMergedSource();
  });

  getById<HTMLSelectElement>(ids.deleteTarget).addEventListener('change', updateDeleteButtonState);

  getById<HTMLButtonElement>(ids.deleteButton).addEventListener('click', async () => {
    await executeDelete();
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
      refreshSources().then(() => {
        sendResponse({ ok: true });
      }).catch((error) => {
        sendResponse({ ok: false, error: (error as Error).message });
      });
      return true;
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
  logger.setEnabled(state.settings.enableDevLogs);

  injectStyles();
  renderShell();
  bindEvents();
  registerMessageHandler();
  updateImagePreview();
  setStatus('待機中', 'info');
  setupFabAutoPosition();
  logger.info('content', 'NotebookLM assistant initialized');
}

void init();
