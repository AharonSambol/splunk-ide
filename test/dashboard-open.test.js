const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { openDashboardHistory, detectViewExt } = require('../lib/dashboard-open');
const { getDashboardViewPath } = require('../lib/object-paths');
const {
    saveVersion,
    listVersions,
    restoreVersion,
    readCurrentQuery
} = require('../lib/query-versions');
const { cleanupTempRepo } = require('./helpers/temp-git-repo');

const DASHBOARD_META = {
    instance: 'prod',
    app: 'search',
    owner: 'nobody',
    name: 'Error Dashboard'
};

const VIEW_XML = '<dashboard><label>Errors</label></dashboard>\n';
const VIEW_JSON = '{"title":"Errors","version":"1.0.0"}\n';

function mockFetchView(body) {
    return async () => body;
}

async function createLocalRepo() {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'splunk-ide-dash-'));
    const git = simpleGit(repoPath);
    await git.init();
    return { repoPath, git };
}

function writeView(repoPath, meta, ext, body) {
    const viewPath = getDashboardViewPath({ ...meta, ext });
    const absolutePath = path.join(repoPath, viewPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, body, 'utf8');
    return viewPath;
}

describe('detectViewExt', () => {
    it('detects json from body', () => {
        assert.equal(detectViewExt(VIEW_JSON), 'json');
    });

    it('defaults to xml', () => {
        assert.equal(detectViewExt(VIEW_XML), 'xml');
    });
});

describe('openDashboardHistory', () => {
    let repoPath;
    let git;

    beforeEach(async () => {
        ({ repoPath, git } = await createLocalRepo());
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('reuses existing HEAD xml view without import commit', async () => {
        const viewPath = writeView(repoPath, DASHBOARD_META, 'xml', VIEW_XML);
        await saveVersion(git, viewPath, 'Initial dashboard');
        const before = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());

        const result = await openDashboardHistory({
            git,
            workspaceRoot: repoPath,
            metadata: DASHBOARD_META
        });

        const after = Number((await git.raw(['rev-list', '--count', 'HEAD'])).trim());
        assert.equal(result.viewPath, viewPath);
        assert.equal(result.viewSource, 'head');
        assert.equal(result.imported, false);
        assert.equal(before, after);
        assert.equal(fs.readFileSync(path.join(repoPath, viewPath), 'utf8'), VIEW_XML);
    });

    it('imports missing xml view via REST', async () => {
        const result = await openDashboardHistory({
            git,
            workspaceRoot: repoPath,
            metadata: DASHBOARD_META,
            restSettings: { baseUrl: 'http://splunk' },
            fetchDashboardView: mockFetchView(VIEW_XML)
        });

        const viewPath = getDashboardViewPath({ ...DASHBOARD_META, ext: 'xml' });
        assert.equal(result.viewPath, viewPath);
        assert.equal(result.viewSource, 'import');
        assert.equal(result.imported, true);
        assert.equal(fs.readFileSync(path.join(repoPath, viewPath), 'utf8'), VIEW_XML);
        const versions = await listVersions(git, viewPath, 5);
        assert.equal(versions.length, 1);
        assert.equal(versions[0].message, 'Import dashboard');
    });

    it('imports missing json view via REST', async () => {
        const result = await openDashboardHistory({
            git,
            workspaceRoot: repoPath,
            metadata: DASHBOARD_META,
            restSettings: { baseUrl: 'http://splunk' },
            fetchDashboardView: mockFetchView(VIEW_JSON)
        });

        const viewPath = getDashboardViewPath({ ...DASHBOARD_META, ext: 'json' });
        assert.equal(result.viewPath, viewPath);
        assert.equal(result.ext, 'json');
        assert.equal(fs.readFileSync(path.join(repoPath, viewPath), 'utf8'), VIEW_JSON);
    });
});

describe('dashboard file-scoped version roundtrip', () => {
    let repoPath;
    let git;
    let viewPath;

    beforeEach(async () => {
        ({ repoPath, git } = await createLocalRepo());
        viewPath = writeView(repoPath, DASHBOARD_META, 'xml', VIEW_XML);
        await saveVersion(git, viewPath, 'v1');
    });

    afterEach(() => {
        cleanupTempRepo(repoPath);
    });

    it('save/history/restore roundtrip for xml view', async () => {
        const updated = '<dashboard><label>Errors v2</label></dashboard>\n';
        fs.writeFileSync(path.join(repoPath, viewPath), updated, 'utf8');
        const saveResult = await saveVersion(git, viewPath, 'v2');
        assert.equal(saveResult.saved, true);

        const versions = await listVersions(git, viewPath, 5);
        assert.equal(versions.length, 2);
        assert.equal(versions[0].url.trim(), updated.trim());

        await restoreVersion(git, viewPath, versions[1].hash, versions[0].hash, { skipAutoSave: true });
        const restored = readCurrentQuery(path.join(repoPath, viewPath));
        assert.equal(restored.url.trim(), VIEW_XML.trim());
    });
});
