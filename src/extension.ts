import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface BranchState {
    files: string[];
}

function getAllOpenFiles(): string[] {
    const openFiles = new Set<string>();

    // Helper function to check if a file should be included
    const shouldIncludeFile = (filePath: string): boolean => {
        const parts = filePath.split(path.sep);
        return !parts.some(part => part.startsWith('.'));
    };

    // Get files from visible text editors
    vscode.window.visibleTextEditors.forEach(editor => {
        if (editor.document.uri.scheme === 'file' && shouldIncludeFile(editor.document.fileName)) {
            openFiles.add(editor.document.fileName);
        }
    });

    // Get files from all open text documents
    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.uri.scheme === 'file' && shouldIncludeFile(doc.fileName)) {
            openFiles.add(doc.fileName);
        }
    });

    return Array.from(openFiles);
}

export function activate(context: vscode.ExtensionContext) {
    let currentBranch: string | null = null;

    const saveState = vscode.commands.registerCommand('branchesWithFiles.saveState', async () => {
        try {
            const branch = await getCurrentBranch();
            if (branch) {
                const openFiles = getAllOpenFiles();
                console.log(`Number of open files: ${openFiles.length}`);
                console.log(`Open files: ${openFiles.join(', ')}`);

                if (openFiles.length === 0) {
                    vscode.window.showInformationMessage('No open files to save.');
                    return;
                }

                await context.workspaceState.update(branch, { files: openFiles });

                // Prepare the message with file names
                const maxFilesToShow = 5; // Adjust this number as needed
                const fileNames = openFiles.map(file => path.basename(file));
                let message = `Saved state for branch '${branch}' (${openFiles.length} files):\n`;
                message += fileNames.slice(0, maxFilesToShow).join('\n');
                
                if (openFiles.length > maxFilesToShow) {
                    message += `\n... and ${openFiles.length - maxFilesToShow} more`;
                }

                // Show the information message with file names
                vscode.window.showInformationMessage(message, 'Show All Files').then(selection => {
                    if (selection === 'Show All Files') {
                        // If user clicks "Show All Files", display full list in output channel
                        const outputChannel = vscode.window.createOutputChannel('Branches With Files');
                        outputChannel.clear();
                        outputChannel.appendLine(`All saved files for branch '${branch}' (${openFiles.length}):`);
                        openFiles.forEach((file, index) => {
                            outputChannel.appendLine(`${index + 1}. ${file}`);
                        });
                        outputChannel.show(true);
                    }
                });
            } else {
                vscode.window.showErrorMessage('Unable to determine the current Git branch.');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`An error occurred while saving the branch state: ${error.message}`);
        }
    });

    const restoreState = vscode.commands.registerCommand('branchesWithFiles.restoreState', async () => {
        try {
            const branch = await getCurrentBranch();
            console.log(`Restoring state for branch: ${branch}`);
            if (branch) {
                const state = context.workspaceState.get<BranchState>(branch);
                if (state && state.files.length > 0) {
                    // Close all currently open editors
                    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

                    for (const filePath of state.files) {
                        try {
                            const doc = await vscode.workspace.openTextDocument(filePath);
                            await vscode.window.showTextDocument(doc, { preview: false });
                            console.log(`Opened file: ${filePath}`);
                        } catch (openError: any) {
                            console.error(`Failed to open file ${filePath}: ${openError.message}`);
                            vscode.window.showWarningMessage(`Failed to open file ${filePath}: ${openError.message}`);
                        }
                    }
                    vscode.window.showInformationMessage(`Restored state for branch '${branch}' (${state.files.length} files).`);
                } else {
                    vscode.window.showInformationMessage(`No saved state found for branch '${branch}'.`);
                }
            } else {
                vscode.window.showErrorMessage('Unable to determine the current Git branch.');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`An error occurred while restoring the branch state: ${error.message}`);
        }
    });

    const logAllOpenFiles = vscode.commands.registerCommand('branchesWithFiles.logAllOpenFiles', () => {
        const openFiles = getAllOpenFiles();
        
        if (openFiles.length === 0) {
            vscode.window.showInformationMessage('No open files found.');
            return;
        }

        const fileList = openFiles
            .map((file, index) => `${index + 1}. ${file}`)
            .join('\n');

        // Create and show output channel
        const outputChannel = vscode.window.createOutputChannel('Branches With Files');
        outputChannel.clear();
        outputChannel.appendLine(`All Open Files (${openFiles.length}):`);
        outputChannel.appendLine(fileList);
        outputChannel.show(true);

        vscode.window.showInformationMessage(`Logged ${openFiles.length} open files to the output channel.`);
    });

    context.subscriptions.push(saveState, restoreState, logAllOpenFiles);

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