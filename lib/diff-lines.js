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
    return lines.map(line => {
        const escaped = escapeHtml(line.text);
        if (line.type === 'added') {
            return `<span class="diff-line diff-added">+ ${escaped}</span>`;
        }
        if (line.type === 'removed') {
            return `<span class="diff-line diff-removed">- ${escaped}</span>`;
        }
        return `<span class="diff-line diff-same">  ${escaped}</span>`;
    }).join('\n');
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = { diffLines, renderDiffHtml };
