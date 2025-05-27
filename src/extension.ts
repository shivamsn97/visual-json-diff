import * as vscode from 'vscode';
import * as path from 'path';

// Interface to interact with the built-in Git extension
interface GitExtension {
    getAPI(version: number): Promise<API>;
}

interface API {
    repositories: Repository[];
    getRepository(uri: vscode.Uri): Repository | null;
}

interface Repository {
    rootUri: vscode.Uri;
    // Function to get the content of a file from a specific commit (e.g., HEAD)
    show(ref: string, filePath: string): Promise<string>;
}

// Main activation function
export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "visual-json-diff" is now active!');

    // Get the Git Extension API
    let gitAPI: API | undefined;
    try {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (gitExtension) {
            await gitExtension.activate(); // Ensure the Git extension is activated
            gitAPI = await gitExtension.exports.getAPI(1);
            if (!gitAPI) {
                console.error("Could not get Git API version 1.");
                // Non-blocking error, as diffing two selected files doesn't require Git.
                // vscode.window.showErrorMessage("Could not get Git API. Git-related diffs may not work.");
            }
        } else {
            console.error("vscode.git extension not found.");
            // Non-blocking error.
            // vscode.window.showInformationMessage("Visual JSON Diff: Git extension not found. Git-related diffs will not be available.");
        }
    } catch (err) {
        console.error("Error activating Git extension or getting API:", err);
        // vscode.window.showErrorMessage("An error occurred while initializing Git integration.");
    }

    // Register the command
    let disposable = vscode.commands.registerCommand('visual-json-diff.showDiff', async (resourceState: vscode.SourceControlResourceState | vscode.Uri | undefined) => {
        // --- 0. Get User Configuration ---
        const configuration = vscode.workspace.getConfiguration('visual-json-diff');
        let objectHashKeys = configuration.get<string[]>('objectHashKeys');

        if (!Array.isArray(objectHashKeys) || objectHashKeys.length === 0) {
            console.warn("Visual JSON Diff: 'objectHashKeys' setting is invalid or empty. Using default keys: ['_id', 'id', 'key', 'name']");
            objectHashKeys = ['_id', 'id', 'key', 'name'];
        }

        let leftContentJson: object | null = null;
        let rightContentJson: object | null = null;
        let panelTitleBase: string;

        // --- 1. Determine if a file context is available or if we need to prompt ---
        let resourceUri: vscode.Uri | undefined;
        if (resourceState instanceof vscode.Uri) {
            resourceUri = resourceState;
        } else if (resourceState?.resourceUri) {
            resourceUri = resourceState.resourceUri;
        }

        if (resourceUri) {
            // SCENARIO 1: File context is available (e.g., from SCM view or Explorer right-click)
            if (!resourceUri.fsPath.toLowerCase().endsWith('.json') && !resourceUri.fsPath.toLowerCase().endsWith('.jsonc')) {
                vscode.window.showWarningMessage('This command only works on JSON or JSONC files when launched from the explorer or SCM.');
                return;
            }
            panelTitleBase = path.basename(resourceUri.fsPath);
            console.log(`Attempting to show visual diff for: ${panelTitleBase} (HEAD vs Working)`);

            try {
                // Get current content (working directory)
                const rightContentBuffer = await vscode.workspace.fs.readFile(resourceUri);
                const rightContentStr = Buffer.from(rightContentBuffer).toString('utf8');
                try {
                    rightContentJson = JSON.parse(rightContentStr);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to parse current JSON file: ${panelTitleBase}. Invalid JSON: ${e.message}`);
                    console.error(`JSON Parse Error (Working Directory) for ${resourceUri.fsPath}:`, e);
                    return;
                }

                // Get original content (from HEAD) using Git API
                if (!gitAPI) {
                    vscode.window.showErrorMessage("Git API is not available. Cannot fetch original file version from HEAD. Try selecting two files manually via the command palette.");
                    return;
                }

                const repo = gitAPI.getRepository(resourceUri);
                if (!repo) {
                    vscode.window.showErrorMessage(`File ${panelTitleBase} is not part of an active Git repository. Cannot determine previous version automatically.`);
                    console.warn(`No Git repository found for URI: ${resourceUri.fsPath}`);
                    return;
                }

                const relativePath = path.relative(repo.rootUri.fsPath, resourceUri.fsPath).replace(/\\/g, '/');

                try {
                    const leftContentStr = await repo.show('HEAD', relativePath);
                    try {
                        leftContentJson = JSON.parse(leftContentStr);
                    } catch (e: any) {
                        console.warn(`Could not parse JSON from HEAD for ${relativePath}. It might be a new file or invalid JSON in HEAD. Treating as empty. Error:`, e.message);
                        leftContentJson = {}; // Diff against empty object if parsing fails or file is new
                    }
                } catch (gitError: any) {
                    if (gitError.message && /does not exist in/.test(gitError.message)) {
                        console.log(`File ${relativePath} is likely newly added. Diffing against empty object.`);
                        leftContentJson = {}; // Treat as diff against empty
                    } else {
                        vscode.window.showErrorMessage(`Git error fetching original file: ${gitError.message || gitError}`);
                        console.error(`Git 'show' error for HEAD:${relativePath}:`, gitError);
                        return;
                    }
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Error reading file content: ${err.message || err}`);
                console.error(`Error processing file ${resourceUri.fsPath}:`, err);
                return;
            }
        } else {
            // SCENARIO 2: No file context (e.g., launched from Command Palette) - Prompt for two files
            console.log("Command triggered without file context. Prompting for two files.");

            const fileOpenOptions: vscode.OpenDialogOptions = {
                canSelectMany: false,
                openLabel: 'Select JSON/JSONC File',
                filters: {
                    'JSON files': ['json', 'jsonc']
                }
            };

            // Prompt for the first file (Left side of the diff)
            const file1Uris = await vscode.window.showOpenDialog({ ...fileOpenOptions, title: 'Select First JSON/JSONC File (e.g., Original/Left Side)' });
            if (!file1Uris || file1Uris.length === 0) {
                vscode.window.showInformationMessage('No first file selected. Diff operation cancelled.');
                return;
            }
            const file1Uri = file1Uris[0];

            // Prompt for the second file (Right side of the diff)
            const file2Uris = await vscode.window.showOpenDialog({ ...fileOpenOptions, title: 'Select Second JSON/JSONC File (e.g., Modified/Right Side)' });
            if (!file2Uris || file2Uris.length === 0) {
                vscode.window.showInformationMessage('No second file selected. Diff operation cancelled.');
                return;
            }
            const file2Uri = file2Uris[0];

            panelTitleBase = `${path.basename(file1Uri.fsPath)} vs ${path.basename(file2Uri.fsPath)}`;
            console.log(`Attempting to show visual diff for: ${panelTitleBase} (User Selected)`);

            try {
                // Read and parse the first file
                const file1ContentBuffer = await vscode.workspace.fs.readFile(file1Uri);
                const file1ContentStr = Buffer.from(file1ContentBuffer).toString('utf8');
                try {
                    leftContentJson = JSON.parse(file1ContentStr);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to parse first JSON file: ${path.basename(file1Uri.fsPath)}. Invalid JSON: ${e.message}`);
                    console.error(`JSON Parse Error for ${file1Uri.fsPath}:`, e);
                    return;
                }

                // Read and parse the second file
                const file2ContentBuffer = await vscode.workspace.fs.readFile(file2Uri);
                const file2ContentStr = Buffer.from(file2ContentBuffer).toString('utf8');
                try {
                    rightContentJson = JSON.parse(file2ContentStr);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to parse second JSON file: ${path.basename(file2Uri.fsPath)}. Invalid JSON: ${e.message}`);
                    console.error(`JSON Parse Error for ${file2Uri.fsPath}:`, e);
                    return;
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Error reading selected file(s): ${err.message || err}`);
                console.error(`Error processing selected files:`, err);
                return;
            }
        }

        // --- Common logic: Ensure we have both sides and then create Webview Panel ---
        if (leftContentJson === null || rightContentJson === null) {
            vscode.window.showErrorMessage(`Could not prepare data for diffing ${panelTitleBase}. One or both JSON objects were not loaded.`);
            console.error("Failed to get both left and right JSON content after processing. Left:", leftContentJson, "Right:", rightContentJson);
            return;
        }

        // --- Create and show the Webview Panel ---
        const panel = vscode.window.createWebviewPanel(
            'jsonDiffViewer', // Identifies the type of the webview. Used internally
            `Diff: ${panelTitleBase}`, // Title of the panel displayed to the user
            vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
            {
                enableScripts: true, // Allow scripts to run in the webview
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'dist')
                ],
            }
        );

        const stylePath = vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css');
        const styleURI = panel.webview.asWebviewUri(stylePath);

        const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js');
        const scriptUri = panel.webview.asWebviewUri(scriptPath);

        panel.webview.html = getWebviewContent(panel, leftContentJson, rightContentJson, styleURI.toString(), scriptUri.toString(), objectHashKeys);
        context.subscriptions.push(panel); // Add panel to subscriptions for cleanup
    });

    context.subscriptions.push(disposable);
}

// getWebviewContent function remains the same as in your original code
function getWebviewContent(panel: vscode.WebviewPanel, leftJson: object, rightJson: object, stylePath: string, scriptPath: string, objectHashKeys: string[]) {
    const leftJsonString = JSON.stringify(leftJson);
    const rightJsonString = JSON.stringify(rightJson);
    const nonce = getNonce();

    return `
<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${panel.webview.cspSource} 'unsafe-inline';
        img-src ${panel.webview.cspSource} https: data:;
        script-src 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' ${panel.webview.cspSource};
        font-src ${panel.webview.cspSource};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>JSON Diff</title>
	<link rel="stylesheet" href="${stylePath}" type="text/css" />
</head>
<body>
    <div class="container">
        <div class="main-content">
            <header>
                <h3>Visual JSON Diff</h3>
                <button id="toggle-unchanged">Show unchanged values</button>
            </header>
            <div id="visualdiff">Diff Loading</div>
        </div>
        <div id="minimap-container">
            <div id="minimap-track">
            </div>
            <div id="minimap-viewport"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        window.leftData = JSON.parse(${JSON.stringify(leftJsonString)});
        window.rightData = JSON.parse(${JSON.stringify(rightJsonString)});
        window.objectHashKeysConfig = ${JSON.stringify(objectHashKeys)};
    </script>
    <script type="module" src="${scriptPath}" nonce="${nonce}"></script>
</body>
</html>
`;
}

// deactivate function remains the same
export function deactivate() { }

// getNonce function remains the same
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}