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

export class NotebookLMAdapter {
  isNotebookLMPage(): boolean {
    return location.hostname.includes('notebooklm.google.com');
  }

  getProjectName(): string {
    const titleEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.projectTitle);
    if (titleEl) {
      return readElementText(titleEl) || document.title || 'NotebookLM Project';
    }
    return document.title || 'NotebookLM Project';
  }

  private findSourceInput(): HTMLTextAreaElement | HTMLInputElement | HTMLElement | null {
    const input = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceInputFields);
    return input;
  }

  private findSubmitButton(context?: ParentNode): HTMLElement | null {
    const root = context ?? document;
    const button = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.submitSourceButtons, root);
    if (button) return button;
    return findClickableByText(NOTEBOOKLM_SELECTORS.submitSourceTextHints);
  }

  async ensureSourceFlowReady(): Promise<boolean> {
    const existingInput = this.findSourceInput();
    if (existingInput) return true;

    const openButton = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.openSourcePanelButtons) ||
      findClickableByText(NOTEBOOKLM_SELECTORS.openSourcePanelTextHints);

    if (!openButton) {
      logger.warn('adapter', 'Add source button not found');
      return false;
    }

    openButton.click();
    await wait(350);
    const input = this.findSourceInput();
    return Boolean(input);
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

    const ready = await this.ensureSourceFlowReady();
    const text = this.makePayloadText(payload);
    if (!ready) {
      return {
        success: false,
        reason: 'NotebookLMの追加UIを自動操作できませんでした。',
        fallbackText: text
      };
    }

    const input = this.findSourceInput();
    if (!input) {
      return {
        success: false,
        reason: '入力欄が見つかりません。',
        fallbackText: text
      };
    }

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setInputValue(input, text);
    } else {
      input.focus();
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await wait(120);

    const submit = this.findSubmitButton(input.closest('form') ?? undefined) || this.findSubmitButton();
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

  scanSources(): SourceRecord[] {
    if (!this.isNotebookLMPage()) {
      return [];
    }

    const cards = new Set<HTMLElement>();

    for (const selector of NOTEBOOKLM_SELECTORS.sourceCards) {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        cards.add(node);
      }
    }

    if (cards.size === 0) {
      const deletes = Array.from(document.querySelectorAll<HTMLElement>(NOTEBOOKLM_SELECTORS.deleteButtons.join(',')));
      for (const button of deletes) {
        const card = button.closest<HTMLElement>('li, article, section, div');
        if (card) cards.add(card);
      }
    }

    const results: SourceRecord[] = [];
    let index = 1;

    for (const card of cards) {
      const titleEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceTitle, card);
      const bodyEl = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceBody, card);
      const urlEl = queryFirstVisible<HTMLAnchorElement>(NOTEBOOKLM_SELECTORS.sourceUrl, card);
      const deleteBtn = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.deleteButtons, card);

      const title = readElementText(titleEl) || readElementText(card).slice(0, 80);
      if (!title) continue;

      const body = readElementText(bodyEl) || readElementText(card);
      const url = urlEl?.href;
      const id = card.getAttribute('data-source-id') || makeId(title, index);

      results.push({
        id,
        title,
        body,
        url,
        domPathHint: closestCssPath(card),
        cardEl: card,
        deleteButtonEl: deleteBtn ?? undefined
      });
      index += 1;
    }

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
        await wait(200);

        const confirmBtn = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.confirmButtons) ||
          findClickableByText(NOTEBOOKLM_SELECTORS.confirmTextHints);

        if (!confirmBtn) {
          result.failed += 1;
          result.failures.push(`${source.title}: 確認ボタンが見つかりません`);
          continue;
        }

        confirmBtn.click();
        await wait(200);
        result.success += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push(`${source.title}: ${(error as Error).message}`);
      }
    }

    return result;
  }
}
