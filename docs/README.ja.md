# Edo Tensei – AI セッション引き継ぎマネージャー

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Open VSX Version](https://img.shields.io/open-vsx/v/Pain-Labs/edo-tensei)](https://open-vsx.org/extension/Pain-Labs/edo-tensei)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/Pain-Labs/edo-tensei)](https://open-vsx.org/extension/Pain-Labs/edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)
<!-- [![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) -->
<!-- [![VS Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) -->

[繁體中文](README.zh-TW.md) | [English](../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | 日本語

![Edo Tensei – AI セッション引き継ぎマネージャー](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/hero_banner.png)

---

## Edo Tenseiとは？

AIの使用枠がタスクの途中で切れても、別のIDEに切り替えることでコンテキストを失う必要はありません。

**Edo Tensei**（穢土転生）は、マシンにインストールされたIDEからローカルのAIセッション履歴を抽出し、すぐに貼り付けられる引き継ぎプロンプトにパッケージ化します — 次のエージェントが前のエージェントの止まったところから正確に続けられるように。

### 名前の由来とロジック

漫画『NARUTO -ナルト-』において、**穢土転生**（えどてんせい）とは、死者の魂を現世に呼び戻し、器となる生体に縛り付けることで、生前の記憶と能力を再現する禁術です。

本ツールはこのコンセプトから名付けられ、AI開発における「コンテキストの輪廻転生」を象徴しています：

- **死者 (The Deceased)**：クォータ制限、IDEのクラッシュ、ツールの切り替えなどによって「中断」された古いセッション。
- **器/媒介 (The Vessel)**：本ツールが抽出・パッケージ化した **引き継ぎプロンプト (Handoff Prompt)**。
- **転生 (The Reincarnation)**：プロンプトを新しいIDEに貼り付けることで、本来「死んだ」はずの開発コンテキストを新しいAI実体として完璧に蘇らせます。

![ワークフロー](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/workflow_guide.png)

---

> **プラットフォーム**：Windowsのみ対応。macOSおよびLinuxは未対応です。

## 対応IDE

| IDE / エージェント | ローカル保存先 | 備考 |
| :--- | :--- | :--- |
| GitHub Copilot Chat | `%APPDATA%/Code/User/…/chatSessions/` | JSON & JSONL |
| Cursor | `~/.cursor/projects/` | JSONL |
| Claude Code CLI | `~/.claude/projects/` | JSONL |
| OpenAI Codex CLI | `~/.codex/` | JSONL |
| Kiro | `%APPDATA%/Kiro/…/kiroagent/` | JSON (`.chat`) |
| Antigravity | `~/.gemini/antigravity/brain/` | プレビューログのみ — 既知の制限を参照 |

---

## 主な機能

- **IDEごとのオンデマンドスキャン**：サイドバーでIDEを展開したとき、そのIDEだけをスキャンします。起動時の大量ディスクI/Oを避けつつ、ツールバーの ⚡ **Scan All IDEs** ですべてを一括スキャンできます。
- **ページネーション**：各IDEは最初に最大300件のセッションを表示します。追加の履歴がある場合は下部に **Load More** が表示され、大量の履歴でもツリーを軽快に保ちます。
- **2つの引き継ぎモード**：
  - **パスモード**（デフォルト）：セッションファイルのパス + IDE別の読み取りガイドを出力。トークン効率が高く、受け取るエージェントは必要な部分だけ読みます。
  - **全文モード**：会話全体を埋め込みます。どこでも使えますが、トークン消費が増えます。
- **ワンクリック転生**：フォーマットされた引き継ぎプロンプトをクリップボードにコピー — 新しいAIチャットに貼り付けるだけでコンテキストを即座に復元。
- **`.edo_tensei/`へのエクスポート**：引き継ぎプロンプトを`IDE/プロジェクト/タイムスタンプ`で整理されたMarkdownファイルとして保存。
- **生ファイルプレビュー**：元のセッションファイルをVS Codeで直接開いて閲覧・編集できます。
- **Agent Skill Generator**：Claude Code、GitHub Copilot、Kiro、Antigravity、Cline、Gemini CLI、Cursor 向けに再利用可能な `edo-tensei` skill/rule ファイルを生成します。
- **Model Context Protocol (MCP)**：内蔵のMCPサーバーにより、AIエージェント（Cursor、Copilot、Claude、Kiro、Antigravity）がプログラムを通じてEdo Tenseiのセッションを検索、読み取り、エクスポートできるようになります。"Show MCP Config" UIを使用すれば、特定のAI向けの構成を簡単に生成できます。
- **`.gitignore`ヘルパー**：初回使用時に`.edo_tensei/`を`.gitignore`に追加するよう自動的に案内します。

![機能一覧](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/features.png)

---

## クイックスタート

![Edo Tensei product demo](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/edo-tensei-product-demo.gif)

1. VS CodeのアクティビティバーにあるEdo Tenseiビュー（ひび割れたフォルダーアイコン）を開きます。
2. **IDEを展開** すると、初回展開時にそのIDEだけをスキャンします。ツールバーの ⚡ **Scan All IDEs** ですべてのIDEを一括スキャンすることもできます。
3. そのIDEにさらにセッションがある場合は、下部の **Load More** で次のページを読み込みます。
4. **セッションを直接クリック** すると、引き継ぎ用プロンプトが即座にクリップボードにコピーされます。
5. (オプション) セッションを右クリックすると、エクスポートやプレビューなどの **詳細機能** (Advanced) を使用できます。IDE行の **Export All** ボタンで、そのIDEの全セッションをエクスポートできます。
6. 新しい IDE / AI エージェントにプロンプトを **貼り付けて**、作業を続行します。

---

## 設定

VS Codeの設定で`edoTensei`を検索します。

| 設定 | オプション | デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `edoTensei.handoffMode` | `path` / `fullText` | `path` | トークン効率のため`path`を推奨。 |
| `edoTensei.promptLanguage` | `English` / `Traditional Chinese` / `Simplified Chinese` / `Japanese` / `Korean` | `English` | 生成される引き継ぎプロンプトの言語。 |
| `edoTensei.customScanPaths` | オブジェクト `{ "claude": [], … }` | `{}` | 各IDEのデフォルトスキャンディレクトリを上書きします。 |

### カスタムスキャンパスの例

```json
{
  "edoTensei.customScanPaths": {
    "claude": ["D:/custom-claude-projects"],
    "copilot": ["E:/another-vscode-profile/chatSessions"]
  }
}
```

---

## コマンド

すべてのコマンドはコマンドパレット（`Ctrl+Shift+P`）の`Edo Tensei`カテゴリから使用できます。

| コマンド | 説明 |
| :--- | :--- |
| Scan All IDEs | すべてのIDEの全ローカルセッションをスキャン（ツールバー ⚡ ボタン） |
| Refresh This IDE | 単一のIDEを再スキャン（IDE行のinlineボタン） |
| Load More Sessions | そのIDEの次ページを読み込む |
| Copy Handoff Prompt | 選択したセッションの引き継ぎプロンプトをコピー |
| View Parsed Session | レンダリングされたMarkdownプレビューとしてセッションを開く |
| Preview Raw Session File | 元のセッションファイルを開く |
| Copy Raw File Path | セッションファイルのパスをクリップボードにコピー |
| Export Session to .edo_tensei | 引き継ぎプロンプトをMarkdownファイルとして保存 |
| Export All Sessions to .edo_tensei | 指定したIDEの全セッションを`.edo_tensei/`に保存（IDE行のinlineボタン） |
| Generate Agent Skill | 他の AI ツール向けに再利用可能な `edo-tensei` skill/rule ファイルを生成 |
| Show MCP Config | UIパネルを開き、お使いのAIエージェントにコピー＆ペーストできるMCPサーバー構成を取得 |

---

## Model Context Protocol (MCP) Server

Edo Tenseiには[Model Context Protocol](https://modelcontextprotocol.io/)サーバーが組み込まれており、AIエージェントがチャットインターフェースから離れることなくセッション履歴と直接やり取りできるようになります。

AIエージェントは手動でエクスポートしたりプロンプトをコピーしたりすることなく、過去のセッションを自動的に見つけ、完全な会話コンテキストを読み取り、中断したワークフローを再開することができます。

MCPサーバーのセットアップ：

1. **Edo Tensei: Show MCP Config** コマンドを実行します。
2. AIクライアント（Cursor、GitHub Copilot、Claude Code、Kiro、またはAntigravity）を選択します。
3. ワークスペースの構成設定（Recommended、Selected、Variable、またはAll Workspaces）を選択します。
4. 生成されたJSONスニペットをAIクライアントのMCP構成ファイルにコピーします。

詳細については、[MCP Server README](../mcp-server/README.md)を参照してください。

---

## Agent Skills

**Generate Agent Skill** を使うと、他の AI ツール向けに再利用可能な `edo-tensei` skill または rule を作成できます。生成される内容は単なるメモではなく、引き継ぎ先のエージェントに対して、候補となる session ファイルの探し方、最近で関連性の高い部分だけを読む方法、確信が低いときに停止する基準、そしてクリーンな引き継ぎサマリーの返し方まで示す構造化 SOP です。

生成先：

- Claude Code: `.claude/skills/edo-tensei/SKILL.md`
- GitHub Copilot: `.github/skills/edo-tensei/SKILL.md`
- Kiro IDE: `.kiro/skills/edo-tensei/SKILL.md`
- Antigravity: `.agents/skills/edo-tensei/SKILL.md`
- Cline: `.cline/skills/edo-tensei/SKILL.md`
- Gemini CLI: `.gemini/skills/edo-tensei/SKILL.md`
- Cursor: `.cursor/rules/edo-tensei.mdc`

注意:

- Cursor は slash-command skill ではなく rule ファイルを使用します。
- workspace に `edo-tensei` skill/rule がある場合でも、引き継ぎプロンプトには手動ファイル読み取り用の fallback が含まれるため、混在したツールチェーンでも利用できます。

---

## プライバシーとローカルファースト

Edo Tenseiは完全に**ローカルファースト**です。すべての抽出と解析はマシン上で実行され、ローカルファイル（SQLite、JSONL、JSON、またはテキスト）を直接読み取ります。外部サーバーへのデータ送信は一切ありません。

`.edo_tensei/`エクスポートフォルダはワークスペース内に作成されます。初回使用時に`.gitignore`への追加を案内します。

---

## 既知の制限

- **macOS / Linux**：未対応。現在はWindowsのみサポートしています。
- **Trae**：未対応。ローカルデータベースがSQLCipher暗号化を使用しており、公開鍵がありません。
- **Windsurf**：セッションファイルはバイナリ protobuf 形式です。以前のパスのみ fallback は現在無効化されているため、信頼できるパーサーが用意されるまで Windsurf の session はスキャン結果に表示されません。
- **Antigravity**：`overview.txt`（プレビューログ）から抽出し、各メッセージは約900文字で切り捨てられます。完全な会話履歴はAntigravityのクラウドにのみ保存され、ローカルではアクセスできません。

---

## おすすめの連携ツール

### Quick Prompt

AIエージェントが作業を実行している間、ウィンドウを切り替えずに次のタスクや再利用可能なスニペットをキャプチャ。

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/quick-prompt)

### VirtualTabs

任意のディレクトリにまたがってタスクごとにファイルを整理し、セッションをまたいで永続化。

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/virtual-tabs)

---

## バグ報告

バグを見つけましたか？[Issue を開いて](https://github.com/Pain-Labs/Edo-Tensei/issues)以下の情報を含めてください：

- OS のバージョン（例：Windows 11 22H2）
- 使用していた IDE と抽出しようとしたセッション
- 再現手順

---

## コントリビューション歓迎

あらゆる形での貢献を歓迎します！[Pull Request](https://github.com/Pain-Labs/Edo-Tensei/pulls) を直接開くか、[Issues](https://github.com/Pain-Labs/Edo-Tensei/issues) でディスカッションを始めてください。

特に以下の分野でのご協力をお待ちしています：

- **新しい IDE エクストラクター** — 特に macOS / Linux パスのサポート
- **Windsurf / Trae** — セッション形式に詳しい方
- **翻訳** — ローカライズされた README の改善や追加

---

## 変更履歴

リリース履歴は[CHANGELOG.md](../CHANGELOG.md)を参照してください。

---

## ライセンス

[MIT](../LICENSE)
