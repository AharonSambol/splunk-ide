function buildFileTree(fileList, folderList) {
    const root = { children: [], files: [] };
    const map = new Map();

    function ensureFolderNode(pathSegments) {
        let current = root;
        let accumulatedPath = '';

        for (const segment of pathSegments) {
            accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
            let folder = map.get(accumulatedPath);
            if (!folder) {
                folder = { name: segment, path: accumulatedPath, children: [], files: [] };
                map.set(accumulatedPath, folder);
                if (current === root) {
                    root.children.push(folder);
                } else {
                    current.children.push(folder);
                }
            }
            current = folder;
        }

        return current;
    }

    folderList.forEach(folderPath => {
        const segments = folderPath.split('/').map(segment => segment.trim()).filter(Boolean);
        if (segments.length > 0) {
            ensureFolderNode(segments);
        }
    });

    fileList.forEach(file => {
        const segments = file.name.split('/').map(segment => segment.trim()).filter(Boolean);
        if (segments.length === 0) {
            root.files.push({ ...file, displayName: file.name });
            return;
        }

        if (segments.length === 1) {
            root.files.push({ ...file, displayName: segments[0] });
            return;
        }

        const parentFolder = ensureFolderNode(segments.slice(0, -1));
        parentFolder.files.push({ ...file, displayName: segments[segments.length - 1] });
    });

    return root;
}

module.exports = { buildFileTree };
