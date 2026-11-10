// web/retry-loader.js -- a load started on first need; a failed one (null result or a throw) is tried again only after
// retryMs, so a getter called every frame does not refetch every frame. get() returns the data, or null while loading/failed.
export function createRetryLoader(load, { retryMs = 5000, now = () => performance.now() } = {}) {
    let data = null, pending = null, failedAt = -Infinity;
    return {
        get() {
            if (data === null && pending === null && now() - failedAt >= retryMs) {
                const fail = () => { failedAt = now(); pending = null; return null; };
                pending = Promise.resolve().then(load).then((d) => {
                    if (!d) return fail();
                    data = d; pending = null; return d;
                }, fail);
            }
            return data;
        },
    };
}
