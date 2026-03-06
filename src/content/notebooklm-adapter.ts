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

  private async ensureSourcesTabVisible(): Promise<void> {
    const sourceTab = findClickableByText(['ソース', 'sources']);
    if (!sourceTab) return;
    sourceTab.click();
    await wait(220);
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
        if (candidate instanceof HTMLInputElement && candidate.type === 'url') return candidate;
        const text = this.fieldText(candidate);
        if (containsAny(text, ['url', 'リンク', 'link', 'website', 'ウェブサイト', 'http', '検索', 'search web'])) {
          return candidate;
        }
      }

      for (const candidate of candidates) {
        if (this.isWebSearchInput(candidate)) return candidate;
      }

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

  private triggerEnterSubmit(input: HTMLTextAreaElement | HTMLInputElement | HTMLElement): void {
    input.focus();
    const events: Array<'keydown' | 'keypress' | 'keyup'> = ['keydown', 'keypress', 'keyup'];
    for (const eventName of events) {
      input.dispatchEvent(
        new KeyboardEvent(eventName, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        })
      );
    }
  }

  private findSubmitButton(container: ParentNode, input?: HTMLElement | null): HTMLElement | null {
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
    const iconOnly = buttons.filter((button) => !button.innerText.trim() && !!button.querySelector('svg, [data-icon]'));
    if (input && iconOnly.length > 0) {
      const inputRect = input.getBoundingClientRect();
      const near = iconOnly.find((button) => {
        const rect = button.getBoundingClientRect();
        const sameRow = Math.abs(rect.top - inputRect.top) < 80;
        const toRight = rect.left >= inputRect.left;
        return sameRow && toRight;
      });
      if (near) return near;
    }

    if (iconOnly.length === 1) return iconOnly[0];
    if (buttons.length === 1) return buttons[0];

    return null;
  }

  private async selectSourceMode(container: HTMLElement, type: QuickAddPayload['type']): Promise<HTMLElement> {
    if (type !== 'url') {
      // Text/image paths use the dedicated "copied text" flow in fillInputAndSubmit.
      return container;
    }

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

  private async writeClipboardText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      logger.warn('adapter', 'navigator.clipboard.writeText failed', error);
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch (error) {
      logger.warn('adapter', 'execCommand(copy) failed', error);
      return false;
    }
  }

  private async waitForDialogClosed(timeoutMs = 6000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const dialog = this.findSourceDialogContainer();
      if (!dialog) return true;
      await wait(120);
    }
    return false;
  }

  private async tryClipboardTextImport(container: HTMLElement, text: string): Promise<boolean> {
    const modeButton = this.findButtonByHints(container, ['コピーしたテキスト', 'paste text', 'pasted text', 'copied text']);
    if (!modeButton) return false;
    modeButton.click();
    await wait(160);

    const nextDialog = await this.waitForSourceDialog(1400) ?? container;

    const input = this.findBestInput(nextDialog, 'text');
    if (input) {
      this.setElementValue(input, text);
      await wait(60);
      this.triggerEnterSubmit(input);
      await wait(80);
      const submit = this.findSubmitButton(nextDialog, input);
      if (submit) {
        submit.click();
        return this.waitForDialogClosed(5000);
      }
      return this.waitForDialogClosed(3000);
    }

    // Fallback: clipboard import mode for NotebookLM variants that read directly from clipboard.
    const clipboardOk = await this.writeClipboardText(text);
    if (!clipboardOk) {
      logger.warn('adapter', 'clipboard text write failed; copied-text fallback unavailable');
      return false;
    }

    const retryButton = this.findButtonByHints(nextDialog, ['コピーしたテキスト', 'paste text', 'pasted text', 'copied text']) ?? modeButton;
    retryButton.click();
    return this.waitForDialogClosed(5000);
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

    if (payload.type !== 'url') {
      const imported = await this.tryClipboardTextImport(container, value);
      if (imported) return true;
    }

    const input = this.findBestInput(container, payload.type);

    if (!input) {
      if (payload.type !== 'url') {
        return this.tryClipboardTextImport(container, value);
      }
      return false;
    }

    this.setElementValue(input, value);
    await wait(140);

    this.triggerEnterSubmit(input);
    await wait(100);

    const submit = this.findSubmitButton(container, input);
    if (!submit) {
      // Some NotebookLM variants accept Enter without a visible submit button.
      return this.waitForDialogClosed(5000);
    }

    submit.click();
    await wait(120);
    return this.waitForDialogClosed(5000);
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

  private findSourceListContainer(): HTMLElement | null {
    const selectors = [
      '[data-testid*="source-list"]',
      '[data-testid*="sources"]',
      '[aria-label*="Sources"]',
      '[aria-label*="ソース"]',
      'aside',
      'section',
      'div'
    ];

    const hints = ['sources', 'source list', 'ソース', 'source'];
    let best: { score: number; el: HTMLElement } | null = null;

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = readElementText(node);
        if (!text) continue;

        let score = 0;
        if (containsAny(text, hints)) score += 2;
        if (node.querySelector('[data-testid*="source-item"], [data-source-id]')) score += 4;
        if (node.querySelector('button[aria-label*="ソース"], button[aria-label*="source"]')) score += 2;
        if (node.querySelector('a[href*="source"]')) score += 1;

        const childCount = node.querySelectorAll('li, article, section, [role="listitem"]').length;
        if (childCount >= 2) score += 2;

        if (score >= 3 && (!best || score > best.score)) {
          best = { score, el: node };
        }
      }
    }

    return best?.el ?? null;
  }

  private collectSourceCardsFromContainer(container: ParentNode): SourceRecord[] {
    const cardSet = new Set<HTMLElement>();

    for (const selector of NOTEBOOKLM_SELECTORS.sourceCards) {
      for (const node of Array.from(container.querySelectorAll<HTMLElement>(selector))) {
        if (isVisible(node)) cardSet.add(node);
      }
    }

    // Fallback heuristic: list-like blocks with meaningful text.
    for (const node of Array.from(container.querySelectorAll<HTMLElement>('li, article, section, [role="listitem"], div'))) {
      if (!isVisible(node)) continue;
      const text = readElementText(node);
      if (text.length < 20 || text.length > 3000) continue;

      const hasSourceSignals =
        node.querySelector('a[href*="http"]') ||
        node.querySelector('button[aria-label*="delete"], button[aria-label*="削除"]') ||
        node.querySelector('[data-testid*="source"]');

      if (hasSourceSignals) {
        cardSet.add(node);
      }
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

      const id = card.getAttribute('data-source-id') || makeId(`${title}-${index}`, index);
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
    const container = this.findSourceListContainer();
    if (container) {
      const fromContainer = this.collectSourceCardsFromContainer(container);
      if (fromContainer.length > 0) {
        return fromContainer;
      }
    }

    // Document-wide fallback when source container is not detected.
    const fromDocument = this.collectSourceCardsFromContainer(document);
    if (fromDocument.length > 0) {
      return fromDocument;
    }

    // Final fallback: build records from delete buttons.
    const results: SourceRecord[] = [];
    let index = 1;
    for (const button of this.findDeleteButtonsInDocument()) {
      const card = this.cardFromDeleteButton(button);
      if (!card) continue;
      if (!isVisible(card)) continue;

      const title = this.sourceTitleFromCard(card);
      if (!title) continue;
      results.push({
        id: makeId(`${title}-${index}`, index),
        title,
        body: this.sourceBodyFromCard(card),
        url: this.sourceUrlFromCard(card),
        domPathHint: closestCssPath(card),
        cardEl: card,
        deleteButtonEl: button
      });
      index += 1;
    }
    return results;
  }

  private async ensureSourceListVisible(): Promise<void> {
    const hasExisting = this.collectSourceCards().length > 0;
    if (hasExisting) return;

    const candidates = [
      queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.openSourceListButtons),
      findClickableByText(NOTEBOOKLM_SELECTORS.openSourceListTextHints),
      findClickableByText(['sources', 'source', 'ソース', 'ソース一覧'])
    ].filter(Boolean) as HTMLElement[];

    for (const button of candidates) {
      button.click();
      await wait(320);
      if (this.collectSourceCards().length > 0) {
        return;
      }
    }
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
      await this.ensureSourcesTabVisible();
    }

    const retryOpenButton = queryFirstVisible<HTMLElement>(NOTEBOOKLM_SELECTORS.openSourcePanelButtons) ||
      findClickableByText(NOTEBOOKLM_SELECTORS.openSourcePanelTextHints);

    if (!retryOpenButton) {
      logger.warn('adapter', 'Add source button not found');
      return { ready: false };
    }

    retryOpenButton.click();
    await wait(140);

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
    await wait(300);
    results = this.collectSourceCards();

    if (results.length === 0) {
      logger.warn('adapter', 'source scan returned 0 items after fallbacks');
    } else {
      logger.info('adapter', `source scan found ${results.length} items`);
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
