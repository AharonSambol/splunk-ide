// ponytail: global per-conf lock; finer locks if contention matters

/** @type {Map<string, Promise<void>>} */
const chains = new Map();

function normalizeConfPath(confPath) {
    return confPath.replace(/\\/g, '/');
}

/**
 * Serialize mutating ops for one conf path (save/reset/recompose/draft write).
 * @template T
 * @param {string} confPath
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withConfLock(confPath, fn) {
    const key = normalizeConfPath(confPath);
    const prior = chains.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    chains.set(key, gate);
    await prior;
    try {
        return await fn();
    } finally {
        release();
        if (chains.get(key) === gate) {
            chains.delete(key);
        }
    }
}

module.exports = {
    withConfLock,
    normalizeConfPath
};
