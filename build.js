const esbuild = require('esbuild');

// Define common build options shared between build and watch
const buildOptions = {
    entryPoints: ['src/webview/main.js'], // Your webview script entry point
    outfile: 'dist/webview.js',       // Output bundle file
    bundle: true,                     // Bundle dependencies
    platform: 'browser',              // Target browser environment
    format: 'esm',                    // Output format (ES Module)
    external: ['vscode'],             // Exclude 'vscode' module
    logLevel: 'info',
    // Sourcemap and minify settings will be adjusted below based on mode
};

async function run() {
    const args = process.argv.slice(2);
    const isWatch = args.includes('--watch');

    try {
        if (isWatch) {
            // --- Watch Mode ---
            console.log("Starting esbuild in watch mode...");

            // Create a context for watching
            const context = await esbuild.context({
                ...buildOptions,
                sourcemap: true, // Enable sourcemaps for easier debugging in watch mode
                minify: false,   // Disable minification in watch mode for faster rebuilds
                plugins: [{      // Optional: Add a plugin for logging rebuilds
                    name: 'watch-logger',
                    setup(build) {
                        let count = 0;
                        build.onEnd(result => {
                            if (result.errors.length > 0) {
                                console.error(`Watch build failed [${++count}]:`, result.errors);
                            } else {
                                console.log(`Watch build succeeded [${++count}]`); // result.warnings can be checked too
                            }
                        });
                    }
                }]
            });

            // Start watching
            await context.watch();
            console.log("Watching for changes... Press Ctrl+C to stop.");

        } else {
            // --- One-off Build Mode ---
            console.log("Starting esbuild build...");

            // Perform a single build operation
            await esbuild.build({
                ...buildOptions,
                sourcemap: 'external', // Generate external sourcemaps for production build
                minify: true,          // Enable minification for production build
            });

            console.log("Build successful!");
        }
    } catch (err) {
        console.error("esbuild failed:", err);
        process.exit(1);
    }
}

// Execute the run function
run();