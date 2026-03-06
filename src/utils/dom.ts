export function queryFirstVisible<T extends Element>(selectors: string[], root: ParentNode = document): T | null {
  for (const selector of selectors) {
    const nodes = Array.from(root.querySelectorAll<T>(selector));
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      if (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none') {
        return node;
      }
    }
  }
  return null;
}

export function findClickableByText(texts: string[]): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a'));
  const normalizedTexts = texts.map((t) => t.toLowerCase());
  for (const candidate of candidates) {
    if (candidate.closest('#nlm-assistant-root')) continue;
    const label = (candidate.innerText || candidate.getAttribute('aria-label') || '').trim().toLowerCase();
    if (!label) continue;
    if (normalizedTexts.some((text) => label.includes(text))) {
      return candidate;
    }
  }
  return null;
}

export function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function closestCssPath(node: Element | null): string {
  if (!node) return '';
  const parts: string[] = [];
  let current: Element | null = node;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const id = current.id ? `#${current.id}` : '';
    const cls = current.classList.length ? `.${Array.from(current.classList).slice(0, 2).join('.')}` : '';
    parts.unshift(`${current.tagName.toLowerCase()}${id}${cls}`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}
