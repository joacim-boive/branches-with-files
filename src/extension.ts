import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);

interface BranchState {
  files: string[];
}

let currentBranch: string | null = null;
let openFiles: Set<string> = new Set();

function updateOpenFiles(filePath: string, isOpening: boolean) {
  if (isOpening) {
    openFiles.add(filePath);
  } else {
    openFiles.delete(filePath);
  }
  // Save the updated openFiles set to workspaceState
  vscode.commands.executeCommand('branchesWithFiles.saveOpenFiles');
}

function getAllOpenFiles(): string[] {
  return Array.from(openFiles);
}

async function saveState(context: vscode.ExtensionContext, branch: string) {
  const openFilesList = getAllOpenFiles();
  console.log(`Saving state for branch '${branch}'. Open files:`, openFilesList);

  if (openFilesList.length > 0) {
    const branchStates = context.workspaceState.get<Record<string, BranchState>>(
      'branchStates',
      {}
    );
    branchStates[branch] = { files: openFilesList };
    await context.workspaceState.update('branchStates', branchStates);
    console.log(`Saved state for branch '${branch}' (${openFilesList.length} files).`);

    const message = `Saved state for branch '${branch}' (${openFilesList.length} files).`;
    vscode.window.showInformationMessage(message, 'Show Files').then((selection) => {
      if (selection === 'Show Files') {
        showFileList(branch, openFilesList);
      }
    });
  } else {
    // If there are no open files, remove the state for this branch
    const branchStates = context.workspaceState.get<Record<string, BranchState>>('branchStates', {});
    if (branch in branchStates) {
      delete branchStates[branch];
      await context.workspaceState.update('branchStates', branchStates);
      console.log(`Cleared state for branch '${branch}' as there are no open files.`);
    }
    vscode.window.showInformationMessage(`No open files to save for branch '${branch}'. State cleared.`);
  }
}

async function restoreState(context: vscode.ExtensionContext, branch: string) {
  const branchStates = context.workspaceState.get<Record<string, BranchState>>('branchStates', {});
  console.log('Current branchStates:', branchStates);
  const state = branchStates[branch];
  if (state && state.files.length > 0) {
    console.log(`Restoring state for branch '${branch}'. Files to open:`, state.files);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const filePath of state.files) {
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
        console.log(`Opened file: ${filePath}`);
      } catch (error) {
        console.error(`Failed to open file ${filePath}: ${error}`);
        vscode.window.showWarningMessage(`Failed to open file: ${filePath}`);
      }
    }

    const message = `Restored state for branch '${branch}' (${state.files.length} files).`;
    vscode.window.showInformationMessage(message, 'Show Files').then((selection) => {
      if (selection === 'Show Files') {
        showFileList(branch, state.files);
      }
    });
  } else {
    vscode.window.showInformationMessage(`No saved state found for branch '${branch}'.`);
  }
}

function showFileList(branch: string, files: string[]) {
  const outputChannel = vscode.window.createOutputChannel('Branches With Files');
  outputChannel.clear();
  outputChannel.appendLine(`Files for branch '${branch}' (${files.length}):`);
  files.forEach((file, index) => {
    outputChannel.appendLine(`${index + 1}. ${file}`);
  });
  outputChannel.show(true);
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
    vscode.window.showErrorMessage('Failed to get current Git branch.');
    return null;
  }
}

async function handleBranchChange(context: vscode.ExtensionContext, newBranch: string) {
  console.log(`Handling branch change. Current: ${currentBranch}, New: ${newBranch}`);
  if (currentBranch && currentBranch !== newBranch) {
    await saveState(context, currentBranch);
  }
  currentBranch = newBranch;
  await restoreState(context, newBranch);
}

async function clearAllState(context: vscode.ExtensionContext) {
  // Clear branch states
  await context.workspaceState.update('branchStates', undefined);
  
  // Clear openFiles set
  openFiles.clear();
  await context.workspaceState.update('openFiles', []);
  
  console.log('All branch states and open files have been cleared.');
  vscode.window.showInformationMessage('All branch states and open files have been cleared.');
}

async function saveOpenFilesToState(context: vscode.ExtensionContext) {
  await context.workspaceState.update('openFiles', Array.from(openFiles));
}

async function loadOpenFilesFromState(context: vscode.ExtensionContext) {
  const savedOpenFiles = context.workspaceState.get<string[]>('openFiles', []);
  openFiles = new Set(savedOpenFiles);
}

export async function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('Branches With Files extension activated. Changes to opened files will be tracked from now.');

  // Load previously saved open files
  await loadOpenFilesFromState(context);

  // Set up listeners for file open and close events
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      editors.forEach((editor) => {
        if (editor.document.uri.scheme === 'file') {
          updateOpenFiles(editor.document.fileName, true);
        }
      });
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === 'file') {
        updateOpenFiles(document.fileName, false);
      }
    })
  );

  // Register command to save open files
  const saveOpenFilesCommand = vscode.commands.registerCommand(
    'branchesWithFiles.saveOpenFiles',
    () => saveOpenFilesToState(context)
  );
  context.subscriptions.push(saveOpenFilesCommand);

  // Initial branch detection
  currentBranch = await getCurrentBranch();
  if (currentBranch) {
    vscode.window.showInformationMessage(`Current branch: ${currentBranch}`);
  }

  // Set up Git extension API listener
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
  if (gitExtension) {
    const git = gitExtension.getAPI(1);
    git.onDidOpenRepository(async (repository) => {
      const newBranch = await getCurrentBranch();
      if (newBranch) {
        await handleBranchChange(context, newBranch);
      }
    });

    git.repositories.forEach((repository) => {
      repository.state.onDidChange(async () => {
        const newBranch = await getCurrentBranch();
        if (newBranch && newBranch !== currentBranch) {
          await handleBranchChange(context, newBranch);
        }
      });
    });
  }

  // Set up file system watcher for .git/HEAD
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const gitHeadPath = path.join(rootPath, '.git', 'HEAD');
    const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(gitHeadPath);

    fileSystemWatcher.onDidChange(async () => {
      const newBranch = await getCurrentBranch();
      if (newBranch && newBranch !== currentBranch) {
        await handleBranchChange(context, newBranch);
      }
    });

    context.subscriptions.push(fileSystemWatcher);
  }

  // Manual commands (optional, for debugging or manual control)
  const saveStateCommand = vscode.commands.registerCommand(
    'branchesWithFiles.saveState',
    async () => {
      try {
        const branch = await getCurrentBranch();
        if (branch) {
          // Ensure we're using the most up-to-date branch information
          currentBranch = branch;
          await saveState(context, branch);
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
          // Ensure we're using the most up-to-date branch information
          currentBranch = branch;
          await restoreState(context, branch);
        } else {
          throw new Error('Unable to determine the current Git branch.');
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error restoring state: ${error.message}`);
      }
    }
  );

  const clearAllStateCommand = vscode.commands.registerCommand(
    'branchesWithFiles.clearAllState',
    async () => {
      try {
        await clearAllState(context);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error clearing all states: ${error.message}`);
      }
    }
  );

  context.subscriptions.push(saveStateCommand, restoreStateCommand, clearAllStateCommand);
}

export function deactivate() {
  // This will be called when the extension is deactivated
  vscode.commands.executeCommand('branchesWithFiles.saveOpenFiles');
}

