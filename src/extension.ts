import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);

interface BranchState {
  files: string[];
}

let currentBranch: string | null = null;

function getAllOpenFiles(): string[] {
  const openFiles = new Set<string>();

  const shouldIncludeFile = (filePath: string): boolean => {
    const parts = filePath.split(path.sep);
    return !parts.some((part) => part.startsWith('.'));
  };

  vscode.window.visibleTextEditors.forEach((editor) => {
    if (editor.document.uri.scheme === 'file' && shouldIncludeFile(editor.document.fileName)) {
      openFiles.add(editor.document.fileName);
    }
  });

  vscode.workspace.textDocuments.forEach((doc) => {
    if (doc.uri.scheme === 'file' && shouldIncludeFile(doc.fileName)) {
      openFiles.add(doc.fileName);
    }
  });

  return Array.from(openFiles);
}

async function saveState(context: vscode.ExtensionContext, branch: string) {
  const openFiles = getAllOpenFiles();
  if (openFiles.length > 0) {
    await context.workspaceState.update(branch, { files: openFiles });
    console.log(`Saved state for branch '${branch}' (${openFiles.length} files).`);
  }
}

async function restoreState(context: vscode.ExtensionContext, branch: string) {
  const state = context.workspaceState.get<BranchState>(branch);
  if (state && state.files.length > 0) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const filePath of state.files) {
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        console.error(`Failed to open file ${filePath}: ${error}`);
      }
    }
    console.log(`Restored state for branch '${branch}' (${state.files.length} files).`);
  }
}

async function handleBranchChange(context: vscode.ExtensionContext, newBranch: string) {
  if (currentBranch) {
    await saveState(context, currentBranch);
  }
  currentBranch = newBranch;
  await restoreState(context, newBranch);
}

export async function activate(context: vscode.ExtensionContext) {
  // Initial branch detection
  currentBranch = await getCurrentBranch();
  if (currentBranch) {
    await restoreState(context, currentBranch);
  }

  // Set up a file system watcher for the .git/HEAD file
  const gitHeadWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');

  gitHeadWatcher.onDidChange(async () => {
    const newBranch = await getCurrentBranch();
    if (newBranch && newBranch !== currentBranch) {
      await handleBranchChange(context, newBranch);
    }
  });

  context.subscriptions.push(gitHeadWatcher);

  // Manual commands (optional, for debugging or manual control)
  const saveStateCommand = vscode.commands.registerCommand(
    'branchesWithFiles.saveState',
    async () => {
      try {
        const branch = await getCurrentBranch();
        if (branch) {
          await saveState(context, branch);
          vscode.window.showInformationMessage(`Manually saved state for branch '${branch}'.`);
        } else {
          throw new Error('Unable to determine the current Git branch.');
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error saving state: ${error.message}`);
      }
    }
  );

  const restoreStateCommand = vscode.commands.registerCommand(
    'branchesWithFiles.restoreState',
    async () => {
      try {
        const branch = await getCurrentBranch();
        if (branch) {
          await restoreState(context, branch);
          vscode.window.showInformationMessage(`Manually restored state for branch '${branch}'.`);
        } else {
          throw new Error('Unable to determine the current Git branch.');
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error restoring state: ${error.message}`);
      }
    }
  );

  context.subscriptions.push(saveStateCommand, restoreStateCommand);
}

async function getCurrentBranch(): Promise<string | null> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: rootPath });
    return stdout.trim();
  } catch (error) {
    console.error('Error getting current branch:', error);
    return null;
  }
}

export function deactivate() {}
