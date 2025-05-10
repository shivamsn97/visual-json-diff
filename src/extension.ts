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
    // We might need more specific API later if 'show' isn't ideal,
    // but it's a good starting point for getting HEAD content.
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
                vscode.window.showErrorMessage("Could not get Git API. Please ensure Git is enabled.");
            }
        } else {
            console.error("vscode.git extension not found.");
            vscode.window.showErrorMessage("Visual JSON Diff requires the built-in Git extension.");
        }
    } catch (err) {
        console.error("Error activating Git extension or getting API:", err);
        vscode.window.showErrorMessage("An error occurred while initializing Git integration.");
    }

    // Register the command
    let disposable = vscode.commands.registerCommand('visual-json-diff.showDiff', async (resourceState: vscode.SourceControlResourceState | vscode.Uri | undefined) => {
        // --- 0. Get User Configuration ---
        const configuration = vscode.workspace.getConfiguration('visual-json-diff');
        let objectHashKeys = configuration.get<string[]>('objectHashKeys');

        // Fallback if the setting is somehow invalid or not an array
        if (!Array.isArray(objectHashKeys) || objectHashKeys.length === 0) {
            console.warn("Visual JSON Diff: 'objectHashKeys' setting is invalid or empty. Using default keys: ['_id', 'id', 'key', 'name']");
            objectHashKeys = ['_id', 'id', 'key', 'name'];
        }


        // --- 1. Get the URI of the selected file ---
        let resourceUri: vscode.Uri | undefined;

        if (resourceState instanceof vscode.Uri) {
            resourceUri = resourceState;
        } else if (resourceState?.resourceUri) {
            resourceUri = resourceState.resourceUri;
        }

        if (!resourceUri) {
            vscode.window.showErrorMessage('Could not determine the file to diff.');
            console.error("showDiff command triggered without valid resource state or URI.");
            return;
        }

        if (!resourceUri.fsPath.toLowerCase().endsWith('.json') && !resourceUri.fsPath.toLowerCase().endsWith('.jsonc')) {
            vscode.window.showWarningMessage('This command only works on JSON files.');
            return;
        }

        const fileName = path.basename(resourceUri.fsPath);
        console.log(`Attempting to show visual diff for: ${fileName}`);

        // --- 2. Get the content of the two versions (HEAD vs. Working File) ---
        let leftContentJson: object | null = null; // HEAD version (original)
        let rightContentJson: object | null = null; // Working directory version (modified)

        try {
            // Get current content (working directory)
            const rightContentBuffer = await vscode.workspace.fs.readFile(resourceUri);
            const rightContentStr = Buffer.from(rightContentBuffer).toString('utf8');
            try {
                rightContentJson = JSON.parse(rightContentStr);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to parse current JSON file: ${fileName}. Invalid JSON.`);
                console.error(`JSON Parse Error (Working Directory) for ${resourceUri.fsPath}:`, e);
                return;
            }

            // Get original content (from HEAD) using Git API
            if (!gitAPI) {
                vscode.window.showErrorMessage("Git API is not available. Cannot fetch original file version.");
                return;
            }

            const repo = gitAPI.getRepository(resourceUri);
            if (!repo) {
                vscode.window.showErrorMessage(`File ${fileName} is not part of an active Git repository.`);
                console.warn(`No Git repository found for URI: ${resourceUri.fsPath}`);
                return;
            }

            // Calculate relative path for the 'show' command
            const relativePath = path.relative(repo.rootUri.fsPath, resourceUri.fsPath).replace(/\\/g, '/'); // Git needs forward slashes

            try {
                // Fetch content from HEAD
                const leftContentStr = await repo.show('HEAD', relativePath);
                try {
                    leftContentJson = JSON.parse(leftContentStr);
                } catch (e) {
                    // It's possible HEAD version was invalid JSON, or file is newly added (show throws error)
                    // If it's a new file, show might throw. Let's treat it as an empty object diff.
                    console.warn(`Could not parse JSON from HEAD for ${relativePath}. It might be a new file or invalid JSON in HEAD. Treating as empty. Error:`, e);
                    leftContentJson = {}; // Diff against empty object if parsing fails or file is new
                }
            } catch (gitError: any) {
                // Handle specific case: file is newly added (not in HEAD)
                // Error might look like: "fatal: path '...' does not exist in 'HEAD'"
                if (gitError.message && /does not exist in/.test(gitError.message)) {
                    console.log(`File ${relativePath} is likely newly added. Diffing against empty object.`);
                    leftContentJson = {}; // Treat as diff against empty
                } else {
                    // Other Git error
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

        // Ensure we have both sides (even if one is empty for added files)
        if (leftContentJson === null || rightContentJson === null) {
            vscode.window.showErrorMessage(`Could not prepare data for diffing ${fileName}.`);
            console.error("Failed to get both left and right JSON content.");
            return;
        }


        // --- 3. Create and show the Webview Panel ---
        const panel = vscode.window.createWebviewPanel(
            'jsonDiffViewer', // Identifies the type of the webview. Used internally
            `Diff: ${fileName}`, // Title of the panel displayed to the user
            vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
            {
                enableScripts: true, // Allow scripts to run in the webview
                // Optionally, restrict domains
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'dist')
                ],
            }
        );

        const stylePath = vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css');
        const styleURI = panel.webview.asWebviewUri(stylePath);

        // Get URI for the bundled webview script
        const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js');
        const scriptUri = panel.webview.asWebviewUri(scriptPath);

        // --- 4. Set the HTML content for the webview ---
        panel.webview.html = getWebviewContent(panel, leftContentJson, rightContentJson, styleURI.toString(), scriptUri.toString(), objectHashKeys);

        context.subscriptions.push(panel); // Add panel to subscriptions for cleanup
    });

    context.subscriptions.push(disposable);
}

function getWebviewContent(panel: vscode.WebviewPanel, leftJson: object, rightJson: object, stylePath: string, scriptPath: string, objectHashKeys: string[]) {
    const leftJsonString = JSON.stringify(leftJson);
    const rightJsonString = JSON.stringify(rightJson);

    const nonce = getNonce();

    // Use the HTML structure provided, injecting the JSON data and custom styles
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
                {/* Minimap content (blips) will be generated here by JS */}
            </div>
            <div id="minimap-viewport"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        window.leftData = JSON.parse(${JSON.stringify(leftJsonString)});
        window.rightData = JSON.parse(${JSON.stringify(rightJsonString)});
        window.objectHashKeysConfig = ${JSON.stringify(objectHashKeys)}; // Pass keys to window
        // If needed later: const vscode = acquireVsCodeApi(); window.vscode = vscode;
    </script>
    <script type="module" src="${scriptPath}" nonce="${nonce}"></script>
</body>

</html>
`;
}

// This method is called when your extension is deactivated
export function deactivate() { }

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}