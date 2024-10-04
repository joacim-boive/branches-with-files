import * as vscode from 'vscode';
import { exec } from 'child_process';

interface BranchState {
    files: string[];
}

export function activate(context: vscode.ExtensionContext) {
    let currentBranch: string | null = null;

    const saveState = vscode.commands.registerCommand('branchesWithFiles.saveState', async () => {
        try {
            const branch = await getCurrentBranch();
            if (branch) {
                const openFiles = vscode.window.visibleTextEditors.map(editor => editor.document.uri.fsPath);
                await context.workspaceState.update(branch, { files: openFiles });
                vscode.window.showInformationMessage(`Saved state for branch '${branch}'`);
            } else {
                vscode.window.showErrorMessage('Unable to determine the current Git branch.');
            }
        } catch (error) {
            console.error('Error in saveState:', error);
            vscode.window.showErrorMessage('An error occurred while saving the branch state.');
        }
    });

    const restoreState = vscode.commands.registerCommand('branchesWithFiles.restoreState', async () => {
        const branch = await getCurrentBranch();
        if (branch) {
            const state = context.workspaceState.get<BranchState>(branch);
            if (state && state.files.length > 0) {
                const documents = await Promise.all(
                    state.files.map(file => vscode.workspace.openTextDocument(file))
                );
                for (const doc of documents) {
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
                vscode.window.showInformationMessage(`Restored state for branch '${branch}'`);
            } else {
                vscode.window.showInformationMessage(`No saved state for branch '${branch}'`);
            }
        } else {
            vscode.window.showErrorMessage('Unable to determine the current Git branch.');
        }
    });

    // Automatically restore state when switching branches
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    const gitApi = gitExtension?.getAPI(1);
    if (gitApi) {
        gitApi.onDidChangeState(async () => {
            const newBranch = await getCurrentBranch();
            if (newBranch && newBranch !== currentBranch) {
                currentBranch = newBranch;
                vscode.commands.executeCommand('branchesWithFiles.restoreState');
            }
        });
    } else {
        // Fallback: Poll for branch changes every 5 seconds
        let pollInterval = setInterval(async () => {
            const branch = await getCurrentBranch();
            if (branch && branch !== currentBranch) {
                currentBranch = branch;
                vscode.commands.executeCommand('branchesWithFiles.restoreState');
            }
        }, 5000);

        context.subscriptions.push({
            dispose: () => clearInterval(pollInterval)
        });
    }

    context.subscriptions.push(saveState, restoreState);
}

export function deactivate() {}

/**
 * Retrieves the current Git branch name.
 * @returns The name of the current branch, or null if not found.
 */
function getCurrentBranch(): Promise<string | null> {
    return new Promise((resolve) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        exec('git rev-parse --abbrev-ref HEAD', { cwd: workspaceFolder }, (err, stdout, stderr) => {
            if (err) {
                console.error('Error executing git command:', err);
                resolve(null);
            } else if (stderr) {
                console.error('Git command stderr:', stderr);
                resolve(null);
            } else {
                const branch = stdout.trim();
                console.log('Current branch:', branch);
                resolve(branch);
            }
        });
    });
}