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

        if (!resourceUri.fsPath.toLowerCase().endsWith('.json')) {
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
                // localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );

        // --- 4. Set the HTML content for the webview ---
        panel.webview.html = getWebviewContent(leftContentJson, rightContentJson);

        context.subscriptions.push(panel); // Add panel to subscriptions for cleanup
    });

    context.subscriptions.push(disposable);
}

// This function generates the HTML content for the webview
function getWebviewContent(leftJson: object, rightJson: object): string {
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
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, segoe ui, Roboto, Ubuntu,
				Arial, sans-serif, apple color emoji;
			min-width: 600px;
		}

		header {
			display: flex;
			justify-content: space-between;
		}

		header>div {
			position: relative;
			padding: 1rem 1rem 0 1rem;
		}

		h1 {
			font-size: 2em;
			font-weight: 700;
			margin: 4px;
		}

		#diffed-h1 {
			position: absolute;
			left: 1rem;
			margin: 4px;
			font-size: 2em;
			font-weight: bold;
		}

		header>nav {
			display: flex;
			gap: 8px;
			align-items: center;
			padding-right: 100px;
		}

		header>div>* {
			display: inline-block;
		}

		#description {
			margin-left: 10px;
			font-size: x-large;
		}

		#external-link {
			font-size: smaller;
			vertical-align: top;
			margin-top: 10px;
		}

		h2 {
			font-size: 1.5em;
			font-weight: 700;
			display: inline-block;
			margin: 0.3rem 0;
		}

		section h2 {
			margin: 15px 20px;
		}

		section .tabs {
			font-size: 1em;
			font-weight: 700;
			display: inline-block;
			margin: 0.3rem 0;
		}

		a#fork_me {
			position: absolute;
			top: 0;
			right: 0;
		}

		.json-input h2 {
			font-family: monospace;
		}

		.json-input>div {
			float: left;
			width: 50%;
		}

		.json-input>div {
			text-align: center;
		}

		.CodeMirror {
			text-align: initial;
			border: 1px solid #ccc;
		}

		.json-input>div>textarea {
			width: 95%;
			height: 200px;
		}

		.reformat {
			font-weight: bold;
			font-size: smaller;
			margin-left: 5px;
			height: 1.5rem;
			width: 1.5rem;
			vertical-align: baseline;
		}

		.editors-toolbar {
			width: 100%;
			text-align: center;
			height: 0.5rem;
			transition: all 0.3s ease-in-out;
		}

		.editors-toolbar>div {
			margin: 0 auto;
		}

		@media screen and (max-width: 956px) {

			/* avoid the toolbar overlapping with left/right header */
			.editors-toolbar {
				margin-bottom: 2.4rem;
			}
		}

		.json-error {
			background: #ffdfdf;
			-webkit-transition: all 1s;
			transition: all 1s;
		}

		.error-message {
			font-weight: bold;
			color: red;
			font-size: smaller;
			min-height: 20px;
			display: block;
		}

		.header-options {
			font-weight: normal;
			margin-left: 30px;
			display: inline-block;
		}

		#delta-panel-visual {
			width: 100%;
			overflow: auto;
		}

		#visualdiff {
			margin-top: 4px;
		}

		#json-delta,
		#jsonpatch {
			font-family: "Bitstream Vera Sans Mono", "DejaVu Sans Mono", Monaco, Courier,
				monospace;
			font-size: 12px;
			margin: 0;
			padding: 0;
			width: 100%;
			height: 200px;
		}

		#delta-panel-json>p,
		#delta-panel-jsonpatch>p {
			margin: 4px;
		}

		#features {
			margin: 6rem 0;
		}

		#features li {
			margin: 0.7rem;
		}

		footer {
			font-size: small;
			text-align: center;
			margin: 40px;
		}

		footer p {
			margin: 0 0 1rem 0;
		}

		.library-link {
			font-family: monospace;
			text-decoration: none;
		}

		.library-link:hover {
			text-decoration: underline;
		}

		a {
			color: inherit;
		}

		a:hover {
			text-decoration: underline;
		}

		#results .tabs {
			margin-bottom: 0.2rem;
		}

		.delta-panel {
			display: none;
		}

		[data-delta-type="visual"] #delta-panel-visual {
			display: block;
		}

		[data-delta-type="json"] #delta-panel-json {
			display: block;
		}

		[data-delta-type="annotated"] #delta-panel-annotated {
			display: block;
		}

		[data-delta-type="jsonpatch"] #delta-panel-jsonpatch {
			display: block;
		}

		[data-diff="no-diff"] .header-options {
			display: none;
		}

		[data-diff="no-diff"] #delta-panel-visual,
		[data-diff="no-diff"] #delta-panel-annotated {
			padding: 1rem 1.3rem;
			font-size: larger;
			font-family: monospace;
		}

		html,
		body {
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}


		button#color-scheme-toggle {
			position: relative;
			width: 24px;
			height: 24px;
			appearance: none;
			border: none;
			background-color: transparent;
			color: inherit;
			cursor: pointer;
			border-radius: 100%;
			transition: all 0.5s;
			box-shadow: transparent 0 0 1px;
		}

		button#color-scheme-toggle:hover {
			box-shadow: black 0 0 15px;
		}

		body.vscode-dark button#color-scheme-toggle:hover {
			box-shadow: white 0 0 15px;
		}

		body.vscode-dark {

			.jsondiffpatch-added .jsondiffpatch-property-name,
			.jsondiffpatch-added .jsondiffpatch-value pre,
			.jsondiffpatch-modified .jsondiffpatch-right-value pre,
			.jsondiffpatch-textdiff-added {
				background: #00601e;
			}

			.jsondiffpatch-deleted .jsondiffpatch-property-name,
			.jsondiffpatch-deleted pre,
			.jsondiffpatch-modified .jsondiffpatch-left-value pre,
			.jsondiffpatch-textdiff-deleted {
				background: #590000;
			}

			.jsondiffpatch-moved .jsondiffpatch-moved-destination {
				background: #373900;
			}

			.jsondiffpatch-annotated-delta tr:hover {
				background: rgba(255, 255, 155, 0.5);
			}
		}

		pre {
			background-color: transparent;
			color: inherit;
			font-family: monospace;
			white-space: pre-wrap;
			word-wrap: normal;
			overflow: visible;
		}

		.content {
			pre.terminal {
				white-space: pre-line;
				margin: 1rem;
				padding: 0 1rem;
				border-radius: 0.3rem;
				background-color: #111;
				max-width: 60rem;
				color: white;
			}
		}
	</style>
</head>

<body>
	<h3>Visual JSON Diff</h3>
	<p id="visualdiff">Diff Loading</p>


	<script type="module">
		// Use ESM build from CDN for jsondiffpatch and its HTML formatter
		import * as jsondiffpatch from 'https://esm.sh/jsondiffpatch@0.6.0';
		import * as htmlFormatter from 'https://esm.sh/jsondiffpatch@0.6.0/formatters/html';

		let left, right, delta;
		try {
			// Parse the embedded JSON strings passed from the extension
			left = JSON.parse(${ JSON.stringify(leftJsonString) });
			right = JSON.parse(${ JSON.stringify(rightJsonString) });

			const dom = {
				runScriptTags: (el) => {
					const scripts = el.querySelectorAll("script");
					for (const s of scripts) {
						// biome-ignore lint/security/noGlobalEval: this is used to adjust move arrows
						eval(s.innerHTML);
					}
				},
			};

			// Create JsonDiffPatch instance
			const jsondiffpatchInstance = jsondiffpatch.create({
				objectHash: (obj, index) => {
					if (typeof obj === "object" && obj !== null) {
						const objRecord = obj;
						if (typeof objRecord._id !== "undefined") {
							return objRecord._id;
						}
						if (typeof objRecord.id !== "undefined") {
							return objRecord.id;
						}
						if (typeof objRecord.key !== "undefined") {
							return objRecord.key;
						}
						if (typeof objRecord.name !== "undefined") {
							return objRecord.name;
						}
					}
					return \`\$\$index:\${index}\`;
            },
            arrays: {
                detectMove: true,
                includeValueOnMove: false,
            },
            propertyFilter: function (name, context) {
                return name.slice(0, 1) !== '$';
            },
            cloneDiffValues: false,
            omitRemovedValues: false,
          });

          // Calculate the difference between the two JSON objects
          delta = jsondiffpatchInstance.diff(left, right);

          const visualDiv = document.getElementById('visualdiff');

          if (delta) {
            // Format the delta into HTML, passing 'left' to include unchanged values initially (though hidden by default css)
            visualDiv.innerHTML = htmlFormatter.format(delta, left);
            htmlFormatter.hideUnchanged();
            dom.runScriptTags(visualdiff);
          } else {
            // If delta is undefined, the files are identical
            visualDiv.innerHTML = '<p>Files are identical.</p>';
          }

      } catch(e) {
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