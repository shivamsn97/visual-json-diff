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
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media/')], // Allow access to the media folder
            }
        );

        const stylePath = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css'));

        // --- 4. Set the HTML content for the webview ---
        panel.webview.html = getWebviewContent(leftContentJson, rightContentJson, stylePath.toString());

        context.subscriptions.push(panel); // Add panel to subscriptions for cleanup
    });

    context.subscriptions.push(disposable);
}

// This function generates the HTML content for the webview
function getWebviewContent(leftJson: object, rightJson: object, stylePath: string) {
    // Safely stringify JSON data to embed it in the script tag
    const leftJsonString = JSON.stringify(leftJson);
    const rightJsonString = JSON.stringify(rightJson);

    // Use the HTML structure provided, injecting the JSON data and custom styles
	return `
<!doctype html>
<html lang="en">

<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>JSON Diff</title>
	<link rel="stylesheet" href="https://esm.sh/jsondiffpatch@0.6.0/lib/formatters/styles/html.css" type="text/css" />
	<link rel="stylesheet" href="${stylePath}" type="text/css" />
</head>

<body>
	<header>
		<h3>Visual JSON Diff</h3>
		<button id="toggle-unchanged">Show unchanged values</button>
	</header>
	<p id="visualdiff">Diff Loading</p>

	<script type="module">
		import * as jsondiffpatch from 'https://esm.sh/jsondiffpatch@0.6.0';
		import * as htmlFormatter from 'https://esm.sh/jsondiffpatch@0.6.0/formatters/html';

		let left, right, delta;
		try {
			left = JSON.parse(${JSON.stringify(leftJsonString)});
			right = JSON.parse(${JSON.stringify(rightJsonString)});

			const dom = {
				runScriptTags: (el) => {
					const scripts = el.querySelectorAll("script");
					for (const s of scripts) {
						// biome-ignore lint/security/noGlobalEval: this is used to adjust move arrows
						eval(s.innerHTML);
					}
				},
			};

			const objectHash = (obj, index) => {
				if (typeof obj === "object" && obj !== null) {
					if (obj._id) return obj._id;
					if (obj.id) return obj.id;
					if (obj.key) return obj.key;
					if (obj.name) return obj.name;
				}
				return \`\$\$index:\${index}\`;
			}

			const jsondiffpatchInstance = jsondiffpatch.create({
				objectHash: objectHash,
				arrays: { detectMove: true, includeValueOnMove: false },
				propertyFilter: (name) => name[0] !== '$',
				cloneDiffValues: false,
            	omitRemovedValues: false,
			});

			delta = jsondiffpatchInstance.diff(left, right);

			const visualDiv = document.getElementById('visualdiff');
			if (delta) {
				visualDiv.innerHTML = htmlFormatter.format(delta, left);
				htmlFormatter.hideUnchanged();
				dom.runScriptTags(visualdiff);
			} else {
				visualDiv.innerHTML = '<p>Files are identical.</p>';
			}

			const toggleButton = document.getElementById('toggle-unchanged');
			let showingUnchanged = false;

			toggleButton.addEventListener('click', () => {
				if (!delta) {
					console.warn("No delta to toggle. Exiting.");
					return;
				}
				showingUnchanged = !showingUnchanged;
				if (showingUnchanged) {
					htmlFormatter.showUnchanged();
					toggleButton.textContent = 'Hide unchanged values';
					dom.runScriptTags(visualdiff);

				} else {
					htmlFormatter.hideUnchanged();
					toggleButton.textContent = 'Show unchanged values';
					dom.runScriptTags(visualdiff);
				}
			});
		} catch (e) {
			console.error("Error processing JSON diff in webview:", e);
			const visualDiv = document.getElementById('visualdiff');
			if (visualDiv) {
				visualDiv.innerHTML = '<p style="color: red;">Error displaying diff. Check console (Developer Tools) for details.</p>';
			}
		}
	</script>
</body>

</html>
`;
}

// This method is called when your extension is deactivated
export function deactivate() { }