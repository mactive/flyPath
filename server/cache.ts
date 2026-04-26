interface CacheEntry<T> {
  expiresAt: number;
  inflight?: Promise<T>;
  value?: T;
}

export class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  async remember<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.store.get(key) as CacheEntry<T> | undefined;

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
