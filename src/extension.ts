import * as vscode from "vscode"
import * as path from "path"
import * as child_process from "child_process"
import { promisify } from "util"

const execAsync = promisify(child_process.exec)

interface BranchState {
  files: string[]
}

let currentBranch: string | null = null

function getAllOpenFiles(): string[] {
  const openFiles = new Set<string>()

  const shouldIncludeFile = (filePath: string): boolean => {
    const parts = filePath.split(path.sep)
    return !parts.some((part) => part.startsWith("."))
  }

  vscode.window.visibleTextEditors.forEach((editor) => {
    if (
      editor.document.uri.scheme === "file" &&
      shouldIncludeFile(editor.document.fileName)
    ) {
      openFiles.add(editor.document.fileName)
    }
  })

  vscode.workspace.textDocuments.forEach((doc) => {
    if (doc.uri.scheme === "file" && shouldIncludeFile(doc.fileName)) {
      openFiles.add(doc.fileName)
    }
  })

  return Array.from(openFiles)
}

async function saveState(context: vscode.ExtensionContext, branch: string) {
  const openFiles = getAllOpenFiles()
  console.log(`Saving state for branch '${branch}'. Open files:`, openFiles)

  if (openFiles.length > 0) {
    const branchStates = context.workspaceState.get<
      Record<string, BranchState>
    >("branchStates", {})
    branchStates[branch] = { files: openFiles }
    await context.workspaceState.update("branchStates", branchStates)
    console.log(
      `Saved state for branch '${branch}' (${openFiles.length} files).`
    )

    const message = `Saved state for branch '${branch}' (${openFiles.length} files).`
    vscode.window
      .showInformationMessage(message, "Show Files")
      .then((selection) => {
        if (selection === "Show Files") {
          showFileList(branch, openFiles)
        }
      })
  } else {
    vscode.window.showInformationMessage(
      `No open files to save for branch '${branch}'.`
    )
  }
}

async function restoreState(context: vscode.ExtensionContext, branch: string) {
  const branchStates = context.workspaceState.get<Record<string, BranchState>>(
    "branchStates",
    {}
  )
  console.log("Current branchStates:", branchStates)
  const state = branchStates[branch]
  if (state && state.files.length > 0) {
    console.log(
      `Restoring state for branch '${branch}'. Files to open:`,
      state.files
    )
    await vscode.commands.executeCommand("workbench.action.closeAllEditors")
    for (const filePath of state.files) {
      try {
        const doc = await vscode.workspace.openTextDocument(filePath)
        await vscode.window.showTextDocument(doc, { preview: false })
        console.log(`Opened file: ${filePath}`)
      } catch (error) {
        console.error(`Failed to open file ${filePath}: ${error}`)
        vscode.window.showWarningMessage(`Failed to open file: ${filePath}`)
      }
    }

    const message = `Restored state for branch '${branch}' (${state.files.length} files).`
    vscode.window
      .showInformationMessage(message, "Show Files")
      .then((selection) => {
        if (selection === "Show Files") {
          showFileList(branch, state.files)
        }
      })
  } else {
    vscode.window.showInformationMessage(
      `No saved state found for branch '${branch}'.`
    )
  }
}

function showFileList(branch: string, files: string[]) {
  const outputChannel = vscode.window.createOutputChannel("Branches With Files")
  outputChannel.clear()
  outputChannel.appendLine(`Files for branch '${branch}' (${files.length}):`)
  files.forEach((file, index) => {
    outputChannel.appendLine(`${index + 1}. ${file}`)
  })
  outputChannel.show(true)
}

async function getCurrentBranch(): Promise<string | null> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folder found")
    }

    const rootPath = workspaceFolders[0].uri.fsPath
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: rootPath,
    })
    return stdout.trim()
  } catch (error) {
    console.error("Error getting current branch:", error)
    vscode.window.showErrorMessage("Failed to get current Git branch.")
    return null
  }
}

async function handleBranchChange(
  context: vscode.ExtensionContext,
  newBranch: string
) {
  console.log(
    `Handling branch change. Current: ${currentBranch}, New: ${newBranch}`
  )
  if (currentBranch && currentBranch !== newBranch) {
    await saveState(context, currentBranch)
  }
  if (newBranch !== currentBranch) {
    currentBranch = newBranch
    await restoreState(context, newBranch)
  }
}

export async function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage(
    "Activating Branches With Files extension"
  )

  // Initial branch detection
  currentBranch = await getCurrentBranch()
  if (currentBranch) {
    vscode.window.showInformationMessage(`Initial branch: ${currentBranch}`)
    await restoreState(context, currentBranch)
  }

  // Set up Git extension API listener
  const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports
  if (gitExtension) {
    const git = gitExtension.getAPI(1)
    git.onDidOpenRepository(async (repository) => {
      const newBranch = await getCurrentBranch()
      if (newBranch) {
        await handleBranchChange(context, newBranch)
      }
    })

    git.repositories.forEach((repository) => {
      repository.state.onDidChange(async () => {
        const newBranch = await getCurrentBranch()
        if (newBranch && newBranch !== currentBranch) {
          await handleBranchChange(context, newBranch)
        }
      })
    })
  }

  // Set up file system watcher for .git/HEAD
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath
    const gitHeadPath = path.join(rootPath, ".git", "HEAD")
    const fileSystemWatcher =
      vscode.workspace.createFileSystemWatcher(gitHeadPath)

    fileSystemWatcher.onDidChange(async () => {
      const newBranch = await getCurrentBranch()
      if (newBranch && newBranch !== currentBranch) {
        await handleBranchChange(context, newBranch)
      }
    })

    context.subscriptions.push(fileSystemWatcher)
  }

  // Manual commands (optional, for debugging or manual control)
  const saveStateCommand = vscode.commands.registerCommand(
    "branchesWithFiles.saveState",
    async () => {
      try {
        const branch = await getCurrentBranch()
        if (branch) {
          await saveState(context, branch)
        } else {
          throw new Error("Unable to determine the current Git branch.")
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Error saving state: ${error.message}`)
      }
    }
  )

  const restoreStateCommand = vscode.commands.registerCommand(
    "branchesWithFiles.restoreState",
    async () => {
      try {
        const branch = await getCurrentBranch()
        if (branch) {
          await restoreState(context, branch)
        } else {
          throw new Error("Unable to determine the current Git branch.")
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Error restoring state: ${error.message}`
        )
      }
    }
  )

  context.subscriptions.push(saveStateCommand, restoreStateCommand)
}

export function deactivate() {}
