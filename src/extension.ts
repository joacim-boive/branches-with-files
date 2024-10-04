import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

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
            }
            // The error message for no branch will be shown by getCurrentBranch()
        } catch (error) {
            vscode.window.showErrorMessage(`An error occurred while saving the branch state: ${error.message}`);
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
        }
        // The error message for no branch will be shown by getCurrentBranch()
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
        const activeEditor = vscode.window.activeTextEditor;
        const filePath = activeEditor?.document.uri.fsPath;
        
        if (!filePath) {
            vscode.window.showInformationMessage('No active file found. Please open a file in a Git repository.');
            resolve(null);
            return;
        }

        const directoryPath = path.dirname(filePath);

        exec('git rev-parse --abbrev-ref HEAD', { cwd: directoryPath }, (err, stdout, stderr) => {
            if (err) {
                if (err.code === 128) {
                    vscode.window.showErrorMessage('The current file is not in a Git repository.');
                } else {
                    vscode.window.showErrorMessage(`Error executing Git command: ${err.message}`);
                }
                resolve(null);
            } else if (stderr) {
                vscode.window.showErrorMessage(`Git command error: ${stderr}`);
                resolve(null);
            } else {
                const branch = stdout.trim();
                // We might want to keep this as a console.log for debugging purposes
                // console.log('Current branch:', branch);
                resolve(branch);
            }
        });
    });
}