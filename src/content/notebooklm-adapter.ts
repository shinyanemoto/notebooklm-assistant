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

function isAssistantUiNode(el: Element | null): boolean {
  return !!el?.closest('#nlm-assistant-root');
}

function nodeSelectorAll<T extends Element>(container: ParentNode, selector: string): T[] {
  if (container instanceof Document || container instanceof ShadowRoot) {
    return queryAllDeep<T>(container, selector);
  }
  return Array.from(container.querySelectorAll<T>(selector));
}

function queryAllDeep<T extends Element>(root: ParentNode, selector: string): T[] {
  const results = new Set<T>();
  const queue: ParentNode[] = [root];
  const visited = new Set<ParentNode>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    for (const node of Array.from(current.querySelectorAll<T>(selector))) {
      results.add(node);
    }

    for (const el of Array.from(current.querySelectorAll<HTMLElement>('*'))) {
      if (el.shadowRoot && !visited.has(el.shadowRoot)) {
        queue.push(el.shadowRoot);
      }
    }
  }

  return Array.from(results);
}

function isNodeInside(node: Node, container: HTMLElement): boolean {
  let current: Node | null = node;
  while (current) {
    if (current === container) return true;
    if (current instanceof ShadowRoot) current = current.host;
    else current = current.parentNode;
  }
  return false;
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
        if (isAssistantUiNode(container)) continue;
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

  private sanitizeFilenameBase(name: string): string {
    const safe = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || 'clipboard_image';
  }

  private async buildClipboardImageFile(payload: QuickAddPayload): Promise<File | null> {
    if (!payload.imageDataUrl) return null;
    try {
      const response = await fetch(payload.imageDataUrl);
      const blob = await response.blob();
      const mime = blob.type || 'image/png';
      const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'png';
      const base = this.sanitizeFilenameBase(payload.title || 'clipboard_image');
      return new File([blob], `${base}.${ext}`, { type: mime });
    } catch (error) {
      logger.warn('adapter', 'failed to build clipboard image file', error);
      return null;
    }
  }

  private findBestFileInput(container: ParentNode): HTMLInputElement | null {
    const inputs = queryAllDeep<HTMLInputElement>(container, 'input[type="file"]').filter((input) => !input.disabled);
    if (inputs.length === 0) return null;

    if (container instanceof HTMLElement) {
      const nested = inputs.filter((input) => isNodeInside(input, container));
      if (nested.length > 0) {
        const nestedImageInput = nested.find((input) => (input.accept || '').toLowerCase().includes('image'));
        return nestedImageInput || nested[0];
      }
    }

    const imageInput = inputs.find((input) => (input.accept || '').toLowerCase().includes('image'));
    return imageInput || inputs[0];
  }

  private findDropTargets(container: HTMLElement): HTMLElement[] {
    const targets = new Set<HTMLElement>();
    const hints = ['またはファイルをドロップ', 'ファイルをドロップ', 'drop file', 'drop files'];

    const rootCandidates = [
      container,
      ...queryAllDeep<HTMLElement>(container, 'div, section, article, label')
    ];

    for (const node of rootCandidates) {
      if (!isVisible(node)) continue;
      const text = readElementText(node).toLowerCase();
      if (!text) continue;
      if (hints.some((hint) => text.includes(hint.toLowerCase()))) {
        targets.add(node);
      }
    }

    if (targets.size === 0) {
      targets.add(container);
    }

    return Array.from(targets);
  }

  private setFilesToInput(input: HTMLInputElement, file: File): boolean {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    } catch (error) {
      logger.warn('adapter', 'failed to inject file into input', error);
      return false;
    }
  }

  private async dropFileOnTarget(target: HTMLElement, file: File): Promise<boolean> {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);

      const events: Array<'dragenter' | 'dragover' | 'drop'> = ['dragenter', 'dragover', 'drop'];
      for (const type of events) {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: transfer
        });
        target.dispatchEvent(event);
      }
      await wait(220);
      return true;
    } catch (error) {
      logger.warn('adapter', 'failed to dispatch drop events', error);
      return false;
    }
  }

  private async pasteFileOnTarget(target: HTMLElement, file: File): Promise<boolean> {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);

      let pasteEvent: ClipboardEvent | null = null;
      try {
        pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          composed: true
        });
        Object.defineProperty(pasteEvent, 'clipboardData', {
          value: transfer
        });
      } catch {
        pasteEvent = null;
      }

      target.focus?.();
      if (pasteEvent) {
        target.dispatchEvent(pasteEvent);
      }

      try {
        const before = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertFromPaste',
          dataTransfer: transfer
        });
        target.dispatchEvent(before);
      } catch {
        // no-op
      }

      try {
        const input = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertFromPaste',
          dataTransfer: transfer
        });
        target.dispatchEvent(input);
      } catch {
        // no-op
      }

      await wait(220);
      return true;
    } catch (error) {
      logger.warn('adapter', 'failed to dispatch paste events', error);
      return false;
    }
  }

  private async writeImageToClipboard(payload: QuickAddPayload): Promise<boolean> {
    try {
      if (!payload.imageDataUrl || !navigator.clipboard || !navigator.clipboard.write) return false;
      const ClipboardItemCtor = (window as unknown as {
        ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem;
      }).ClipboardItem;
      if (!ClipboardItemCtor) return false;

      const response = await fetch(payload.imageDataUrl);
      const blob = await response.blob();
      const mime = blob.type || 'image/png';
      const item = new ClipboardItemCtor({ [mime]: blob });
      await navigator.clipboard.write([item]);
      return true;
    } catch (error) {
      logger.warn('adapter', 'failed to write image clipboard', error);
      return false;
    }
  }

  private dispatchPasteShortcut(target: HTMLElement): void {
    const events: Array<'keydown' | 'keyup'> = ['keydown', 'keyup'];
    for (const eventName of events) {
      target.dispatchEvent(
        new KeyboardEvent(eventName, {
          key: 'v',
          code: 'KeyV',
          bubbles: true,
          cancelable: true,
          composed: true,
          ctrlKey: true,
          metaKey: true
        })
      );
    }
  }

  private async waitForFileInput(container: HTMLElement, timeoutMs = 2400): Promise<HTMLInputElement | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = this.findBestFileInput(container) || this.findBestFileInput(document);
      if (input) return input;
      await wait(120);
    }
    return null;
  }

  private async tryClipboardImageImport(container: HTMLElement, payload: QuickAddPayload): Promise<boolean> {
    if (payload.type !== 'clipboardImage') return false;
    const imageFile = await this.buildClipboardImageFile(payload);
    if (!imageFile) return false;

    const dialog = await this.waitForSourceDialog(1400) ?? container;
    const fileModeButton = this.findButtonByHints(dialog, NOTEBOOKLM_SELECTORS.sourceModeTextHints.file);
    if (fileModeButton) {
      fileModeButton.click();
      await wait(180);
    }

    const activeDialog = await this.waitForSourceDialog(1200) ?? dialog;

    // Strategy 1: direct assignment to file input.
    let input = this.findBestFileInput(activeDialog) || this.findBestFileInput(document);
    if (!input) {
      const uploadButton = this.findButtonByHints(activeDialog, ['ファイルをアップロード', 'upload file', 'upload']);
      if (uploadButton) {
        uploadButton.click();
        await wait(120);
      }
      input = await this.waitForFileInput(activeDialog, 1800);
    }

    if (input && this.setFilesToInput(input, imageFile)) {
      await wait(220);
      const submit = this.findSubmitButton(this.findSourceDialogContainer() ?? activeDialog);
      if (submit) {
        submit.click();
        await wait(180);
      }
      if (await this.waitForDialogClosed(9000)) {
        return true;
      }
      logger.warn('adapter', 'file input assignment path did not close dialog');
    }

    // Strategy 2: synthetic drop on drop-zone-like targets.
    for (const target of this.findDropTargets(activeDialog)) {
      const dropped = await this.dropFileOnTarget(target, imageFile);
      if (!dropped) continue;

      const submit = this.findSubmitButton(this.findSourceDialogContainer() ?? activeDialog);
      if (submit) {
        submit.click();
        await wait(180);
      }
      if (await this.waitForDialogClosed(9000)) {
        return true;
      }
    }

    // Strategy 3: synthetic paste for UIs that accept image paste into the source modal.
    const pasteTargets = [document.activeElement, ...this.findDropTargets(activeDialog)]
      .filter((node): node is HTMLElement => node instanceof HTMLElement);

    for (const target of pasteTargets) {
      const pasted = await this.pasteFileOnTarget(target, imageFile);
      if (!pasted) continue;

      const submit = this.findSubmitButton(this.findSourceDialogContainer() ?? activeDialog);
      if (submit) {
        submit.click();
        await wait(180);
      }
      if (await this.waitForDialogClosed(9000)) {
        return true;
      }
    }

    // Strategy 4: clipboard write + native paste command attempt.
    const clipboardPrepared = await this.writeImageToClipboard(payload);
    if (clipboardPrepared) {
      const target = (this.findBestInput(activeDialog, 'text') as HTMLElement | null) ??
        this.findDropTargets(activeDialog)[0] ??
        activeDialog;
      target.focus?.();
      target.click?.();

      try {
        document.execCommand('paste');
      } catch {
        // no-op
      }
      this.dispatchPasteShortcut(target);
      await wait(240);

      const submit = this.findSubmitButton(this.findSourceDialogContainer() ?? activeDialog);
      if (submit) {
        submit.click();
        await wait(180);
      }
      if (await this.waitForDialogClosed(9000)) {
        return true;
      }
    }

    logger.warn('adapter', 'clipboard image import failed in all strategies');
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

    if (payload.type === 'clipboardImage') {
      const imageImported = await this.tryClipboardImageImport(container, payload);
      if (imageImported) return true;
      logger.warn('adapter', 'clipboard image import failed');
      return false;
    }

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
        if (isAssistantUiNode(node)) continue;
        buttons.add(node);
      }
    }

    for (const node of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
      if (isAssistantUiNode(node)) continue;
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
        if (isAssistantUiNode(node)) continue;
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

  private isLikelySourceCard(node: HTMLElement, inSourceContainer: boolean): boolean {
    const text = readElementText(node);
    if (text.length < 12 || text.length > 5000) return false;

    const label = `${node.getAttribute('aria-label') || ''} ${node.className || ''}`;
    const hasSourceWord = containsAny(label, ['source', 'sources', 'ソース', 'reference', 'refs']);
    const hasSourceSignals = !!(
      node.querySelector('[data-testid*="source"], [data-source-id], [role="treeitem"]') ||
      node.querySelector('a[href^="http"]') ||
      node.querySelector('button[aria-label*="delete"], button[aria-label*="削除"]')
    );
    const hasRowShape = !!(
      node.matches('[role="listitem"], [role="treeitem"], article, section') ||
      node.querySelector('h2, h3, strong, [role="heading"]')
    );
    const hasActionButtons = !!node.querySelector('button, [role="button"]');

    let score = 0;
    if (hasSourceSignals) score += 3;
    if (hasRowShape) score += 2;
    if (hasActionButtons) score += 1;
    if (hasSourceWord) score += 2;
    if (inSourceContainer) score += 1;

    return score >= (inSourceContainer ? 3 : 5);
  }

  private compactCardCandidates(nodes: HTMLElement[]): HTMLElement[] {
    const unique = Array.from(new Set(nodes));
    unique.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

    const filtered: HTMLElement[] = [];
    for (const node of unique) {
      if (filtered.some((kept) => node.contains(kept))) {
        continue;
      }
      filtered.push(node);
    }
    return filtered;
  }

  private collectSourceCardsFromContainer(container: ParentNode): SourceRecord[] {
    const cardSet = new Set<HTMLElement>();
    const inSourceContainer = container !== document;

    for (const selector of NOTEBOOKLM_SELECTORS.sourceCards) {
      for (const node of nodeSelectorAll<HTMLElement>(container, selector)) {
        if (isAssistantUiNode(node)) continue;
        if (!isVisible(node)) continue;
        if (!this.isLikelySourceCard(node, inSourceContainer)) continue;
        cardSet.add(node);
      }
    }

    // Fallback heuristic: list-like blocks with meaningful text.
    const fallbackSelector = inSourceContainer
      ? 'li, article, section, [role="listitem"], [role="treeitem"], div'
      : 'li, article, section, [role="listitem"], [role="treeitem"]';
    for (const node of nodeSelectorAll<HTMLElement>(container, fallbackSelector)) {
      if (isAssistantUiNode(node)) continue;
      if (!isVisible(node)) continue;
      if (!this.isLikelySourceCard(node, inSourceContainer)) continue;
      cardSet.add(node);
    }

    const results: SourceRecord[] = [];
    let index = 1;

    for (const card of this.compactCardCandidates(Array.from(cardSet))) {
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
    const candidates = Array.from(card.querySelectorAll<HTMLElement>(NOTEBOOKLM_SELECTORS.sourceTitle.join(',')))
      .filter((el) => readElementText(el).length > 0);
    for (const el of candidates) {
      const text = readElementText(el);
      if (text.length < 2 || text.length > 180) continue;
      if (containsAny(text, ['delete', 'remove', 'open', 'menu', 'more', '削除', '開く', 'その他'])) continue;
      return text;
    }
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

  async openSourceDialog(): Promise<boolean> {
    const flow = await this.ensureSourceFlowReady();
    return !!(flow.ready && flow.container);
  }

  closeSourceDialog(): boolean {
    const dialog = this.findSourceDialogContainer();
    if (!dialog) return false;

    const closeButton = queryFirstVisible<HTMLElement>(
      [
        'button[aria-label*="Close"]',
        'button[aria-label*="close"]',
        'button[aria-label*="閉じる"]'
      ],
      dialog
    ) || findClickableByText(['閉じる', 'close', 'キャンセル', 'cancel']);

    if (closeButton) {
      closeButton.click();
      return true;
    }

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    return true;
  }

  async prepareManualImageUpload(): Promise<boolean> {
    if (!this.isNotebookDocumentPage()) return false;

    const flow = await this.ensureSourceFlowReady();
    if (!flow.ready || !flow.container) return false;

    const dialog = (await this.waitForSourceDialog(1000)) ?? flow.container;
    const fileModeButton = this.findButtonByHints(dialog, NOTEBOOKLM_SELECTORS.sourceModeTextHints.file);
    if (fileModeButton) {
      fileModeButton.click();
      await wait(180);
    }

    const activeDialog = (await this.waitForSourceDialog(1000)) ?? dialog;
    const uploadButton = this.findButtonByHints(activeDialog, ['ファイルをアップロード', 'upload file', 'upload']) ||
      findClickableByText(['ファイルをアップロード', 'upload file']);
    if (uploadButton) {
      uploadButton.focus?.();
      uploadButton.click();
      await wait(100);
      return true;
    }

    const fileInput = this.findBestFileInput(activeDialog) || this.findBestFileInput(document);
    if (!fileInput) return false;

    try {
      if (typeof fileInput.showPicker === 'function') {
        fileInput.showPicker();
        return true;
      }
    } catch {
      // no-op
    }

    try {
      fileInput.click();
      return true;
    } catch {
      return false;
    }
  }

  async scanSources(): Promise<SourceRecord[]> {
    if (!this.isNotebookLMPage()) {
      return [];
    }

    let results: SourceRecord[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt === 1 || attempt === 4) {
        await this.ensureSourceListVisible();
      } else if (attempt === 2 || attempt === 6) {
        await this.ensureSourcesTabVisible();
      }

      results = this.collectSourceCards();
      if (results.length > 0) {
        break;
      }
      await wait(260 + (attempt * 90));
    }

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
