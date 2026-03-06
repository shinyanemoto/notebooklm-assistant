import { logger } from '../lib/logger';
import { NOTEBOOKLM_SELECTORS } from '../selectors/notebooklm';
import type { QuickAddPayload, SourceItem } from '../types/models';
import { closestCssPath, findClickableByText, queryFirstVisible, setInputValue, wait } from '../utils/dom';

export interface SourceRecord extends SourceItem {
  cardEl: HTMLElement;
  deleteButtonEl?: HTMLElement;
}

function readElementText(el: Element | null): string {
  if (!el) return '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function makeId(base: string, index: number): string {
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return safe ? `${safe}-${index}` : `source-${index}`;
}

function containsAny(text: string, hints: string[]): boolean {
  const target = text.toLowerCase();
  return hints.some((hint) => target.includes(hint.toLowerCase()));
}

export class NotebookLMAdapter {
  isNotebookLMPage(): boolean {
    return location.hostname.includes('notebooklm.google.com');
  }

  private isNotebookDocumentPage(): boolean {
    const path = location.pathname.toLowerCase();
    return /\/notebook\//.test(path) || /\/project\//.test(path) || /\/document\//.test(path);
  }

  getProjectName(): string {
    const titleEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.projectTitle);
    if (titleEl) {
      return readElementText(titleEl) || document.title || 'NotebookLM Project';
    }
    return document.title || 'NotebookLM Project';
  }

  private findSourceDialogContainer(): HTMLElement | null {
    for (const selector of NOTEBOOKLM_SELECTORS.sourceDialogContainers) {
      const containers = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const container of containers) {
        const text = readElementText(container);
        if (containsAny(text, NOTEBOOKLM_SELECTORS.sourceDialogTextHints)) {
          return container;
        }
      }
    }
    return null;
  }

  private findSourceInput(container: ParentNode): HTMLTextAreaElement | HTMLInputElement | HTMLElement | null {
    const input = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceInputFields, container);
    return input;
  }

  private findSubmitButton(container: ParentNode): HTMLElement | null {
    const button = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.submitSourceButtons, container);
    if (button) return button;

    const candidates = Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const candidate of candidates) {
      const label = (candidate.innerText || candidate.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      if (containsAny(label, NOTEBOOKLM_SELECTORS.submitSourceTextHints)) {
        return candidate;
      }
    }
    return null;
  }

  private findDeleteButtonsInDocument(): HTMLElement[] {
    const buttons = new Set<HTMLElement>();

    for (const selector of NOTEBOOKLM_SELECTORS.deleteButtons) {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        buttons.add(node);
      }
    }

    for (const node of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
      const label = (node.innerText || node.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      if (containsAny(label, NOTEBOOKLM_SELECTORS.deleteTextHints)) {
        buttons.add(node);
      }
    }

    return Array.from(buttons);
  }

  private cardFromDeleteButton(button: HTMLElement): HTMLElement | null {
    return button.closest<HTMLElement>(
      '[data-testid*="source-item"], [data-source-id], li[role="listitem"], div[role="listitem"], article, section, div[class*="source"]'
    );
  }

  private sourceTitleFromCard(card: HTMLElement): string {
    const titleEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceTitle, card);
    const title = readElementText(titleEl);
    if (title) return title;
    const fallback = readElementText(card).slice(0, 80);
    return fallback;
  }

  private sourceBodyFromCard(card: HTMLElement): string {
    const bodyEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceBody, card);
    const body = readElementText(bodyEl);
    return body || readElementText(card);
  }

  private sourceUrlFromCard(card: HTMLElement): string | undefined {
    const urlEl = queryFirstVisible<HTMLAnchorElement>(NOTEBOOKLM_SELECTORS.sourceUrl, card);
    return urlEl?.href;
  }

  private collectSourceCards(): SourceRecord[] {
    const cardSet = new Set<HTMLElement>();

    for (const selector of NOTEBOOKLM_SELECTORS.sourceCards) {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        cardSet.add(node);
      }
    }

    const deleteButtons = this.findDeleteButtonsInDocument();
    for (const button of deleteButtons) {
      const card = this.cardFromDeleteButton(button);
      if (card) cardSet.add(card);
    }

    const results: SourceRecord[] = [];
    let index = 1;

    for (const card of cardSet) {
      const title = this.sourceTitleFromCard(card);
      if (!title) continue;

      const body = this.sourceBodyFromCard(card);
      const url = this.sourceUrlFromCard(card);
      const deleteButtonEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.deleteButtons, card) ||
        this.findDeleteButtonsInDocument().find((button) => this.cardFromDeleteButton(button) === card);

      const id = card.getAttribute('data-source-id') || makeId(title, index);
      results.push({
        id,
        title,
        body,
        url,
        domPathHint: closestCssPath(card),
        cardEl: card,
        deleteButtonEl: deleteButtonEl ?? undefined
      });
      index += 1;
    }

    return results;
  }

  private async ensureSourceListVisible(): Promise<void> {
    const hasExisting = this.collectSourceCards().length > 0;
    if (hasExisting) return;

    const button = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.openSourceListButtons) ||
      findClickableByText(NOTEBOOKLM_SELECTORS.openSourceListTextHints);
    if (!button) return;

    button.click();
    await wait(300);
  }

  async ensureSourceFlowReady(): Promise<{ ready: boolean; container?: HTMLElement }> {
    if (!this.isNotebookDocumentPage()) {
      return { ready: false };
    }

    const existingContainer = this.findSourceDialogContainer();
    if (existingContainer && this.findSourceInput(existingContainer)) {
      return { ready: true, container: existingContainer };
    }

    const openButton = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.openSourcePanelButtons) ||
      findClickableByText(NOTEBOOKLM_SELECTORS.openSourcePanelTextHints);

    if (!openButton) {
      logger.warn('adapter', 'Add source button not found');
      return { ready: false };
    }

    openButton.click();
    await wait(350);

    const container = this.findSourceDialogContainer();
    if (!container) {
      return { ready: false };
    }
    return { ready: Boolean(this.findSourceInput(container)), container };
  }

  private makePayloadText(payload: QuickAddPayload): string {
    if (payload.type === 'url') {
      return [
        `# ${payload.title || 'URL Source'}`,
        '',
        payload.content,
        payload.memo ? `\nメモ: ${payload.memo}` : ''
      ].join('\n');
    }

    if (payload.type === 'clipboardImage') {
      return [
        `# ${payload.title || 'Clipboard Image'}`,
        '',
        '- 種別: クリップボード画像',
        payload.sourceUrl ? `- 元ページ: ${payload.sourceUrl}` : '- 元ページ: （不明）',
        '- 注記: 画像本体はローカルバックアップに保存',
        '',
        payload.memo ? `メモ: ${payload.memo}` : 'メモ: （なし）'
      ].join('\n');
    }

    return [
      `# ${payload.title || 'Text Source'}`,
      '',
      payload.content,
      payload.memo ? `\nメモ: ${payload.memo}` : ''
    ].join('\n');
  }

  async addSource(payload: QuickAddPayload): Promise<{ success: boolean; reason?: string; fallbackText?: string }> {
    if (!this.isNotebookLMPage()) {
      return { success: false, reason: 'NotebookLMページではありません。' };
    }

    if (!this.isNotebookDocumentPage()) {
      return {
        success: false,
        reason: 'ノートブック画面ではありません。ノートブックを開いてから実行してください。',
        fallbackText: this.makePayloadText(payload)
      };
    }

    const flow = await this.ensureSourceFlowReady();
    const text = this.makePayloadText(payload);
    if (!flow.ready || !flow.container) {
      return {
        success: false,
        reason: 'NotebookLMのソース追加ダイアログを検出できませんでした。',
        fallbackText: text
      };
    }

    const input = this.findSourceInput(flow.container);
    if (!input) {
      return {
        success: false,
        reason: 'ソース入力欄が見つかりません。',
        fallbackText: text
      };
    }

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setInputValue(input, text);
    } else {
      input.focus();
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await wait(120);

    const submit = this.findSubmitButton(flow.container);
    if (!submit) {
      return {
        success: false,
        reason: '追加実行ボタンが見つかりません。',
        fallbackText: text
      };
    }

    submit.click();
    return { success: true };
  }

  async scanSources(): Promise<SourceRecord[]> {
    if (!this.isNotebookLMPage()) {
      return [];
    }

    let results = this.collectSourceCards();
    if (results.length > 0) return results;

    await this.ensureSourceListVisible();
    await wait(200);
    results = this.collectSourceCards();
    return results;
  }

  async deleteSources(sources: SourceRecord[], dryRun: boolean): Promise<{
    success: number;
    failed: number;
    skipped: number;
    failures: string[];
  }> {
    const result = { success: 0, failed: 0, skipped: 0, failures: [] as string[] };

    for (const source of sources) {
      const btn = source.deleteButtonEl || queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.deleteButtons, source.cardEl);
      if (!btn) {
        result.skipped += 1;
        result.failures.push(`${source.title}: 削除ボタンが見つかりません`);
        continue;
      }

      if (dryRun) {
        result.skipped += 1;
        continue;
      }

      try {
        btn.click();
        await wait(220);

        const confirmBtn = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.confirmButtons) ||
          findClickableByText(NOTEBOOKLM_SELECTORS.confirmTextHints);

        if (!confirmBtn) {
          result.failed += 1;
          result.failures.push(`${source.title}: 確認ボタンが見つかりません`);
          continue;
        }

        confirmBtn.click();
        await wait(220);
        result.success += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push(`${source.title}: ${(error as Error).message}`);
      }
    }

    return result;
  }
}
