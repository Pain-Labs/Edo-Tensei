import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { readFile } from 'fs/promises';
import { SessionHandoffService } from './core/SessionHandoffService';
import { SkillGenerator } from './core/SkillGenerator';
import { SessionHandoffProvider, SessionItem, IDEParentItem, LoadMoreItem } from './ui/SessionHandoffProvider';
import { McpConfigPanel } from './ui/McpConfigPanel';
import { I18n } from './i18n';

const execFileAsync = promisify(execFile);

const SUPPRESS_GITIGNORE_PROMPT_KEY_PREFIX = 'edoTensei.suppressGitignorePrompt:';
const GITIGNORE_COOLDOWN_MS = 60_000;

function sanitizePathSegment(input: string): string {
    // Conservative: keep common characters, replace the rest.
    const cleaned = input
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > 0 ? cleaned : 'unknown';
}

function buildExportFileName(session: import('./core/extractors/types').CapturedSession): string {
    const ts = new Date(session.capturedAt);
    const y = ts.getFullYear();
    const m = String(ts.getMonth() + 1).padStart(2, '0');
    const d = String(ts.getDate()).padStart(2, '0');
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const base = `${y}${m}${d}_${hh}${mm}`;

    const titlePart = session.title ? sanitizePathSegment(session.title).slice(0, 60) : undefined;
    const idPart = session.sessionId ? sanitizePathSegment(session.sessionId).slice(0, 24) : undefined;
    const suffix = titlePart ?? idPart ?? 'session';
    return `${base}_${suffix}.md`;
}

async function exportSessionToWorkspaceEdoDir(
    workspaceFolder: vscode.WorkspaceFolder,
    session: import('./core/extractors/types').CapturedSession,
    content: string
): Promise<vscode.Uri> {
    const workspaceRoot = workspaceFolder.uri;
    const projectName = session.workspacePath ? sanitizePathSegment(path.basename(session.workspacePath)) : 'unknown_project';
    const ide = sanitizePathSegment(session.sourceIde);
    const exportDir = vscode.Uri.joinPath(workspaceRoot, '.edo_tensei', ide, projectName);
    await vscode.workspace.fs.createDirectory(exportDir);

    const fileName = buildExportFileName(session);
    const fileUri = vscode.Uri.joinPath(exportDir, fileName);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    return fileUri;
}

function getSuppressKey(workspaceFolder: vscode.WorkspaceFolder): string {
    return `${SUPPRESS_GITIGNORE_PROMPT_KEY_PREFIX}${workspaceFolder.uri.fsPath}`;
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function getGitRoot(workspaceRootFsPath: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
            cwd: workspaceRootFsPath,
            windowsHide: true,
        });
        const root = stdout.trim();
        return root.length > 0 ? root : undefined;
    } catch {
        return undefined;
    }
}

async function isEdoTenseiDirGitIgnored(workspaceRootFsPath: string): Promise<boolean> {
    try {
        // `git check-ignore -q` exit code:
        // 0 => ignored
        // 1 => not ignored
        // 128 => fatal (not a git repo etc)
        await execFileAsync('git', ['check-ignore', '-q', '.edo_tensei/'], {
            cwd: workspaceRootFsPath,
            windowsHide: true,
        });
        return true;
    } catch (err: any) {
        const code = typeof err?.code === 'number' ? err.code : undefined;
        if (code === 1) {
            return false;
        }
        return false;
    }
}

async function copyGitignoreRuleToClipboard(): Promise<void> {
    await vscode.env.clipboard.writeText('.edo_tensei/');
    vscode.window.showInformationMessage(I18n.getMessage('gitignore.copied'));
}

async function pickGitignoreTargetPath(workspaceRootFsPath: string): Promise<string | undefined> {
    const gitRoot = await getGitRoot(workspaceRootFsPath);
    const workspaceGitignore = path.join(workspaceRootFsPath, '.gitignore');
    const gitRootGitignore = gitRoot ? path.join(gitRoot, '.gitignore') : undefined;

    const options: Array<{ label: string; description: string; targetPath: string; createIfMissing?: boolean }> = [];

    const workspaceExists = await pathExists(vscode.Uri.file(workspaceGitignore));
    if (workspaceExists) {
        options.push({
            label: I18n.getMessage('gitignore.workspaceOption'),
            description: workspaceGitignore,
            targetPath: workspaceGitignore,
        });
    } else {
        options.push({
            label: I18n.getMessage('gitignore.workspaceOptionCreate'),
            description: workspaceGitignore,
            targetPath: workspaceGitignore,
            createIfMissing: true,
        });
    }

    const normPath = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    if (gitRootGitignore && normPath(gitRootGitignore) !== normPath(workspaceGitignore)) {
        const gitRootExists = await pathExists(vscode.Uri.file(gitRootGitignore));
        if (gitRootExists) {
            options.push({
                label: I18n.getMessage('gitignore.gitRootOption'),
                description: gitRootGitignore,
                targetPath: gitRootGitignore,
            });
        }
    }

    if (options.length === 1) {
        return options[0].targetPath;
    }

    const picked = await vscode.window.showQuickPick(options, {
        placeHolder: I18n.getMessage('gitignore.pickPlaceholder'),
    });
    return picked?.targetPath;
}

function hasEquivalentIgnoreRule(content: string): boolean {
    // Best-effort: treat common variants as equivalent.
    const normalized = content.replace(/\r\n/g, '\n');
    return (
        normalized.includes('\n.edo_tensei/\n') ||
        normalized.includes('\n.edo_tensei\n') ||
        normalized.includes('\n**/.edo_tensei/\n') ||
        normalized.startsWith('.edo_tensei/\n') ||
        normalized.startsWith('.edo_tensei\n')
    );
}

async function addEdoTenseiRuleToGitignore(targetPath: string): Promise<'added' | 'already_exists'> {
    const uri = vscode.Uri.file(targetPath);
    let existing = '';
    try {
        const buf = await vscode.workspace.fs.readFile(uri);
        existing = Buffer.from(buf).toString('utf8');
    } catch {
        existing = '';
    }

    if (existing && hasEquivalentIgnoreRule(existing)) {
        return 'already_exists';
    }

    const header = '# Edo-Tensei local data';
    const rule = '.edo_tensei/';
    const normalized = existing.replace(/\r\n/g, '\n');
    const needsNewline = normalized.length > 0 && !normalized.endsWith('\n');
    const block = `${(needsNewline ? '\n' : '')}${header}\n${rule}\n`;
    const updated = normalized + block;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
    return 'added';
}

async function addSkillRulesToGitignore(targetPath: string, rules: string[]): Promise<void> {
    const uri = vscode.Uri.file(targetPath);
    let existing = '';
    try {
        const buf = await vscode.workspace.fs.readFile(uri);
        existing = Buffer.from(buf).toString('utf8');
    } catch {
        existing = '';
    }

    const normalized = existing.replace(/\r\n/g, '\n');
    const newRules = rules.filter(rule =>
        !normalized.includes(`\n${rule}\n`) &&
        !normalized.startsWith(`${rule}\n`) &&
        !normalized.endsWith(`\n${rule}`)
    );
    if (newRules.length === 0) { return; }

    const needsNewline = normalized.length > 0 && !normalized.endsWith('\n');
    const block = `${needsNewline ? '\n' : ''}# Edo Tensei skills\n${newRules.join('\n')}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(normalized + block, 'utf8'));
}

async function maybePromptAddGitignoreRule(
    context: vscode.ExtensionContext,
    workspaceFolder: vscode.WorkspaceFolder,
    reason: 'created' | 'save'
): Promise<void> {
    const suppressKey = getSuppressKey(workspaceFolder);
    if (context.workspaceState.get<boolean>(suppressKey)) {
        return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const edoDirUri = vscode.Uri.file(path.join(workspaceRoot, '.edo_tensei'));
    if (!(await pathExists(edoDirUri))) {
        return;
    }

    // Only prompt in a git repo. (Avoid nagging in non-git folders.)
    const gitRoot = await getGitRoot(workspaceRoot);
    if (!gitRoot) {
        return;
    }

    // If it's already ignored, don't bother.
    if (await isEdoTenseiDirGitIgnored(workspaceRoot)) {
        return;
    }

    const lastPromptAtKey = `edoTensei.gitignorePromptLastAt:${workspaceRoot}`;
    const lastPromptAt = context.workspaceState.get<number>(lastPromptAtKey, 0);
    const now = Date.now();
    if (now - lastPromptAt < GITIGNORE_COOLDOWN_MS) {
        return;
    }
    await context.workspaceState.update(lastPromptAtKey, now);

    const message = reason === 'created'
        ? I18n.getMessage('gitignore.promptCreated')
        : I18n.getMessage('gitignore.promptSave');

    const actionAdd = I18n.getMessage('gitignore.actionAdd');
    const actionCopy = I18n.getMessage('gitignore.actionCopy');
    const actionSuppress = I18n.getMessage('gitignore.actionSuppress');

    const picked = await vscode.window.showInformationMessage(message, actionAdd, actionCopy, actionSuppress);
    if (!picked) {
        return;
    }

    if (picked === actionSuppress) {
        await context.workspaceState.update(suppressKey, true);
        return;
    }

    if (picked === actionCopy) {
        await copyGitignoreRuleToClipboard();
        return;
    }

    const targetPath = await pickGitignoreTargetPath(workspaceRoot);
    if (!targetPath) {
        return;
    }

    try {
        const result = await addEdoTenseiRuleToGitignore(targetPath);
        if (result === 'already_exists') {
            vscode.window.showInformationMessage(I18n.getMessage('gitignore.alreadyExists'));
            return;
        }
        const open = await vscode.window.showInformationMessage(I18n.getMessage('gitignore.added'), I18n.getMessage('gitignore.openFile'));
        if (open === I18n.getMessage('gitignore.openFile')) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
            await vscode.window.showTextDocument(doc);
        }
    } catch (err: any) {
        vscode.window.showWarningMessage(I18n.getMessage('gitignore.addFailed', err?.message ?? String(err)));
        await copyGitignoreRuleToClipboard();
    }
}

export async function activate(context: vscode.ExtensionContext) {
    await I18n.initialize(context);
    console.log('Edo Tensei is now active!');

    const sessionService = new SessionHandoffService(context);
    const sessionHandoffProvider = new SessionHandoffProvider(sessionService);
    let isScanning = false; // Throttle guard: prevents duplicate scan from rapid button clicks

    const sessionPreviewKeyToId = new Map<string, string>();
    const sessionPreviewKeyToUri = new Map<string, vscode.Uri>();
    const sessionPreviewKeyToContent = new Map<string, string>();
    const sessionPreviewKeyToInFlight = new Map<string, Promise<void>>();

    // Track per-folder watchers so we can dispose them when folders are removed.
    // These are NOT added to context.subscriptions to avoid double-disposal;
    // they are cleaned up either by teardownFolderWatcher or the final subscription below.
    const folderWatchers = new Map<string, vscode.Disposable[]>();

    function setupFolderWatcher(workspaceFolder: vscode.WorkspaceFolder): void {
        if (folderWatchers.has(workspaceFolder.uri.fsPath)) {
            return; // Already set up
        }

        const disposables: vscode.Disposable[] = [];

        // Initial check (covers pre-existing `.edo_tensei/` in the workspace).
        void maybePromptAddGitignoreRule(context, workspaceFolder, 'created');

        // Trigger A: first creation/write of `.edo_tensei/`.
        const createdWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '.edo_tensei/**')
        );
        createdWatcher.onDidCreate(() => {
            void maybePromptAddGitignoreRule(context, workspaceFolder, 'created');
        }, undefined, disposables);
        disposables.push(createdWatcher);

        // Trigger B: on every save, check this specific folder.
        const saveDisposable = vscode.workspace.onDidSaveTextDocument(() => {
            void maybePromptAddGitignoreRule(context, workspaceFolder, 'save');
        });
        disposables.push(saveDisposable);

        folderWatchers.set(workspaceFolder.uri.fsPath, disposables);
    }

    function teardownFolderWatcher(fsPath: string): void {
        const disposables = folderWatchers.get(fsPath);
        if (disposables) {
            for (const d of disposables) { d.dispose(); }
            folderWatchers.delete(fsPath);
        }
    }

    // Set up watchers for all existing workspace folders.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        setupFolderWatcher(folder);
    }

    // Dynamically handle workspace folder additions and removals.
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(event => {
            for (const added of event.added) {
                setupFolderWatcher(added);
            }
            for (const removed of event.removed) {
                teardownFolderWatcher(removed.uri.fsPath);
            }
        })
    );

    // Dispose any remaining per-folder watchers when the extension deactivates.
    context.subscriptions.push({
        dispose: () => {
            for (const fsPath of [...folderWatchers.keys()]) {
                teardownFolderWatcher(fsPath);
            }
        }
    });

    // Keep a reference to the first workspace folder for export operations.
    const getExportWorkspaceFolder = (): vscode.WorkspaceFolder | undefined =>
        vscode.workspace.workspaceFolders?.[0];

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('sessionHandoffView', sessionHandoffProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.previewRawSession', async (item: SessionItem) => {
            if (!item?.session) {
                vscode.window.showWarningMessage(I18n.getMessage('session.notSelected'));
                return;
            }

            const rawPath = item.session.rawPath;
            if (!rawPath) {
                vscode.window.showWarningMessage(I18n.getMessage('session.noRawPath'));
                return;
            }

            try {
                const buf = await readFile(rawPath);
                let content = buf.toString('utf8');

                const maxChars = 300_000;
                if (content.length > maxChars) {
                    content = [
                        `TRUNCATED: showing last ${maxChars} chars of file (original length: ${content.length})`,
                        '',
                        content.slice(-maxChars),
                    ].join('\n');
                }

                const ext = path.extname(rawPath).toLowerCase();
                const language = ext === '.json' ? 'json' : ext === '.jsonl' ? 'json' : 'text';
                const doc = await vscode.workspace.openTextDocument({ content, language });
                await vscode.window.showTextDocument(doc, { preview: true });
            } catch (err: any) {
                vscode.window.showWarningMessage(I18n.getMessage('session.previewFailed', err?.message ?? String(err)));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.scanAllIdes', async () => {
            if (isScanning) { return; }
            isScanning = true;
            try {
                const sessions = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Window, title: I18n.getMessage('scan.allProgress'), cancellable: false },
                    () => sessionService.scanAllIdes()
                );
                vscode.window.showInformationMessage(I18n.getMessage('scan.allFound', String(sessions.length)));
            } finally {
                isScanning = false;
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.loadMoreSessions', async (ideId: string) => {
            await sessionService.loadMoreSessions(ideId as Parameters<typeof sessionService.loadMoreSessions>[0]);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.refreshIde', async (item: IDEParentItem) => {
            if (!item?.ideId) { return; }
            if (isScanning) { return; }
            isScanning = true;
            try {
                const label = typeof item.label === 'string' ? item.label : item.ideId;
                const sessions = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Window, title: I18n.getMessage('scan.refreshIdeProgress', label), cancellable: false },
                    () => sessionService.scanSingleIde(item.ideId)
                );
                vscode.window.showInformationMessage(I18n.getMessage('scan.refreshIdeFound', label, String(sessions.length)));
            } finally {
                isScanning = false;
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.resurrectSession', async (item: SessionItem) => {
            if (!item?.session) {
                vscode.window.showWarningMessage(I18n.getMessage('session.notSelected'));
                return;
            }
            await sessionService.ensureSessionMessagesLoaded(item.session);
            const prompt = sessionService.buildPromptFromCapturedSession(item.session);
            await vscode.env.clipboard.writeText(prompt);
            const msgKey = sessionService.hasSkillInstalled() ? 'session.copiedSkill' : 'session.copiedFullGuide';
            vscode.window.showInformationMessage(I18n.getMessage(msgKey));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.exportAllSessions', async (item: IDEParentItem) => {
            const sessions = sessionService.getGroupedSessions().get(item.ideId) ?? [];
            if (sessions.length === 0) {
                vscode.window.showWarningMessage(I18n.getMessage('export.noSessions'));
                return;
            }
            const workspaceFolder = getExportWorkspaceFolder();
            if (!workspaceFolder) {
                vscode.window.showWarningMessage(I18n.getMessage('export.noWorkspace'));
                return;
            }

            let exported = 0;
            let lastUri: vscode.Uri | undefined;
            for (const s of sessions) {
                try {
                    await sessionService.ensureSessionMessagesLoaded(s);
                    const content = sessionService.buildExportContent(s);
                    lastUri = await exportSessionToWorkspaceEdoDir(workspaceFolder, s, content);
                    exported++;
                } catch (err) {
                    console.error('[EdoTensei] export session failed:', err);
                }
            }

            if (exported === 0) {
                vscode.window.showWarningMessage(I18n.getMessage('export.allFailed'));
                return;
            }

            void maybePromptAddGitignoreRule(context, workspaceFolder, 'created');

            const openLast = await vscode.window.showInformationMessage(
                I18n.getMessage('export.allSuccess', String(exported)),
                I18n.getMessage('export.openLast')
            );
            if (openLast === I18n.getMessage('export.openLast') && lastUri) {
                const doc = await vscode.workspace.openTextDocument(lastUri);
                await vscode.window.showTextDocument(doc);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.exportSession', async (item: SessionItem) => {
            if (!item?.session) {
                vscode.window.showWarningMessage(I18n.getMessage('session.notSelected'));
                return;
            }
            const workspaceFolder = getExportWorkspaceFolder();
            if (!workspaceFolder) {
                vscode.window.showWarningMessage(I18n.getMessage('export.noWorkspace'));
                return;
            }

            try {
                await sessionService.ensureSessionMessagesLoaded(item.session);
                const content = sessionService.buildExportContent(item.session);
                const uri = await exportSessionToWorkspaceEdoDir(workspaceFolder, item.session, content);
                void maybePromptAddGitignoreRule(context, workspaceFolder, 'created');

                const open = await vscode.window.showInformationMessage(I18n.getMessage('export.success'), I18n.getMessage('export.openFile'));
                if (open === I18n.getMessage('export.openFile')) {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await vscode.window.showTextDocument(doc);
                }
            } catch (err: any) {
                vscode.window.showWarningMessage(I18n.getMessage('export.failed', err?.message ?? String(err)));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.viewParsedSession', async (item: SessionItem) => {
            if (!item?.session) {
                vscode.window.showWarningMessage(I18n.getMessage('session.notSelected'));
                return;
            }

            const sessionKey = item.session.rawPath || item.session.sessionId || `${item.session.sourceIde}:${item.session.capturedAt}`;
            let shortId = sessionPreviewKeyToId.get(sessionKey);
            if (!shortId) {
                shortId = crypto.createHash('sha256').update(sessionKey).digest('hex').slice(0, 10);
                sessionPreviewKeyToId.set(sessionKey, shortId);
            }

            let uri = sessionPreviewKeyToUri.get(sessionKey);
            if (!uri) {
                // Use a stable untitled URI so repeated clicks do not create duplicate documents.
                uri = vscode.Uri.parse(`untitled:Edo-Tensei-${shortId}.md`);
                sessionPreviewKeyToUri.set(sessionKey, uri);
            }

            const applyContentToUntitled = async (content: string): Promise<void> => {
                const doc = await vscode.workspace.openTextDocument(uri);
                const edit = new vscode.WorkspaceEdit();
                const endLine = Math.max(doc.lineCount - 1, 0);
                const endChar = doc.lineCount > 0 ? doc.lineAt(endLine).text.length : 0;
                const fullRange = new vscode.Range(0, 0, endLine, endChar);
                edit.replace(uri, fullRange, content);
                await vscode.workspace.applyEdit(edit);
            };

            const cached = sessionPreviewKeyToContent.get(sessionKey);
            if (cached) {
                await applyContentToUntitled(cached);
                await vscode.commands.executeCommand('markdown.showPreview', uri);
                return;
            }

            // If a load is already running for this session, don't reset the doc back to Loading…
            const inFlight = sessionPreviewKeyToInFlight.get(sessionKey);
            if (!inFlight) {
                await applyContentToUntitled('Loading…');
            }
            await vscode.commands.executeCommand('markdown.showPreview', uri);

            if (inFlight) {
                return;
            }

            const loadPromise = (async () => {
                const status = vscode.window.setStatusBarMessage('Edo Tensei: loading session…');
                try {
                    await sessionService.ensureSessionMessagesLoaded(item.session);
                    const content = sessionService.buildReadableTranscript(item.session);
                    sessionPreviewKeyToContent.set(sessionKey, content);
                    await applyContentToUntitled(content);
                } finally {
                    status.dispose();
                    sessionPreviewKeyToInFlight.delete(sessionKey);
                }
            })();

            sessionPreviewKeyToInFlight.set(sessionKey, loadPromise);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.copyRawPath', async (item: SessionItem) => {
            if (!item?.session?.rawPath) {
                vscode.window.showWarningMessage(I18n.getMessage('session.noRawFilePath'));
                return;
            }
            await vscode.env.clipboard.writeText(item.session.rawPath);
            vscode.window.showInformationMessage(I18n.getMessage('session.pathCopied'));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'edoTensei');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.generateAgentSkill', async () => {
            const result = await SkillGenerator.generateSkill();
            if (result.status !== 'generated') { return; }

            const { skillPaths, projectRoot } = result;
            const dirNames = [...new Set(skillPaths.map(p =>
                path.relative(projectRoot, p).split(path.sep)[0]
            ))];
            const message = skillPaths.length === 1
                ? I18n.getMessage('skill.generated', path.relative(projectRoot, skillPaths[0]).replace(/\\/g, '/'))
                : I18n.getMessage('skill.generatedMultiple', String(skillPaths.length), dirNames.join(', '));

            const addToGitignoreLabel = I18n.getMessage('skill.addToGitignore');
            const picked = await vscode.window.showInformationMessage(message, addToGitignoreLabel);

            if (picked === addToGitignoreLabel) {
                const skillWorkspaceFolder = getExportWorkspaceFolder();
                if (skillWorkspaceFolder) {
                    const targetPath = await pickGitignoreTargetPath(skillWorkspaceFolder.uri.fsPath);
                    if (targetPath) {
                        const rules = skillPaths.map(p => {
                            const rel = path.relative(projectRoot, p).replace(/\\/g, '/');
                            return rel.endsWith('SKILL.md') ? rel.substring(0, rel.lastIndexOf('/') + 1) : rel;
                        });
                        await addSkillRulesToGitignore(targetPath, rules);
                        const open = await vscode.window.showInformationMessage(
                            I18n.getMessage('skill.gitignoreAdded'),
                            I18n.getMessage('gitignore.openFile')
                        );
                        if (open === I18n.getMessage('gitignore.openFile')) {
                            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
                            await vscode.window.showTextDocument(doc);
                        }
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.openSessionFile', async (item) => {
            if (item && item.command && item.command.arguments) {
                const filePath = item.command.arguments[0];
                if (filePath) {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                    await vscode.window.showTextDocument(doc);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.copyHandoffPrompt', async (item: SessionItem) => {
            if (!item?.session) { return; }
            await sessionService.ensureSessionMessagesLoaded(item.session);
            const prompt = sessionService.buildPromptFromCapturedSession(item.session);
            await vscode.env.clipboard.writeText(prompt);
            const msgKey = sessionService.hasSkillInstalled() ? 'session.copiedSkill' : 'session.copiedFullGuide';
            vscode.window.showInformationMessage(I18n.getMessage(msgKey));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.copyReferencePrompt', async (item: SessionItem) => {
            if (!item?.session) { return; }
            await sessionService.ensureSessionMessagesLoaded(item.session);
            const prompt = sessionService.buildReferencePrompt(item.session);
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage(I18n.getMessage('session.copiedReference'));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.copyContextPrompt', async (item: SessionItem) => {
            if (!item?.session) { return; }
            await sessionService.ensureSessionMessagesLoaded(item.session);
            const prompt = sessionService.buildContextPrompt(item.session);
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage(I18n.getMessage('session.copiedContext'));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('edoTensei.showMcpConfig', async () => {
            const config = vscode.workspace.getConfiguration('edoTensei');
            const enabled = config.get<boolean>('mcpConfig.enabled', false);
            if (!enabled) {
                const actionEnable = I18n.getMessage('mcpConfig.beta.enable');
                const actionOpenSettings = I18n.getMessage('mcpConfig.beta.openSettings');
                const picked = await vscode.window.showInformationMessage(
                    I18n.getMessage('mcpConfig.beta.disabled'),
                    actionEnable,
                    actionOpenSettings
                );
                if (picked === actionEnable) {
                    await config.update('mcpConfig.enabled', true, vscode.ConfigurationTarget.Global);
                    await McpConfigPanel.show(context);
                } else if (picked === actionOpenSettings) {
                    await vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        '@ext:Pain-Labs.edo-tensei edoTensei.mcpConfig.enabled'
                    );
                }
                return;
            }

            await McpConfigPanel.show(context);
        })
    );
}

export function deactivate() {}
