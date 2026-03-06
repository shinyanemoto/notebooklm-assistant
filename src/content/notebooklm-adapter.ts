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

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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
        if (!isVisible(container)) continue;
        const text = readElementText(container);
        if (containsAny(text, NOTEBOOKLM_SELECTORS.sourceDialogTextHints)) {
          return container;
        }
      }
    }
    return null;
  }

  private async waitForSourceDialog(timeoutMs = 3000): Promise<HTMLElement | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dialog = this.findSourceDialogContainer();
      if (dialog) return dialog;
      await wait(120);
    }
    return null;
  }

  private findButtons(container: ParentNode): HTMLElement[] {
    const items = new Set<HTMLElement>();

    for (const selector of NOTEBOOKLM_SELECTORS.sourceModeButtons) {
      for (const node of Array.from(container.querySelectorAll<HTMLElement>(selector))) {
        if (isVisible(node)) items.add(node);
      }
    }

    for (const node of Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
      if (isVisible(node)) items.add(node);
    }

    return Array.from(items);
  }

  private findButtonByHints(container: ParentNode, hints: string[]): HTMLElement | null {
    const buttons = this.findButtons(container);
    for (const button of buttons) {
      const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      if (containsAny(label, hints)) {
        return button;
      }
    }
    return null;
  }

  private fieldText(el: Element): string {
    return [
      (el.getAttribute('placeholder') || '').trim(),
      (el.getAttribute('aria-label') || '').trim(),
      readElementText(el)
    ].join(' ');
  }

  private isWebSearchInput(el: Element): boolean {
    const text = this.fieldText(el);
    return containsAny(text, NOTEBOOKLM_SELECTORS.webSearchInputHints);
  }

  private findBestInput(container: ParentNode, type: QuickAddPayload['type']): HTMLTextAreaElement | HTMLInputElement | HTMLElement | null {
    const candidates = Array.from(container.querySelectorAll<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceInputFields.join(',')))
      .filter((el) => isVisible(el as HTMLElement));

    if (candidates.length === 0) return null;

    if (type === 'url') {
      for (const candidate of candidates) {
        if (this.isWebSearchInput(candidate)) continue;
        if (candidate instanceof HTMLInputElement && candidate.type === 'url') return candidate;
        const text = this.fieldText(candidate);
        if (containsAny(text, ['url', 'リンク', 'link', 'website', 'ウェブサイト', 'http'])) {
          return candidate;
        }
      }

      // Last fallback: web search style input can still resolve URL source in some NotebookLM builds.
      for (const candidate of candidates) {
        if (candidate instanceof HTMLInputElement) return candidate;
      }
      return candidates[0];
    }

    for (const candidate of candidates) {
      if (this.isWebSearchInput(candidate)) continue;
      if (candidate instanceof HTMLTextAreaElement) return candidate;
      if (candidate.getAttribute('contenteditable') === 'true') return candidate;
    }

    for (const candidate of candidates) {
      if (!this.isWebSearchInput(candidate)) return candidate;
    }

    return null;
  }

  private setElementValue(input: HTMLTextAreaElement | HTMLInputElement | HTMLElement, value: string): void {
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setInputValue(input, value);
      return;
    }

    input.focus();
    input.textContent = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private findSubmitButton(container: ParentNode): HTMLElement | null {
    const selectorHit = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.submitSourceButtons, container);
    if (selectorHit) return selectorHit;

    const byText = this.findButtonByHints(container, [
      ...NOTEBOOKLM_SELECTORS.submitSourceTextHints,
      '完了',
      '取り込む',
      'import',
      'done'
    ]);
    if (byText) return byText;

    const buttons = this.findButtons(container).filter((button) => !(button as HTMLButtonElement).disabled);
    if (buttons.length === 1) return buttons[0];

    return null;
  }

  private async selectSourceMode(container: HTMLElement, type: QuickAddPayload['type']): Promise<HTMLElement> {
    const hints = type === 'url'
      ? NOTEBOOKLM_SELECTORS.sourceModeTextHints.url
      : NOTEBOOKLM_SELECTORS.sourceModeTextHints.text;

    const modeButton = this.findButtonByHints(container, hints);
    if (modeButton) {
      modeButton.click();
      await wait(260);
      const maybeNew = await this.waitForSourceDialog(1200);
      if (maybeNew) return maybeNew;
    }
    return container;
  }

  private async tryClipboardTextImport(container: HTMLElement, text: string): Promise<boolean> {
    const modeButton = this.findButtonByHints(container, NOTEBOOKLM_SELECTORS.sourceModeTextHints.text);
    if (!modeButton) return false;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch (error) {
      logger.warn('adapter', 'clipboard write failed', error);
    }

    modeButton.click();
    await wait(300);

    const nextDialog = await this.waitForSourceDialog(1400);
    if (!nextDialog) {
      return true;
    }

    const input = this.findBestInput(nextDialog, 'text');
    if (!input) {
      const submit = this.findSubmitButton(nextDialog);
      if (submit) {
        submit.click();
        return true;
      }
      return false;
    }

    this.setElementValue(input, text);
    await wait(120);
    const submit = this.findSubmitButton(nextDialog);
    if (!submit) return false;
    submit.click();
    return true;
  }

  private makePayloadText(payload: QuickAddPayload): string {
    if (payload.type === 'url') {
      return payload.content;
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

  private async fillInputAndSubmit(container: HTMLElement, payload: QuickAddPayload): Promise<boolean> {
    const value = this.makePayloadText(payload);
    const input = this.findBestInput(container, payload.type);

    if (!input) {
      if (payload.type !== 'url') {
        return this.tryClipboardTextImport(container, value);
      }
      return false;
    }

    this.setElementValue(input, value);
    await wait(140);

    const submit = this.findSubmitButton(container);
    if (!submit) {
      return false;
    }

    submit.click();
    return true;
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
    return readElementText(card).slice(0, 80);
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

  private async ensureSourceFlowReady(): Promise<{ ready: boolean; container?: HTMLElement }> {
    if (!this.isNotebookDocumentPage()) {
      return { ready: false };
    }

    const existingContainer = this.findSourceDialogContainer();
    if (existingContainer) {
      return { ready: true, container: existingContainer };
    }

    const openButton = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.openSourcePanelButtons) ||
      findClickableByText(NOTEBOOKLM_SELECTORS.openSourcePanelTextHints);

    if (!openButton) {
      logger.warn('adapter', 'Add source button not found');
      return { ready: false };
    }

    openButton.click();
    await wait(220);

    const container = await this.waitForSourceDialog(2200);
    if (!container) {
      return { ready: false };
    }

    return { ready: true, container };
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
    if (!flow.ready || !flow.container) {
      return {
        success: false,
        reason: 'NotebookLMのソース追加ダイアログを検出できませんでした。',
        fallbackText: this.makePayloadText(payload)
      };
    }

    const modeContainer = await this.selectSourceMode(flow.container, payload.type);
    const ok = await this.fillInputAndSubmit(modeContainer, payload);

    if (!ok) {
      return {
        success: false,
        reason: 'ソース追加の入力または確定ボタン操作に失敗しました。',
        fallbackText: this.makePayloadText(payload)
      };
    }

    return { success: true };
  }

  async scanSources(): Promise<SourceRecord[]> {
    if (!this.isNotebookLMPage()) {
      return [];
    }

    let results = this.collectSourceCards();
    if (results.length > 0) return results;

    await this.ensureSourceListVisible();
    await wait(220);
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
