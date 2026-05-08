import * as vscode from 'vscode';
import * as path from 'path';

type ClientKey = 'cursor' | 'claudeDesktop' | 'copilot' | 'kiro' | 'antigravity';

type ConfigMode = 'variable' | 'absolute';

interface WorkspaceOption {
    id: string;
    name: string;
    fsPath: string;
}

interface ClientOption {
    key: ClientKey;
    name: string;
    description: string;
  instruction: string;
  supportsVariableWorkspaceFolder: boolean;
  recommendedMode: ConfigMode;
}

export class McpConfigPanel {
    public static currentPanel: McpConfigPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.context = context;

        this.update().catch(() => {
            // Best-effort UI; ignore.
        });

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static async show(context: vscode.ExtensionContext): Promise<void> {
        if (McpConfigPanel.currentPanel) {
            McpConfigPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'edoTenseiMcpConfig',
            'Edo Tensei MCP Config',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [context.extensionUri, context.globalStorageUri],
            }
        );

        McpConfigPanel.currentPanel = new McpConfigPanel(panel, context);
    }

    public dispose(): void {
        McpConfigPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length > 0) {
            this.disposables.pop()?.dispose();
        }
    }

    private getBundledMcpServerPath(): string {
        return path.join(this.context.extensionUri.fsPath, 'dist', 'mcp', 'index.js');
    }

    private async ensureStableMcpServerPath(): Promise<string | undefined> {
        const bundled = vscode.Uri.file(this.getBundledMcpServerPath());

        try {
            await vscode.workspace.fs.stat(bundled);
        } catch {
            return undefined;
        }

        const stable = vscode.Uri.joinPath(this.context.globalStorageUri, 'mcp', 'index.js');
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, 'mcp'));
            const bytes = await vscode.workspace.fs.readFile(bundled);
            await vscode.workspace.fs.writeFile(stable, bytes);
            return stable.fsPath;
        } catch {
            return undefined;
        }
    }

    private resolveWorkspaceOptions(): { workspaces: WorkspaceOption[]; selectedId?: string } {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        const activeWorkspace = activeEditorUri ? vscode.workspace.getWorkspaceFolder(activeEditorUri) : undefined;
        const fallback = workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
        const selected = activeWorkspace ?? fallback;

        return {
            workspaces: workspaceFolders.map(folder => ({
                id: folder.uri.toString(),
                name: folder.name,
            fsPath: folder.uri.fsPath.replace(/\\/g, '/'),
            })),
            selectedId: selected?.uri.toString(),
        };
    }

    private getClients(): ClientOption[] {
        return [
            {
                key: 'cursor',
                name: 'Cursor',
          description: 'Add to ~/.cursor/mcp.json (or Settings → MCP)',
          instruction: 'Copy the JSON below and paste it into your Cursor MCP configuration.',
          supportsVariableWorkspaceFolder: true,
          recommendedMode: 'variable',
            },
            {
                key: 'copilot',
                name: 'VS Code (GitHub Copilot)',
          description: 'Add to VS Code Settings (JSON): "mcp.servers"',
          instruction: 'Copy the JSON below and add it to VS Code settings (JSON).',
          supportsVariableWorkspaceFolder: false,
          recommendedMode: 'absolute',
            },
            {
                key: 'claudeDesktop',
                name: 'Claude Desktop / Claude Code',
          description: 'Add to Claude MCP servers config file',
          instruction: 'Copy the JSON below and add it to your Claude MCP servers config.',
          supportsVariableWorkspaceFolder: false,
          recommendedMode: 'absolute',
            },
            {
                key: 'kiro',
                name: 'Kiro',
          description: 'Standard MCP config format',
          instruction: 'Copy the JSON below and paste it into your Kiro MCP configuration.',
          supportsVariableWorkspaceFolder: false,
          recommendedMode: 'absolute',
            },
            {
                key: 'antigravity',
                name: 'Antigravity',
          description: 'Standard MCP config format',
          instruction: 'Copy the JSON below and add it to your Antigravity MCP settings.',
          supportsVariableWorkspaceFolder: true,
          recommendedMode: 'variable',
            },
        ];
    }

    private async update(): Promise<void> {
        const bundled = this.getBundledMcpServerPath();
        const stable = await this.ensureStableMcpServerPath();
        const recommendedServerPath = stable ?? bundled;

        const workspaceContext = this.resolveWorkspaceOptions();
        const clients = this.getClients();

        this.panel.webview.html = this.getHtml({
          bundledServerPath: bundled,
          stableServerPath: stable,
          recommendedServerPath,
          workspaces: workspaceContext.workspaces,
          selectedWorkspaceId: workspaceContext.selectedId,
          clients,
          labels: {
            recommended: 'Recommended Config',
            selected: 'Config for Selected Workspace',
            variable: 'Dynamic Variable Config',
            all: 'Config for All Workspaces',
          },
          copyButtons: {
            recommended: 'Copy Recommended',
            selected: 'Copy Selected Workspace Config',
            variable: 'Copy Dynamic Config',
            all: 'Copy All Workspaces Config',
          },
          supportVariable: 'This client supports dynamic ${workspaceFolder}.',
          supportAbsolute: 'This client requires absolute workspace paths.',
          copied: 'Copied!',
          tools: [
            { key: 'scan_all_sessions', description: 'Scan all IDE sessions' },
            { key: 'scan_project_sessions', description: 'Scan sessions for a specific workspace' },
            { key: 'list_ide_sources', description: 'List supported IDE sources' },
            { key: 'get_session', description: 'Get session metadata' },
            { key: 'get_session_messages', description: 'Get full conversation messages' },
            { key: 'generate_handoff_prompt', description: 'Generate handoff prompt (path/fullText)' },
            { key: 'export_session', description: 'Export session to .edo_tensei/' },
            { key: 'get_mcp_config', description: 'Get client-specific config' },
          ],
        });

        this.panel.webview.onDidReceiveMessage(
            async (message: any) => {
                if (message?.command === 'copyToClipboard' && typeof message.text === 'string') {
                    await vscode.env.clipboard.writeText(message.text);
                    return;
                }
            },
            null,
            this.disposables
        );
    }

    private getHtml(data: {
        bundledServerPath: string;
        stableServerPath?: string;
        recommendedServerPath: string;
        workspaces: WorkspaceOption[];
        selectedWorkspaceId?: string;
        clients: ClientOption[];
      labels: Record<'recommended' | 'selected' | 'variable' | 'all', string>;
      copyButtons: Record<'recommended' | 'selected' | 'variable' | 'all', string>;
      supportVariable: string;
      supportAbsolute: string;
      copied: string;
        tools: Array<{ key: string; description: string }>;
    }): string {
        const esc = (s: string) => s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const workspacesOptions = data.workspaces.length > 0
          ? data.workspaces.map(w => {
            const selected = w.id === data.selectedWorkspaceId ? 'selected' : '';
            return `<option value="${esc(w.id)}" ${selected}>${esc(w.name)}</option>`;
          }).join('')
          : `<option value="__none__">No workspace opened</option>`;

        const ideTabsHtml = data.clients.map((c, idx) => {
          const active = idx === 0 ? ' active' : '';
          return `<button class="ide-tab${active}" data-client-key="${esc(c.key)}" type="button">${esc(c.name)}</button>`;
        }).join('');

        const toolList = data.tools.map(t => `<li><code>${esc(t.key)}</code> — ${esc(t.description)}</li>`).join('');

        const webviewData = JSON.stringify({
            serverPath: data.recommendedServerPath,
            stableServerPath: data.stableServerPath,
            bundledServerPath: data.bundledServerPath,
            clients: data.clients,
            workspaces: data.workspaces,
            selectedWorkspaceId: data.selectedWorkspaceId,
            labels: data.labels,
            copyButtons: data.copyButtons,
        }).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Edo Tensei MCP Config</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.6;
    }
    .container { max-width: 920px; margin: 0 auto; }
    h1, h2, h3 { color: var(--vscode-editor-foreground); }
    h1 { margin: 0 0 12px; font-size: 18px; }
    h2 {
      margin-top: 28px;
      color: var(--vscode-textPreformat-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 8px;
      font-size: 14px;
    }
    h3 { margin: 0 0 8px; font-size: 13px; }
    p { margin: 4px 0; }

    .step-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 16px;
      background: var(--vscode-editor-background);
    }
    .step-title {
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .workspace-select {
      width: 100%;
      margin-top: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      font: inherit;
    }
    .workspace-meta { margin-top: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .workspace-path {
      margin-top: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      word-break: break-all;
    }

    .ide-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .ide-tab, .option-tab {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      font-size: 12px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .ide-tab.active, .option-tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .ide-tab:focus-visible, .option-tab:focus-visible, .copy-btn:focus-visible, .workspace-select:focus-visible {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .tool-description, .tool-support { color: var(--vscode-descriptionForeground); margin: 4px 0; font-size: 13px; }
    .tool-instruction { margin: 8px 0; font-size: 13px; }
    .option-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }

    .code-block {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 16px;
      border-radius: 6px;
      position: relative;
      margin: 12px 0 0;
      overflow-x: auto;
      border: 1px solid var(--vscode-panel-border);
    }
    .config-title { margin: 0 0 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    pre { margin: 0; white-space: pre; font-size: 13px; }
    code { font-family: var(--vscode-editor-font-family, monospace); }
    .code-actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
    .copy-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 7px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .copy-btn:hover { background: var(--vscode-button-hoverBackground); }
    .copy-btn.secondary {
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
    }
    .copy-btn:disabled { cursor: not-allowed; opacity: 0.55; }

    ul { margin: 8px 0 0 18px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Edo Tensei MCP Config</h1>
    <p class="tool-description">Pick a workspace + client, then copy the generated JSON.</p>

    <h2>Configuration</h2>

    <div class="step-card">
      <p class="step-title">1. Workspace</p>
      <label for="workspace-select">Workspace folder</label>
      <select id="workspace-select" class="workspace-select">${workspacesOptions}</select>
      <p id="workspace-meta" class="workspace-meta"></p>
      <p id="workspace-path" class="workspace-path"></p>
    </div>

    <div class="step-card">
      <p class="step-title">2. Client</p>
      <div id="ide-tabs" class="ide-tabs">${ideTabsHtml}</div>
      <h3 id="tool-name"></h3>
      <p id="tool-description" class="tool-description"></p>
      <p id="tool-instruction" class="tool-instruction"></p>
      <p id="tool-support" class="tool-support"></p>
    </div>

    <div class="step-card">
      <p class="step-title">3. Configuration Mode</p>
      <div id="option-tabs" class="option-tabs"></div>
    </div>

    <div class="step-card">
      <p class="step-title">4. Copy JSON</p>
      <div class="code-block">
        <p id="config-title" class="config-title"></p>
        <pre><code id="active-config"></code></pre>
        <div class="code-actions">
          <button id="copy-active" class="copy-btn" type="button"></button>
          <button id="copy-server-path" class="copy-btn secondary" type="button">Copy server path</button>
        </div>
        <p id="path-note" class="tool-support" style="margin-top:10px;"></p>
      </div>
    </div>

    <h2>Available tools</h2>
    <ul>${toolList}</ul>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const model = ${webviewData};

    const EMPTY_WORKSPACE = '/path/to/your/workspace';
    const hasWorkspace = (model.workspaces || []).length > 0;
    const state = {
      activeClientKey: (model.clients && model.clients[0] && model.clients[0].key) ? model.clients[0].key : 'cursor',
      activeOption: 'recommended'
    };

    function getClient(key) {
      return (model.clients || []).find(c => c.key === key);
    }

    function getSelectedWorkspace() {
      const select = document.getElementById('workspace-select');
      const selected = (model.workspaces || []).find(w => w.id === select.value);
      return selected || model.workspaces[0] || { id: '__none__', name: 'workspace', fsPath: EMPTY_WORKSPACE };
    }

    function sanitizeServerName(name) {
      const normalized = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return normalized || 'workspace';
    }

    function createArgs(workspaceRoot) {
      const args = [model.serverPath];
      if (workspaceRoot) {
        args.push('--workspace-root');
        args.push(workspaceRoot);
      }
      return args;
    }

    function createServerEntry(workspaceRoot) {
      return { command: 'node', args: createArgs(workspaceRoot) };
    }

    function buildConfigObject(clientKey, serversObj) {
      if (clientKey === 'copilot') {
        // VS Code settings format
        const mcp = {};
        for (const [name, entry] of Object.entries(serversObj)) {
          mcp[name] = { ...entry, type: 'stdio' };
        }
        return { 'mcp.servers': mcp };
      }
      return { mcpServers: serversObj };
    }

    function buildJson(clientKey, serversObj) {
      return JSON.stringify(buildConfigObject(clientKey, serversObj), null, 2);
    }

    function buildAbsoluteConfig(clientKey, workspacePath) {
      return buildJson(clientKey, { 'edo-tensei': createServerEntry(workspacePath) });
    }

    function buildVariableConfig(clientKey) {
      return buildJson(clientKey, { 'edo-tensei': createServerEntry('\${workspaceFolder}') });
    }

    function buildAllWorkspacesConfig(clientKey) {
      const used = {};
      const servers = {};
      for (const ws of (model.workspaces || [])) {
        const baseName = 'edo-tensei-' + sanitizeServerName(ws.name);
        let name = baseName;
        let idx = 2;
        while (used[name]) {
          name = baseName + '-' + idx;
          idx += 1;
        }
        used[name] = true;
        servers[name] = createServerEntry(ws.fsPath);
      }
      return buildJson(clientKey, servers);
    }

    function getOptionList(client) {
      const options = ['recommended', 'selected'];
      if (client.supportsVariableWorkspaceFolder) {
        options.push('variable');
      } else if ((model.workspaces || []).length > 1) {
        options.push('all');
      }
      return options;
    }

    function requiresWorkspace(client, option) {
      if (option === 'selected' || option === 'all') return true;
      return option === 'recommended' && client.recommendedMode === 'absolute';
    }

    function getOptionConfig(client, option, workspacePath) {
      const clientKey = client.key;
      if (option === 'recommended') {
        if (client.recommendedMode === 'variable' && client.supportsVariableWorkspaceFolder) {
          return buildVariableConfig(clientKey);
        }
        return buildAbsoluteConfig(clientKey, workspacePath);
      }
      if (option === 'selected') return buildAbsoluteConfig(clientKey, workspacePath);
      if (option === 'variable') return buildVariableConfig(clientKey);
      if (option === 'all') return buildAllWorkspacesConfig(clientKey);
      return '';
    }

    function setText(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function renderIdeTabs() {
      for (const tab of document.querySelectorAll('.ide-tab')) {
        tab.classList.toggle('active', tab.dataset.clientKey === state.activeClientKey);
      }
    }

    function renderOptionTabs(client) {
      const options = getOptionList(client);
      if (!options.includes(state.activeOption)) {
        state.activeOption = 'recommended';
      }
      const host = document.getElementById('option-tabs');
      host.innerHTML = options.map(opt => {
        const active = opt === state.activeOption ? ' active' : '';
        return '<button class="option-tab' + active + '" data-option="' + opt + '" type="button">' + model.labels[opt] + '</button>';
      }).join('');
    }

    function renderWorkspaceMeta() {
      const meta = document.getElementById('workspace-meta');
      if (!meta) return;
      meta.textContent = hasWorkspace ? ('Found ' + model.workspaces.length + ' workspace(s)') : 'No workspace opened';
    }

    function renderWorkspacePath() {
      const pathNode = document.getElementById('workspace-path');
      if (!pathNode) return;
      const ws = getSelectedWorkspace();
      pathNode.textContent = hasWorkspace ? ('Resolved path: ' + ws.fsPath) : ('Resolved path: ' + EMPTY_WORKSPACE);
    }

    function renderClientMeta(client) {
      setText('tool-name', client.name);
      setText('tool-description', client.description);
      setText('tool-instruction', client.instruction);
      setText('tool-support', client.supportsVariableWorkspaceFolder ? ${JSON.stringify(data.supportVariable)} : ${JSON.stringify(data.supportAbsolute)});
    }

    function renderActiveConfig() {
      const client = getClient(state.activeClientKey);
      if (!client) return;
      const ws = getSelectedWorkspace();
      const config = getOptionConfig(client, state.activeOption, ws.fsPath);

      setText('config-title', model.labels[state.activeOption]);
      setText('active-config', config);

      const copyBtn = document.getElementById('copy-active');
      copyBtn.textContent = model.copyButtons[state.activeOption];
      copyBtn.disabled = requiresWorkspace(client, state.activeOption) && !hasWorkspace;

      const usingStable = !!model.stableServerPath;
      setText('path-note', usingStable
        ? 'Using stable path under VS Code global storage (recommended).'
        : 'Using bundled extension path (may change after extension update).');
    }

    function renderAll() {
      const client = getClient(state.activeClientKey);
      if (!client) return;
      renderIdeTabs();
      renderWorkspaceMeta();
      renderWorkspacePath();
      renderClientMeta(client);
      renderOptionTabs(client);
      renderActiveConfig();
    }

    function copyText(text, btn) {
      if (btn.disabled) return;
      vscode.postMessage({ command: 'copyToClipboard', text });
      const original = btn.innerText;
      btn.innerText = ${JSON.stringify(data.copied)};
      setTimeout(() => { btn.innerText = original; }, 1200);
    }

    document.getElementById('ide-tabs').addEventListener('click', (event) => {
      const target = event.target;
      if (!target || !target.classList.contains('ide-tab')) return;
      state.activeClientKey = target.dataset.clientKey;
      state.activeOption = 'recommended';
      renderAll();
    });

    document.getElementById('option-tabs').addEventListener('click', (event) => {
      const target = event.target;
      if (!target || !target.classList.contains('option-tab')) return;
      state.activeOption = target.dataset.option;
      renderAll();
    });

    document.getElementById('copy-active').addEventListener('click', (event) => {
      const btn = event.target;
      const client = getClient(state.activeClientKey);
      const ws = getSelectedWorkspace();
      copyText(getOptionConfig(client, state.activeOption, ws.fsPath), btn);
    });

    document.getElementById('copy-server-path').addEventListener('click', (event) => {
      copyText(String(model.serverPath || ''), event.target);
    });

    document.getElementById('workspace-select').addEventListener('change', renderAll);
    renderAll();
  </script>
</body>
</html>`;
    }
}
