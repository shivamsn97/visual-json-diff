import * as jsondiffpatch from 'jsondiffpatch';
import * as htmlFormatter from 'jsondiffpatch/formatters/html';

const left = window.leftData;
const right = window.rightData;

let delta;
try {
    if (!left || !right) {
        throw new Error("Initial data not found.");
    }

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
        propertyFilter: (name) => name[0] !== '$',
        cloneDiffValues: false,
        omitRemovedValues: false,
    });

    delta = jsondiffpatchInstance.diff(left, right);

    const visualDiv = document.getElementById('visualdiff');
    if (delta) {
        visualDiv.innerHTML = htmlFormatter.format(delta, left);
        htmlFormatter.hideUnchanged();
        dom.runScriptTags(visualDiv);
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
            dom.runScriptTags(visualDiv);

        } else {
            htmlFormatter.hideUnchanged();
            toggleButton.textContent = 'Show unchanged values';
            dom.runScriptTags(visualDiv);
        }
    });
} catch (e) {
    console.error("Error processing JSON diff in webview:", e);
    const visualDiv = document.getElementById('visualdiff');
    if (visualDiv) {
        visualDiv.innerHTML = '<p style="color: red;">Error displaying diff. Check console (Developer Tools) for details.</p>';
    }
}