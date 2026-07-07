/**
 * Simple line-based diff for SPL text comparison.
 * @param {string} before
 * @param {string} after
 * @returns {Array<{ type: 'same'|'added'|'removed', text: string }>}
 */
function diffLines(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    const m = a.length;
    const n = b.length;

    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const stack = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            stack.push({ type: 'same', text: a[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            stack.push({ type: 'added', text: b[j - 1] });
            j--;
        } else {
            stack.push({ type: 'removed', text: a[i - 1] });
            i--;
        }
    }

    return stack.reverse();
}

/**
 * @param {Array<{ type: string, text: string }>} lines
 * @returns {string} HTML-safe diff markup
 */
function renderDiffHtml(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.type === 'removed' && i + 1 < lines.length && lines[i + 1].type === 'added') {
            const inline = renderInlinePair(line.text, lines[i + 1].text);
            if (inline) {
                out.push(`<span class="diff-line diff-removed">- ${inline.removed}</span>`);
                out.push(`<span class="diff-line diff-added">+ ${inline.added}</span>`);
                i++;
                continue;
            }
        }
        out.push(renderWholeLine(line));
    }
    return out.join('\n');
}

function renderWholeLine(line) {
    const escaped = escapeHtml(line.text);
    if (line.type === 'added') {
        return `<span class="diff-line diff-added">+ ${escaped}</span>`;
    }
    if (line.type === 'removed') {
        return `<span class="diff-line diff-removed">- ${escaped}</span>`;
    }
    return `<span class="diff-line diff-same">  ${escaped}</span>`;
}

function tokenize(text) {
    return text.match(/\S+|\s+/g) || [];
}

function diffTokens(before, after) {
    const a = tokenize(before);
    const b = tokenize(after);
    const m = a.length;
    const n = b.length;

    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const stack = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
            stack.push({ type: 'same', text: a[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            stack.push({ type: 'added', text: b[j - 1] });
            j--;
        } else {
            stack.push({ type: 'removed', text: a[i - 1] });
            i--;
        }
    }

    return stack.reverse();
}

function renderInlinePair(before, after) {
    const parts = diffTokens(before, after);
    const hasSharedToken = parts.some(part => part.type === 'same' && /\S/.test(part.text));
    const hasInlineChange = parts.some(part => part.type === 'removed' || part.type === 'added');
    if (!hasSharedToken || !hasInlineChange) {
        return null;
    }

    return {
        removed: buildInlineHtml(parts, 'removed'),
        added: buildInlineHtml(parts, 'added'),
    };
}

function buildInlineHtml(parts, side) {
    return parts.map(part => {
        if (side === 'removed' && part.type === 'added') {
            return '';
        }
        if (side === 'added' && part.type === 'removed') {
            return '';
        }
        const escaped = escapeHtml(part.text);
        if (part.type === 'same') {
            return escaped;
        }
        if (part.type === 'removed') {
            return `<span class="diff-removed">${escaped}</span>`;
        }
        return `<span class="diff-added">${escaped}</span>`;
    }).join('');
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = { diffLines, renderDiffHtml };
