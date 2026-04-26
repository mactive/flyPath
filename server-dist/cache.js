export class MemoryCache {
    store = new Map();
    put(key, value, ttlMs) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttlMs
        });
    }
    async remember(key, ttlMs, loader) {
        const now = Date.now();
        const cached = this.store.get(key);
        if (cached?.value !== undefined && cached.expiresAt > now) {
            return cached.value;
        }
        if (cached?.inflight) {
            return cached.inflight;
        }
        const inflight = loader()
            .then((value) => {
            this.store.set(key, {
                value,
                expiresAt: Date.now() + ttlMs
            });
            return value;
        })
            .catch((error) => {
            this.store.delete(key);
            throw error;
        });
        this.store.set(key, {
            value: cached?.value,
            expiresAt: cached?.expiresAt ?? 0,
            inflight
        });
        return inflight;
    }
}
export const memoryCache = new MemoryCache();
