# Edo Tensei – AI セッション引き継ぎマネージャー

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)

[繁體中文](README.zh-TW.md) | [English](../README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | 日本語

![Edo Tensei – AI セッション引き継ぎマネージャー](assets/hero_banner.png)

---

## Edo Tenseiとは？

AIの使用枠がタスクの途中で切れても、別のIDEに切り替えることでコンテキストを失う必要はありません。

**Edo Tensei**（穢土転生）は、マシンにインストールされたIDEからローカルのAIセッション履歴を抽出し、すぐに貼り付けられる引き継ぎプロンプトにパッケージ化します — 次のエージェントが前のエージェントの止まったところから正確に続けられるように。

![ワークフロー](./assets/workflow_guide.png)

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
| Windsurf | `~/.codeium/windsurf/cascade/` | バイナリ形式（パスモードのみ） |
| Antigravity | `~/.gemini/antigravity/brain/` | プレビューログのみ — 既知の制限を参照 |

---

## 主な機能

- **マルチIDE抽出**：対応するすべてのIDEを自動スキャンし、`IDE → プロジェクト → セッション`の形式で表示します。
- **プロジェクトスコープスキャン**：「プロジェクトセッションをスキャン」で現在のワークスペースに一致するセッションのみを表示します。
- **2つの引き継ぎモード**：
  - **パスモード**（デフォルト）：セッションファイルのパス + IDE別の読み取りガイドを出力。トークン効率が高く、受け取るエージェントは必要な部分だけ読みます。
  - **全文モード**：会話全体を埋め込みます。どこでも使えますが、トークン消費が増えます。
- **ワンクリック転生**：フォーマットされた引き継ぎプロンプトをクリップボードにコピー — 新しいAIチャットに貼り付けるだけでコンテキストを即座に復元。
- **`.edo_tensei/`へのエクスポート**：引き継ぎプロンプトを`IDE/プロジェクト/タイムスタンプ`で整理されたMarkdownファイルとして保存。
- **生ファイルプレビュー**：元のセッションファイルをVS Codeで直接開いて閲覧・編集できます。
- **`.gitignore`ヘルパー**：初回使用時に`.edo_tensei/`を`.gitignore`に追加するよう自動的に案内します。

![機能一覧](./assets/features.png)

---

## クイックスタート

1. VS CodeのアクティビティバーにあるEdo Tenseiビュー（アーカイブアイコン）を開きます。
2. **プロジェクトセッションをスキャン**をクリックして現在のワークスペースに一致するセッションを検索するか、**すべての履歴セッションを取得**で全体スキャンを行います。
3. ツリービューでIDEごとにセッションを閲覧します。
4. セッションを右クリックして**引き継ぎプロンプトをコピー**を選択します。
5. 新しいIDE / AIエージェントに貼り付けて続行します。

![UI概要](./assets/ui_sidebar_overview.png)

---

## 設定

VS Codeの設定で`edoTensei`を検索します。

| 設定 | オプション | デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `edoTensei.handoffMode` | `path` / `fullText` | `path` | トークン効率のため`path`を推奨。 |
| `edoTensei.promptLanguage` | `English` / `Traditional Chinese` | `English` | 生成される引き継ぎプロンプトの言語。 |
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
| Scan Project Sessions | 現在のワークスペースに一致するセッションを検索 |
| Fetch ALL Historical Sessions | すべてのIDEの全ローカルセッションをスキャン |
| Copy Handoff Prompt | 選択したセッションの引き継ぎプロンプトをコピー |
| View Parsed Session | レンダリングされたMarkdownプレビューとしてセッションを開く |
| Preview Raw Session File | 元のセッションファイルを開く |
| Copy Raw File Path | セッションファイルのパスをクリップボードにコピー |
| Export Session to .edo_tensei | 引き継ぎプロンプトをMarkdownファイルとして保存 |
| Export All Sessions to .edo_tensei | スキャンされたすべてのセッションを`.edo_tensei/`に保存 |

---

## プライバシーとローカルファースト

Edo Tenseiは完全に**ローカルファースト**です。すべての抽出と解析はマシン上で実行され、ローカルファイル（SQLite、JSONL、JSON、またはテキスト）を直接読み取ります。外部サーバーへのデータ送信は一切ありません。

`.edo_tensei/`エクスポートフォルダはワークスペース内に作成されます。初回使用時に`.gitignore`への追加を案内します。

---

## 既知の制限

- **macOS / Linux**：未対応。現在はWindowsのみサポートしています。
- **Trae**：未対応。ローカルデータベースがSQLCipher暗号化を使用しており、公開鍵がありません。
- **Windsurf**：セッションファイルがバイナリprotobuf形式で保存されています。Edo Tenseiは**パスモードのみ**にフォールバックします — ファイルパスと読み取りガイドをコピーしますが、会話全体を埋め込むことはできません。
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

## 変更履歴

リリース履歴は[CHANGELOG.md](../CHANGELOG.md)を参照してください。

---

## ライセンス

[MIT](../LICENSE)
