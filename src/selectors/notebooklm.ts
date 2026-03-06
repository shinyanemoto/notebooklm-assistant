export const NOTEBOOKLM_SELECTORS = {
  projectTitle: ['h1', '[data-testid*="notebook-title"]', '[class*="notebook-title"]'],

  openSourcePanelButtons: [
    'button[data-testid*="add-source"]',
    'button[aria-label*="source"]',
    '[data-testid*="source-add"] button',
    '[class*="add-source"] button'
  ],
  openSourcePanelTextHints: ['add source', 'source', 'ソースを追加', 'ソース'],

  sourceInputFields: [
    'textarea',
    '[contenteditable="true"]',
    'input[type="url"]',
    'input[type="text"]'
  ],
  submitSourceButtons: [
    'button[data-testid*="create"]',
    'button[data-testid*="add"]',
    '[class*="submit"] button',
    'button[type="submit"]'
  ],
  submitSourceTextHints: ['create', 'add', 'save', '作成', '追加', '保存'],

  sourceCards: [
    '[data-testid*="source-item"]',
    '[data-source-id]',
    '[class*="source-item"]',
    '[class*="sourceCard"]',
    'div[role="listitem"]'
  ],
  sourceTitle: [
    'h2',
    'h3',
    '[data-testid*="title"]',
    '[class*="title"]',
    '[aria-label*="title"]'
  ],
  sourceBody: ['[class*="content"]', '[class*="snippet"]', 'p', '[data-testid*="body"]'],
  sourceUrl: ['a[href^="http"]'],

  deleteButtons: [
    'button[data-testid*="delete"]',
    'button[aria-label*="Delete"]',
    'button[aria-label*="delete"]',
    'button[aria-label*="削除"]',
    '[class*="delete"] button'
  ],
  deleteTextHints: ['delete', 'remove', '削除'],

  confirmButtons: [
    'button[data-testid*="confirm"]',
    'button[data-testid*="delete-confirm"]',
    '[class*="confirm"] button'
  ],
  confirmTextHints: ['delete', 'confirm', 'yes', '削除', '確認', '実行']
};
