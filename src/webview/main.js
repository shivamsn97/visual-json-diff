import * as jsondiffpatch from 'jsondiffpatch';
import * as htmlFormatter from 'jsondiffpatch/formatters/html';

// DOM Elements
const visualDiv = document.getElementById('visualdiff');
const mainContent = document.querySelector('.main-content');
const minimapTrack = document.getElementById('minimap-track');
const minimapViewport = document.getElementById('minimap-viewport');

// Initial Data (from <script> tag in HTML)
const left = window.leftData;
const right = window.rightData;

let delta;
let showingUnchanged = false;
let isDraggingMinimap = false;
let dragStartY = 0;
let initialScrollTop = 0;

// --- Debounce function for performance ---
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}


// --- Minimap Logic ---
function populateMinimap() {
    if (!visualDiv || !minimapTrack || !mainContent || !minimapViewport) {
        console.warn("Minimap elements not found, skipping populateMinimap.");
        return;
    }
    minimapTrack.innerHTML = ''; // Clear previous blips

    const lines = visualDiv.querySelectorAll('ul.jsondiffpatch-node > li');

    const mainScrollHeight = mainContent.scrollHeight;
    const minimapTrackHeight = minimapTrack.clientHeight;

    if (mainScrollHeight === 0 || minimapTrackHeight === 0) {
        updateMinimapViewport(); // Still update viewport, it might need to be hidden/reset
        return;
    }

    const mainContentRect = mainContent.getBoundingClientRect(); // Cache for performance

    lines.forEach(line => {
        if (!line.offsetParent) { // Skip lines that are not currently rendered
            return;
        }

        const blip = document.createElement('div');
        blip.className = 'minimap-blip';
        let createBlip = false;

        if (line.classList.contains('jsondiffpatch-added')) {
            blip.classList.add('minimap-blip-added');
            createBlip = true;
        } else if (line.classList.contains('jsondiffpatch-deleted')) {
            blip.classList.add('minimap-blip-deleted');
            createBlip = true;
        } else if (line.classList.contains('jsondiffpatch-modified')) {
            blip.classList.add('minimap-blip-modified');
            createBlip = true;
        } else if (line.classList.contains('jsondiffpatch-moved') || line.classList.contains('jsondiffpatch-itemMovedFrom') || line.classList.contains('jsondiffpatch-itemMovedTo')) {
            blip.classList.add('minimap-blip-moved');
            createBlip = true;
        } else if (showingUnchanged && line.classList.contains('jsondiffpatch-unchanged')) {
            blip.classList.add('minimap-blip-unchanged');
            createBlip = true;
        }

        if (createBlip) {
            const lineRect = line.getBoundingClientRect();
            const lineScrollOffset = lineRect.top - mainContentRect.top + mainContent.scrollTop;

            const actualLineHeight = line.offsetHeight;
            let proportionalBlipHeight = (actualLineHeight / mainScrollHeight) * minimapTrackHeight;
            proportionalBlipHeight = Math.max(1, proportionalBlipHeight);
            proportionalBlipHeight = Math.min(proportionalBlipHeight, minimapTrackHeight);

            const proportionalTop = (lineScrollOffset / mainScrollHeight) * minimapTrackHeight;
            const clampedTop = Math.max(0, Math.min(proportionalTop, minimapTrackHeight - proportionalBlipHeight));

            blip.style.top = `${clampedTop}px`;
            blip.style.height = `${proportionalBlipHeight}px`;

            minimapTrack.appendChild(blip);
        }
    });
    updateMinimapViewport();
}

function updateMinimapViewport() {
    if (!mainContent || !minimapTrack || !minimapViewport) {
        if (minimapViewport) { minimapViewport.style.height = '0px'; }
        return;
    }

    const mainScrollHeight = mainContent.scrollHeight;
    const mainClientHeight = mainContent.clientHeight;
    const mainScrollTop = mainContent.scrollTop;
    const minimapTrackHeight = minimapTrack.clientHeight;

    if (mainScrollHeight === 0 || minimapTrackHeight === 0) {
        minimapViewport.style.height = '0px';
        minimapViewport.style.top = '0px';
        return;
    }

    const viewportHeightRatio = mainClientHeight / mainScrollHeight;
    let viewportHeight = viewportHeightRatio * minimapTrackHeight;

    viewportHeight = Math.max(viewportHeight, 20); // Min height of 20px
    viewportHeight = Math.min(viewportHeight, minimapTrackHeight); // Ensure it doesn't exceed track height

    const scrollTopRatio = mainScrollTop / mainScrollHeight;
    const viewportTop = scrollTopRatio * minimapTrackHeight;

    minimapViewport.style.height = `${viewportHeight}px`;
    minimapViewport.style.top = `${Math.max(0, Math.min(viewportTop, minimapTrackHeight - viewportHeight))}px`;
}


// --- Event Handlers for Minimap Interaction ---
if (minimapViewport) {
    minimapViewport.addEventListener('mousedown', (e) => {
        isDraggingMinimap = true;
        dragStartY = e.clientY;
        initialScrollTop = mainContent.scrollTop;
        minimapViewport.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none'; // Prevent text selection globally during drag
        e.preventDefault();
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isDraggingMinimap) { return; }
    if (!minimapTrack || !mainContent || !minimapViewport) { return; }

    const deltaY = e.clientY - dragStartY;
    const minimapTrackHeight = minimapTrack.clientHeight;
    const mainScrollHeight = mainContent.scrollHeight;
    const mainClientHeight = mainContent.clientHeight;

    if (minimapTrackHeight === 0) { return; }

    const scrollDelta = (deltaY / minimapTrackHeight) * mainScrollHeight;
    let newScrollTop = initialScrollTop + scrollDelta;

    const maxScrollPossible = Math.max(0, mainScrollHeight - mainClientHeight); // Max scrollTop value
    newScrollTop = Math.max(0, Math.min(newScrollTop, maxScrollPossible));

    if (mainContent.scrollTop !== newScrollTop) {
        mainContent.scrollTop = newScrollTop;
        updateMinimapViewport(); // Call directly for immediate feedback
    } else if (isDraggingMinimap && (newScrollTop === 0 || newScrollTop === maxScrollPossible)) {
        // If dragging at a boundary and scrollTop hasn't changed, still update viewport for sync
        updateMinimapViewport();
    }
});

document.addEventListener('mouseup', () => {
    if (isDraggingMinimap) {
        isDraggingMinimap = false;
        if (minimapViewport) { minimapViewport.style.cursor = 'grab'; }
        document.body.style.userSelect = '';
    }
});

if (minimapTrack) {
    minimapTrack.addEventListener('click', (e) => {
        if (!mainContent || !minimapViewport || !minimapTrack) {
            console.warn("Minimap or mainContent not available for click handling.");
            return;
        }
        // Prevent clicks on the viewport itself (which is handled by dragging)
        // or its children from triggering this track click logic.
        if (minimapViewport.contains(e.target) || e.target === minimapViewport) {
            // console.log("Minimap Click: Event target is minimapViewport or its child. Handled by drag.");
            return;
        }

        const minimapTrackRect = minimapTrack.getBoundingClientRect();
        // Calculate clickY relative to the minimapTrack's top edge
        const clickY = e.clientY - minimapTrackRect.top;

        const minimapTrackHeight = minimapTrack.clientHeight; // Or minimapTrackRect.height for consistency
        const mainScrollHeight = mainContent.scrollHeight;
        const mainClientHeight = mainContent.clientHeight;

        if (minimapTrackHeight === 0 || mainScrollHeight === 0) {
            console.log("Minimap track height or main scroll height is 0, aborting click scroll.");
            return;
        }

        let targetScrollTop = (clickY / minimapTrackHeight) * mainScrollHeight - (mainClientHeight / 2);
        // console.log(`Calculated targetScrollTop (pre-clamp): ${targetScrollTop}`);

        const maxScrollPossible = Math.max(0, mainScrollHeight - mainClientHeight);
        targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollPossible));

        // console.log(`Clamped targetScrollTop: ${targetScrollTop}`);
        mainContent.scrollTop = targetScrollTop;

        // For a more immediate visual update of the minimap viewport after click, uncomment the next line.
        // Otherwise, it relies on the debounced scroll event listener.
        // updateMinimapViewport(); 
    });
}


// --- Existing Diff Logic ---
try {
    if (!left || !right) {
        throw new Error("Initial data (leftData or rightData) not found on window object.");
    }
    if (!visualDiv) {
        throw new Error("The 'visualdiff' element was not found in the DOM.");
    }
    if (!mainContent) {
        throw new Error("The '.main-content' element was not found in the DOM.");
    }

    const dom = {
        runScriptTags: (el) => {
            if (!el) { return; }
            const scripts = el.querySelectorAll("script");
            for (const s of scripts) {
                try {
                    // biome-ignore lint/security/noGlobalEval: this is used to adjust move arrows
                    eval(s.innerHTML);
                } catch (scriptError) {
                    console.error("Error evaluating script tag in diff:", scriptError, s.innerHTML);
                }
            }
        },
    };

    const objectHash = (obj, index) => {
        if (typeof obj === "object" && obj !== null) {
            if (obj._id) { return obj._id; }
            if (obj.id) { return obj.id; }
            if (obj.key) { return obj.key; }
            if (obj.name) { return obj.name; }
        }
        return `$$index:${index}`;
    };

    const jsondiffpatchInstance = jsondiffpatch.create({
        objectHash: objectHash,
        arrays: { detectMove: true, includeValueOnMove: false },
        propertyFilter: (name) => name !== undefined && name !== null && String(name)[0] !== '$',
        cloneDiffValues: false,
    });

    delta = jsondiffpatchInstance.diff(left, right);

    if (delta) {
        visualDiv.innerHTML = htmlFormatter.format(delta, left);
        htmlFormatter.hideUnchanged();
        dom.runScriptTags(visualDiv);
    } else {
        visualDiv.innerHTML = '<p>Files are identical.</p>';
    }

    const toggleButton = document.getElementById('toggle-unchanged');
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            if (!delta && visualDiv.innerHTML.includes("Files are identical.")) {
                console.warn("No diff to toggle. Files are identical.");
                return;
            }
            if (!delta) {
                console.warn("No delta object available to toggle unchanged lines.");
                return;
            }
            showingUnchanged = !showingUnchanged;
            if (showingUnchanged) {
                htmlFormatter.showUnchanged();
                toggleButton.textContent = 'Hide unchanged values';
            } else {
                htmlFormatter.hideUnchanged();
                toggleButton.textContent = 'Show unchanged values';
            }

            // Run the scripts, which might affect layout
            dom.runScriptTags(visualDiv);
            console.log("dom.runScriptTags executed after toggle.");

            // Use a nested requestAnimationFrame to ensure DOM/layout is fully stable
            // before populating the minimap.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    console.log('[Toggle Before Populate - Nested rAF] mainContent.scrollHeight:', mainContent.scrollHeight, 'mainContent.clientHeight:', mainContent.clientHeight);
                    populateMinimap();
                    console.log('[Toggle After Populate - Nested rAF] mainContent.scrollHeight:', mainContent.scrollHeight);
                });
            });
        });
    } else {
        console.warn("Toggle button 'toggle-unchanged' not found.");
    }


    requestAnimationFrame(() => {
        populateMinimap();
    });

} catch (e) {
    console.error("Error processing JSON diff in webview:", e);
    if (visualDiv) {
        visualDiv.innerHTML = `<p style="color: red;">Error displaying diff: ${e.message || String(e)}. Check console.</p>`;
    }
}

if (mainContent) {
    mainContent.addEventListener('scroll', debounce(updateMinimapViewport, 16));
}

window.addEventListener('resize', debounce(() => {
    populateMinimap();
}, 100));

window.addEventListener('load', () => {
    requestAnimationFrame(() => {
        populateMinimap();
    });
});

if (typeof htmlFormatter.hideUnchanged !== 'function' || typeof htmlFormatter.showUnchanged !== 'function') {
    console.warn('jsondiffpatch HTML formatters hideUnchanged/showUnchanged might not be correctly available globally if needed by eval scripts.');
}