# NotebookLM Assistant MVP (Chrome Extension)

NotebookLM利用時のソース追加・整理・統合・バックアップ・一括削除を支援する、Manifest V3ベースのChrome拡張です。  
**NotebookLM公式APIなし**を前提に、`content script + DOM操作 + ユーザー操作補助`で実装しています。

## 概要
- NotebookLM画面上に「クイック追加」「整理/統合」ボタンを常駐表示
- テキスト/URL/クリップボード画像(代替運用)の追加をワンステップ化
- ソース複数選択 → Markdown統合案生成（単純連結 / 構造化）
- 削除・統合前にMarkdownバックアップを必須化
- バックアップ済み対象に対してのみ一括削除を許可

## できること
1. NotebookLM画面上でクイック追加UIを開く（警告文の上に横並び表示）
2. `Ctrl+Shift+S` (Mac: `Command+Shift+S`) でクイック追加を開く
3. クイック追加ワンステップ実行
   - 単一入力欄へテキスト/URL/画像を貼り付けて実行
   - 種別は自動判定（URL/テキスト/画像）
4. URL追加
   - 右クリックリンクURL（コンテキストメニュー経由）
   - 入力欄へ手入力URL
5. クリップボード画像対応（MVP代替）
   - 画像プレビュー
   - 画像をローカル（Downloads）へバックアップ保存
   - 画像メタ情報をテキストソースとしてNotebookLMへ追加
6. ソース一覧抽出・選択
7. マージ
   - 単純連結
   - 構造化テンプレート
8. バックアップMarkdown出力
   - `notebooklm_backup_YYYYMMDD_HHMM.md`
   - `notebooklm_merge_backup_YYYYMMDD_HHMM.md`
9. 一括削除（選択 / 全表示）
   - 削除前に明示確認 (`DELETE` 入力)
   - Dry-run対応
   - 成功/失敗/スキップ件数表示

## できないこと / 制約
1. NotebookLMのUI変更でDOMセレクタが壊れる可能性があります。
2. ソース本文抽出は「画面上で取得できるDOM」に依存します。
   - 仮想スクロール等で未描画データは抽出できない場合があります。
3. 画像のNotebookLMへのネイティブアップロードは保証できません（公式API未使用のため）。
4. Google Docsへの自動保存はMVP未実装です（Markdownバックアップを優先）。
5. 自動追加はNotebookLM側のソース追加ダイアログが見つからないと失敗し、フォールバック（クリップボードコピー）になります。

## 代替案（MVP内）
1. 画像追加が難しい場合
   - 画像をローカルバックアップ保存し、NotebookLMには画像メタ情報をテキスト追加
2. 自動追加が失敗した場合
   - 生成本文をクリップボードへ自動コピー
3. 本文抽出が不完全な場合
   - まず表示中ソースをバックアップし、必要分を手動で展開して再取得

## セットアップ手順
1. 依存インストール
```bash
npm install
```
2. ビルド
```bash
npm run build
```
3. （任意）型チェック
```bash
npm run typecheck
```

## Chromeへの読み込み手順
1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」
4. このプロジェクトルート（`manifest.json` があるディレクトリ）を選択
5. NotebookLM (`https://notebooklm.google.com/...`) を開く

## 権限説明
- `storage`: 設定保存（テンプレート、ログON/OFF等）
- `downloads`: Markdown/画像バックアップ保存
- `tabs` + `activeTab`: アクティブタブへのメッセージ送信
- `contextMenus`: 右クリックリンクURL追加
- `clipboardRead`: クリップボード画像読み取り
- `host_permissions (notebooklm.google.com)`: NotebookLMページでのcontent script実行

## 使い方
### 1. クイック追加
1. NotebookLM画面の「クイック追加」ボタンを押す（またはショートカット）
2. 同一入力欄へテキスト/URL/画像（Ctrl+V）を貼り付け
3. 必要ならタイトル・補足メモを入力
4. 実行

### 2. 整理・統合
1. 「整理/統合」ボタンを押す
2. 「ソース再取得」で一覧を読み込む
3. 対象をチェック
4. マージ方式を選択して「統合プレビュー生成」
5. 「統合ソースを追加（事前バックアップ付き）」を実行

### 3. バックアップ・削除
1. 「選択ソースをバックアップ」を実行
2. 削除対象（チェックのみ / 全表示）を選択
3. 必要ならDry-runをON
4. 「一括削除」実行時に `DELETE` を入力して確定

## 設定項目
`オプション` 画面で以下を編集可能です。
- デフォルトショートカット説明
- バックアップ保存先プレフィックス（Downloads配下）
- 構造化マージテンプレート
- 開発ログON/OFF

## 注意点
1. NotebookLMのDOM変更時は `src/selectors/notebooklm.ts` を優先調整してください。
2. 開発時は「開発ログON」にしてコンソール確認してください。
3. 削除前に必ずバックアップを取得し、ファイルの内容を確認してください。
4. 企業端末・管理ポリシー環境ではClipboard/Downloads権限が制限される場合があります。

## 今後の拡張案
1. Google Docs自動連携（OAuth + Drive/Docs API）
2. OCR統合（オフライン/クラウド切替）
3. AI要約・重複除去パイプラインのプラガブル化
4. ソース自動タグ付け（ルールベース/埋め込み）
5. Slack/Webページからの直接送信
6. 右クリックメニュー拡張（選択テキスト送信、画像送信）

## ディレクトリ構成
```text
.
├─ src/
│  ├─ background/
│  ├─ content/
│  ├─ popup/
│  ├─ options/
│  ├─ lib/
│  ├─ selectors/
│  ├─ backup/
│  ├─ merge/
│  ├─ utils/
│  └─ types/
├─ public/
├─ docs/
├─ scripts/
├─ manifest.json
├─ package.json
└─ README.md
```
