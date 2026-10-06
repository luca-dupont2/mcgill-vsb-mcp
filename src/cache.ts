/** TTL cache coalesces concurrent requests and never retains failed requests. */
export class TtlCache<T> {
  private readonly values = new Map<string, { expires: number; value: T }>();
  private readonly pending = new Map<string, Promise<T>>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 256,
    private readonly now = Date.now,
  ) {}
  async get(key: string, load: () => Promise<T>, refresh = false): Promise<T> {
    if (refresh) this.values.delete(key);
    const hit = this.values.get(key);
    if (hit && hit.expires > this.now()) return structuredClone(hit.value);
    if (hit) this.values.delete(key);
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing);
    const request = load();
    this.pending.set(key, request);
    try {
      const value = await request;
      for (const [k, v] of this.values)
        if (v.expires <= this.now()) this.values.delete(k);
      if (this.values.size >= this.maxEntries)
        this.values.delete(this.values.keys().next().value!);
      if (this.ttlMs > 0)
        this.values.set(key, {
          value: structuredClone(value),
          expires: this.now() + this.ttlMs,
        });
      return structuredClone(value);
    } finally {
      this.pending.delete(key);
    }
  }
}
