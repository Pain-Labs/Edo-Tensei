import * as vscode from 'vscode';

export class I18n {
    private static messages: { [key: string]: string } = {};
    private static isInitialized: boolean = false;

    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        if (this.isInitialized) {
            return;
        }
        try {
            const locale = vscode.env.language || 'en';
            const loaded = await this.loadLanguageFile(context, locale);
            if (!loaded) {
                await this.loadLanguageFile(context, 'en');
            }
            this.isInitialized = true;
        } catch (error) {
            console.error('i18n initialization failed:', error);
            await this.loadLanguageFile(context, 'en');
            this.isInitialized = true;
        }
    }

    private static async loadLanguageFile(context: vscode.ExtensionContext, locale: string): Promise<boolean> {
        try {
            const uri = vscode.Uri.joinPath(context.extensionUri, 'i18n', `${locale}.json`);
            const content = await vscode.workspace.fs.readFile(uri);
            this.messages = JSON.parse(content.toString());
            return true;
        } catch {
            return false;
        }
    }

    public static getMessage(key: string, ...args: string[]): string {
        let message = this.messages[key] || key;
        for (let i = 0; i < args.length; i++) {
            message = message.replace(new RegExp(`\\{${i}\\}`, 'g'), args[i]);
        }
        return message;
    }

    public static async reload(context: vscode.ExtensionContext): Promise<void> {
        this.isInitialized = false;
        this.messages = {};
        await this.initialize(context);
    }
}
