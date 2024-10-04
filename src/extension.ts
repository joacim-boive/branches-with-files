import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(child_process.exec);

interface BranchState {
  files: string[];
}

async function updateOpenFiles(context: vscode.ExtensionContext, filePath: string, isOpening: boolean) {
  const openFiles = await getOpenFiles(context);
  if (isOpening) {
    openFiles.add(filePath);
  } else {
    openFiles.delete(filePath);
  }
  await context.workspaceState.update('openFiles', Array.from(openFiles));
}

async function syncOpenFilesWithWorkspace(context: vscode.ExtensionContext) {
  const openFiles = new Set<string>();
  vscode.workspace.textDocuments.forEach(doc => {
    if (doc.uri.scheme === 'file') {
      openFiles.add(doc.fileName);
    }
  });
  await context.workspaceState.update('openFiles', Array.from(openFiles));
}

async function getOpenFiles(context: vscode.ExtensionContext): Promise<Set<string>> {
  const openFiles = context.workspaceState.get<string[]>('openFiles', []);
  return new Set(openFiles);
}

async function saveState(context: vscode.ExtensionContext, branch: string) {
  const openFiles = await getOpenFiles(context);
  const openFilesList = Array.from(openFiles);

  if (openFilesList.length > 0) {
    const branchStates = context.workspaceState.get<Record<string, BranchState>>('branchStates', {});
    branchStates[branch] = { files: openFilesList };
    await context.workspaceState.update('branchStates', branchStates);
    vscode.window.showInformationMessage(`Saved state for branch '${branch}' (${openFilesList.length} files).`);
  } else {
    const branchStates = context.workspaceState.get<Record<string, BranchState>>('branchStates', {});
    if (branch in branchStates) {
      delete branchStates[branch];
      await context.workspaceState.update('branchStates', branchStates);
    }
    vscode.window.showInformationMessage(`No open files to save for branch '${branch}'. State cleared.`);
  }
}

async function restoreState(context: vscode.ExtensionContext, branch: string) {
  const branchStates = context.workspaceState.get<Record<string, BranchState>>('branchStates', {});
  const state = branchStates[branch];
  if (state && state.files.length > 0) {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const filePath of state.files) {
      try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (error) {
        console.error(`Failed to open file ${filePath}: ${error}`);
        vscode.window.showWarningMessage(`Failed to open file: ${filePath}`);
      }
    }
    vscode.window.showInformationMessage(`Restored state for branch '${branch}' (${state.files.length} files).`);
  } else {
    vscode.window.showInformationMessage(`No saved state found for branch '${branch}'.`);
  }
}

async function clearAllState(context: vscode.ExtensionContext) {
  await context.workspaceState.update('branchStates', undefined);
  await context.workspaceState.update('openFiles', []);
  vscode.window.showInformationMessage('All branch states and open files have been cleared.');
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

export function activate(context: vscode.ExtensionContext) {
  console.log('Branches With Files extension is now active');

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
      for (const editor of editors) {
        if (editor.document.uri.scheme === 'file') {
          await updateOpenFiles(context, editor.document.fileName, true);
        }
      }
    }),
    vscode.workspace.onDidCloseTextDocument(async (document) => {
      if (document.uri.scheme === 'file') {
        await updateOpenFiles(context, document.fileName, false);
      }
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme === 'file') {
        await updateOpenFiles(context, document.fileName, true);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (e.document.uri.scheme === 'file' && e.document.isDirty) {
        await updateOpenFiles(context, e.document.fileName, true);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      // Workspace folders changed, we should resync our state
      await syncOpenFilesWithWorkspace(context);
    })
  );

  // Initial sync
  syncOpenFilesWithWorkspace(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('branchesWithFiles.saveState', async () => {
      const branch = await getCurrentBranch();
      if (branch) {
        await saveState(context, branch);
      } else {
        vscode.window.showErrorMessage('Unable to determine current Git branch.');
      }
    }),
    vscode.commands.registerCommand('branchesWithFiles.restoreState', async () => {
      const branch = await getCurrentBranch();
      if (branch) {
        await restoreState(context, branch);
      } else {
        vscode.window.showErrorMessage('Unable to determine current Git branch.');
      }
    }),
    vscode.commands.registerCommand('branchesWithFiles.clearAllState', async () => {
      await clearAllState(context);
    })
  );
}

export function deactivate() {}