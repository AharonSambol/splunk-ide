(function () {
    try {
        document.addEventListener('keyup', function (event) {
            if (event.ctrlKey && event.key === '/') {
                event.preventDefault();

                try {




                    const el = document.querySelector('.ace_editor');
                    console.log("1");
                    if (!el || !el.env || !el.env.editor) {
                        return;
                    }
                    console.log("2");

                    const editor = el.env.editor;

                    const selection = editor.getSelection();
                    const range = selection.getRange();

                    const startRow = range.start.row;
                    let endRow = range.end.row;
                    if (range.end.column === 0 && endRow > startRow) {
                        endRow -= 1;
                    }

                    const lines = editor.session.getLines(startRow, endRow);
                    const addingComment = !lines.every(line => {
                        const trimmedLine = line.trim();
                        return trimmedLine.length === 0 || (trimmedLine.startsWith('```') && trimmedLine.endsWith('```'));
                    })

                    const newLines = lines.map(line => {
                        const trimmedLine = line.trim();
                        if (trimmedLine === '') {
                            return line;
                        } else if (addingComment) {
                            return '``` ' + line.replaceAll("```", "``````") + ' ```';
                        } else {
                            const startPadding = line.match(/^\s*/)[0];
                            const endPadding = line.match(/\s*$/)[0];
                            let newLine = startPadding + trimmedLine.substring(3, trimmedLine.length - 3).replaceAll("``````", "```") + endPadding;
                            if (newLine.length > 0 && newLine[0] == " ") {
                                newLine = newLine.substring(1);
                            }
                            if (newLine.length > 0 && newLine[newLine.length - 1] == " ") {
                                newLine = newLine.substring(0, newLine.length - 1);
                            }
                            return newLine;
                        }
                    });
                    const firstRowUntilSelection = lines[0].substring(0, range.start.column);
                    const lastRowUntilSelection = lines[lines.length - 1].substring(0, range.end.column);
                    const startSelectionGrowth = (addingComment
                        ? 3 + (firstRowUntilSelection.match(/```/g) || []).length * 3
                        : -3 - (firstRowUntilSelection.match(/`{6}/g) || []).length * 3
                    );
                    const endSelectionGrowth = (addingComment
                        ? 3 + (lastRowUntilSelection.match(/```/g) || []).length * 3
                        : -3 - (lastRowUntilSelection.match(/`{6}/g) || []).length * 3
                    );

                    const Range = editor.getSelection().getRange().constructor;
                    const replaceRange = new Range(startRow, 0, endRow, editor.session.getLine(endRow).length);
                    editor.session.replace(replaceRange, newLines.join('\n'));

                    // Re-select the modified lines
                    const newRange = new Range(startRow, range.start.column + startSelectionGrowth, endRow, range.end.column + endSelectionGrowth);
                    selection.setRange(newRange);
                } catch (e) {
                    console.error('Splunk Comment Error:', e);
                }
            }
        })
    } catch (e) {
        console.error('Failed to inject script:', e);
    }
})();