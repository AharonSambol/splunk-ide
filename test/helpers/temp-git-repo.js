const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');

/**
 * Create a temp git repo with optional initial .spl file content.
 * @param {string} [relativePath='queries/main.spl']
 * @param {string} [content] - .spl file content (URL or SPL text)
 * @returns {Promise<{ repoPath: string, git: import('simple-git').SimpleGit, relativePath: string }>}
 */
async function createTempGitRepo(relativePath = 'queries/main.spl', content) {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-qv-'));
    const git = simpleGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    if (content !== undefined) {
        const absolutePath = path.join(repoPath, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, content, 'utf8');
    }

    return { repoPath, git, relativePath };
}

/**
 * Write or overwrite a .spl file inside an existing temp repo.
 * @param {string} repoPath
 * @param {string} relativePath
 * @param {string} content
 */
function writeSplFile(repoPath, relativePath, content) {
    const absolutePath = path.join(repoPath, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
}

/**
 * Remove a temp repo directory.
 * @param {string} repoPath
 */
function cleanupTempRepo(repoPath) {
    fs.rmSync(repoPath, { recursive: true, force: true });
}

module.exports = { createTempGitRepo, writeSplFile, cleanupTempRepo };
