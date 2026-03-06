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
  sourceDialogTextHints: [
    'add source',
    'add sources',
    'ソースを追加',
    '新しいソース',
    'ウェブで新しいソースを検索',
    'またはファイルをドロップ',
    'ファイルをアップロード',
    'コピーしたテキスト',
    'ウェブサイト'
  ],
  sourceModeButtons: [
    'button[data-testid*="source-type"]',
    'button[data-testid*="import-type"]',
    'button[aria-label*="コピーしたテキスト"]',
    'button[aria-label*="ウェブサイト"]',
    'button[aria-label*="website"]',
    'button[aria-label*="text"]'
  ],
  sourceModeTextHints: {
    text: ['コピーしたテキスト', '貼り付けテキスト', 'paste text', 'pasted text', 'copied text'],
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
  chatComposerFields: [
    'textarea',
    'div[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ],
  chatComposerHints: [
    '入力を開始します',
    'start typing',
    'message',
    'chat',
    'ask'
  ],
  chatSendButtons: [
    'button[aria-label*="送信"]',
    'button[aria-label*="Send"]',
    'button[data-testid*="send"]',
    'button[type="submit"]'
  ],
  chatSendTextHints: ['送信', 'send', '送る'],
  assistantMessageContainers: [
    'article',
    '[role="article"]',
    '[data-testid*="message"]',
    '[class*="message"]',
    '[class*="response"]'
  ],
  assistantMessageActionHints: ['メモに保存', 'save to note', 'thumb_up', 'thumb_down', 'copy_all'],
  submitSourceButtons: [
    'button[data-testid*="create"]',
    'button[data-testid*="add"]',
    'button[aria-label*="検索"]',
    'button[aria-label*="Search"]',
    'button[aria-label*="送信"]',
    'button[aria-label*="Submit"]',
    '[class*="submit"] button',
    'button[type="submit"]'
  ],
  submitSourceTextHints: [
    'create source',
    'add source',
    'create',
    'add',
    'save',
    'search',
    'submit',
    'import',
    '作成',
    '追加',
    '保存',
    '挿入',
    '検索',
    '送信',
    '取り込む',
    'insert'
  ],

  openSourceListButtons: [
    'button[data-testid*="sources"]',
    'button[data-testid*="source"]',
    'button[aria-label*="Sources"]',
    'button[aria-label*="ソース"]',
    '[role="tab"][data-testid*="source"]',
    '[role="tab"][aria-label*="Sources"]',
    '[role="tab"][aria-label*="ソース"]'
  ],
  openSourceListTextHints: ['sources', 'source list', 'ソース'],

  sourceCards: [
    '[data-testid*="source-item"]',
    '[data-source-id]',
    '[role="treeitem"]',
    '[class*="source-item"]',
    '[class*="sourceCard"]',
    '[data-testid*="source"]',
    'li[role="listitem"]',
    'div[role="listitem"]'
  ],
  sourceTitle: ['h2', 'h3', '[data-testid*="title"]', '[class*="title"]', '[aria-label*="title"]', 'strong', '[role="heading"]', 'a'],
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
  sourceActionMenuButtons: [
    'button[aria-label*="More"]',
    'button[aria-label*="more"]',
    'button[aria-label*="その他"]',
    'button[aria-label*="メニュー"]',
    'button[data-testid*="more"]',
    'button[data-testid*="menu"]',
    'button[class*="more"]',
    'button[class*="menu"]'
  ],
  sourceActionMenuTextHints: ['more', 'menu', 'その他', 'メニュー', 'options', 'オプション'],
  menuContainers: [
    '[role="menu"]',
    '[role="listbox"]',
    '[data-testid*="menu"]',
    '[class*="menu"]',
    '[class*="popover"]'
  ],
  menuDeleteTextHints: ['delete', 'remove', '削除', 'ソースを削除', 'delete source'],
  confirmDialogContainers: ['[role="dialog"]', '[aria-modal="true"]'],
  confirmDialogTextHints: ['削除', 'delete', '本当に', 'are you sure', 'confirm'],

  confirmButtons: [
    'button[data-testid*="confirm"]',
    'button[data-testid*="delete-confirm"]',
    '[class*="confirm"] button',
    'button[data-testid*="delete"]',
    'button[aria-label*="Delete"]',
    'button[aria-label*="削除"]'
  ],
  confirmTextHints: ['delete', 'confirm', 'yes', '削除', '確認', '実行']
};
