# Visual JSON Diff

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/shivamsn97.visual-json-diff.svg)](https://marketplace.visualstudio.com/items?itemName=shivamsn97.visual-json-diff)
[![GitHub](https://img.shields.io/github/stars/shivamsn97/visual-json-diff?style=social)](https://github.com/shivamsn97/visual-json-diff)

Visual JSON Diff is a Visual Studio Code extension that provides a visual diff for modified JSON files in Source Control. Effortlessly identify changes in your JSON files with an intuitive, side-by-side visual interface.

---

## Features

- **Visual Diff for JSON**: See changes in JSON files with a clear, interactive UI.
- **Source Control Integration**: Right-click modified JSON files in the Source Control panel to launch the visual diff.
- **Compare Any Two Files**: Search for `Show Visual Diff` in the command palette, select two files and easily view the visual diff.
- **Custom Object Hashing**: Configure which object keys are used to match objects during diffing for more meaningful comparisons.

---

## Getting Started

1. **Install** the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=shivamsn97.visual-json-diff).
2. **Open a JSON file** in your workspace, or select two JSON files to compare.
3. **Use the Command Palette** (`Ctrl+Shift+P` or `Cmd+Shift+P`) and search for `Show Visual Diff` to launch the diff viewer.
4. **Or**, right-click a modified JSON file in the Source Control panel or Explorer and select **Show Visual Diff**.

---

## Usage

### Compare Modified Files in Source Control

1. Make changes to a `.json` or `.jsonc` file tracked by Git.
2. In the Source Control panel, right-click the file and select **Show Visual Diff**.

### Compare Any Two Files

1. Open the Command Palette and run **Show Visual Diff**.
2. Select two JSON or JSONC files in the Explorer.

---

## Extension Settings

You can customize how objects are matched during diffing by configuring the following setting:

```json
"visual-json-diff.objectHashKeys": [
    "_id",
    "id",
    "key",
    "name"
]
```

- **Description**: An array of property names to use for identifying objects when diffing. The first matching property found (and not null/undefined) will be used as the object's hash. Order matters.

---

## Requirements

- Visual Studio Code **v1.80.0** or higher

---

## Contributing

Contributions are welcome! Please see the [GitHub repository](https://github.com/shivamsn97/visual-json-diff) for issues, feature requests, and pull requests.

---

## Resources

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

---

**Enjoy using Visual JSON Diff!**

