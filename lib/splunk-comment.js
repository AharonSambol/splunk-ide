function isCommentedLine(line) {
    const trimmedLine = line.trim();
    return trimmedLine.length === 0 || (trimmedLine.startsWith('```') && trimmedLine.endsWith('```'));
}

function shouldAddComment(lines) {
    return !lines.every(isCommentedLine);
}

function toggleCommentLine(line, addingComment) {
    const trimmedLine = line.trim();
    if (trimmedLine === '') {
        return line;
    }

    if (addingComment) {
        return '``` ' + line.replaceAll('```', '``````') + ' ```';
    }

    const startPadding = line.match(/^\s*/)[0];
    const endPadding = line.match(/\s*$/)[0];
    let newLine = startPadding + trimmedLine.substring(3, trimmedLine.length - 3).replaceAll('``````', '```') + endPadding;
    if (newLine.length > 0 && newLine[0] === ' ') {
        newLine = newLine.substring(1);
    }
    if (newLine.length > 0 && newLine[newLine.length - 1] === ' ') {
        newLine = newLine.substring(0, newLine.length - 1);
    }
    return newLine;
}

function toggleCommentLines(lines) {
    const addingComment = shouldAddComment(lines);
    return lines.map(line => toggleCommentLine(line, addingComment));
}

module.exports = {
    isCommentedLine,
    shouldAddComment,
    toggleCommentLine,
    toggleCommentLines,
};
