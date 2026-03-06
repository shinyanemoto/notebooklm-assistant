export const NOTEBOOKLM_SELECTORS = {
  projectTitle: ['h1', '[data-testid*="notebook-title"]', '[class*="notebook-title"]'],

  openSourcePanelButtons: [
    'button[data-testid*="add-source"]',
    'button[aria-label*="Add source"]',
    'button[aria-label*="add source"]',
    'button[aria-label*="ソースを追加"]',
    '[data-testid*="source-add"] button',
    '[class*="add-source"] button'
  ],
  openSourcePanelTextHints: ['add source', 'add sources', 'ソースを追加', 'ソースを追加する'],

  sourceDialogContainers: [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="source-dialog"]',
    '[class*="sourceModal"]'
  ],
  sourceDialogTextHints: ['add source', 'add sources', 'ソースを追加', '新しいソース'],
  sourceModeButtons: [
    'button[data-testid*="source-type"]',
    'button[data-testid*="import-type"]',
    'button[aria-label*="コピーしたテキスト"]',
    'button[aria-label*="ウェブサイト"]',
    'button[aria-label*="website"]',
    'button[aria-label*="text"]'
  ],
  sourceModeTextHints: {
    text: ['コピーしたテキスト', '貼り付けテキスト', 'paste text', 'pasted text', 'text'],
    url: ['ウェブサイト', 'website', 'url', 'link', 'リンク'],
    file: ['ファイル', 'file', 'upload']
  },
  webSearchInputHints: ['ウェブで新しいソースを検索', 'search web', 'web search'],

  sourceInputFields: [
    'textarea',
    '[contenteditable="true"]',
    'input[type="text"]',
    'input[type="url"]',
    'input[placeholder*="http"]',
    'input[placeholder*="URL"]'
  ],
  submitSourceButtons: [
    'button[data-testid*="create"]',
    'button[data-testid*="add"]',
    '[class*="submit"] button',
    'button[type="submit"]'
  ],
  submitSourceTextHints: ['create source', 'add source', 'create', 'add', 'save', '作成', '追加', '保存'],

  openSourceListButtons: [
    'button[data-testid*="sources"]',
    'button[aria-label*="Sources"]',
    'button[aria-label*="ソース"]',
    '[role="tab"][aria-label*="Sources"]',
    '[role="tab"][aria-label*="ソース"]'
  ],
  openSourceListTextHints: ['sources', 'source list', 'ソース'],

  sourceCards: [
    '[data-testid*="source-item"]',
    '[data-source-id]',
    '[class*="source-item"]',
    '[class*="sourceCard"]',
    'li[role="listitem"]',
    'div[role="listitem"]'
  ],
  sourceTitle: ['h2', 'h3', '[data-testid*="title"]', '[class*="title"]', '[aria-label*="title"]', 'strong'],
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
