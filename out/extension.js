"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
function activate(context) {
    let currentBranch = null;
    const saveState = vscode.commands.registerCommand('branchesWithFiles.saveState', async () => {
        const branch = await getCurrentBranch();
        if (branch) {
            const openFiles = vscode.window.visibleTextEditors.map(editor => editor.document.uri.fsPath);
            await context.workspaceState.update(branch, { files: openFiles });
            vscode.window.showInformationMessage(`Saved state for branch '${branch}'`);
        }
        else {
            vscode.window.showErrorMessage('Unable to determine the current Git branch.');
        }
    });
    const restoreState = vscode.commands.registerCommand('branchesWithFiles.restoreState', async () => {
        const branch = await getCurrentBranch();
        if (branch) {
            const state = context.workspaceState.get(branch);
            if (state && state.files.length > 0) {
                const documents = await Promise.all(state.files.map(file => vscode.workspace.openTextDocument(file)));
                for (const doc of documents) {
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
                vscode.window.showInformationMessage(`Restored state for branch '${branch}'`);
            }
            else {
                vscode.window.showInformationMessage(`No saved state for branch '${branch}'`);
            }
        }
        else {
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
    }
    else {
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
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
/**
 * Retrieves the current Git branch name.
 * @returns The name of the current branch, or null if not found.
 */
function getCurrentBranch() {
    return new Promise((resolve) => {
        (0, child_process_1.exec)('git rev-parse --abbrev-ref HEAD', (err, stdout, stderr) => {
            if (err || stderr) {
                resolve(null);
            }
            else {
                resolve(stdout.trim());
            }
        });
    });
}
//# sourceMappingURL=extension.js.map