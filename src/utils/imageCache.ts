export interface CacheEntry {
  data: string;
  lastAccessed: number;
}

class ImageCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 100;

  public set(key: string, data: string): void {
    if (this.cache.size >= this.maxSize) {
      // Delete oldest entry
      let oldest = Date.now();
      let oldestKey = '';
      this.cache.forEach((entry, key) => {
        if (entry.lastAccessed < oldest) {
          oldest = entry.lastAccessed;
          oldestKey = key;
        }
      });
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      data,
      lastAccessed: Date.now()
    });
  }

  public get(key: string): string | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.data;
    }
    return null;
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }
}

export const imageCache = new ImageCache();
