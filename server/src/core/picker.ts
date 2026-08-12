import { SCORE } from '../config.js';
import { get, recordResult, type Proxy } from './store.js';

export type Strategy = 'url-test' | 'round-robin' | 'random';

export interface PickerFilters {
  country?: string;
  target?: string;
}

/**
 * Chooses which upstream proxy serves the next request.
 *
 * The tolerance hysteresis is taken from mihomo's url-test group
 * (adapter/outboundgroup/urltest.go): stay on the current node unless a
 * candidate beats it by more than `tolerance` ms. Without it, free proxies —
 * whose latency swings between ~400ms and ~4s — would cause a different node
 * to win on nearly every request, destroying connection reuse and making
 * behaviour unreproducible.
 */
export class Picker {
  strategy: Strategy = 'url-test';
  /** Switch away from the current node only if beaten by more than this (ms). */
  tolerance = 300;
  /** Rotate after this many requests. 0 keeps a node until it fails. */
  rotateAfter = 0;

  /** How long the candidate list may be reused, in ms. 0 disables caching. */
  cacheMs = 1000;

  private current: Proxy | null = null;
  private served = 0;
  private cursor = 0;
  private cache: Proxy[] = [];
  private cachedAt = 0;
  private cachedKey = '';

  /**
   * Live candidates. Cached briefly so a burst of requests does not re-query
   * per connection, but keyed on `httpsOnly` -- reusing an http-only list for
   * an HTTPS request would hand back proxies that cannot do CONNECT.
   */
  private candidates(httpsOnly: boolean, filters: PickerFilters = {}): Proxy[] {
    const now = Date.now();
    const key = JSON.stringify([httpsOnly, filters.country ?? '', filters.target ?? '']);
    if (this.cachedKey !== key || now - this.cachedAt >= this.cacheMs) {
      this.cache = get({
        n: 200,
        https: httpsOnly,
        minScore: 1,
        country: filters.country,
        target: filters.target,
      });
      this.cachedAt = now;
      this.cachedKey = key;
    }
    return this.cache;
  }

  private candidatePool(httpsOnly: boolean, filters: PickerFilters, exclude: Set<string>): Proxy[] {
    const preferred = this.candidates(httpsOnly, filters).filter((proxy) => !exclude.has(proxy.addr));
    if (preferred.length || !filters.target) return preferred;
    // A new service profile has no learned rows yet. Use the region-filtered
    // pool until real traffic or an explicit probe records a working proxy.
    return this.candidates(httpsOnly, { country: filters.country })
      .filter((proxy) => !exclude.has(proxy.addr));
  }

  /** Force the next pick to re-read from the store. */
  invalidate() {
    this.cachedAt = 0;
    this.cachedKey = '';
  }

  /** Whether any candidate exists, without advancing rotation state. */
  hasCandidates(httpsOnly: boolean, filters: PickerFilters = {}): boolean {
    return this.candidatePool(httpsOnly, filters, new Set()).length > 0;
  }

  /** Pick an upstream, excluding any that already failed for this request. */
  pick(
    httpsOnly: boolean,
    exclude: Set<string> = new Set(),
    filters: PickerFilters = {},
  ): Proxy | null {
    const pool = this.candidatePool(httpsOnly, filters, exclude);
    if (!pool.length) return null;

    if (this.rotateAfter && this.served >= this.rotateAfter) {
      this.current = null;
      this.served = 0;
    }

    let chosen: Proxy | undefined;
    switch (this.strategy) {
      case 'random':
        chosen = pool[Math.floor(Math.random() * pool.length)];
        break;

      case 'round-robin':
        chosen = pool[this.cursor % pool.length];
        this.cursor++;
        break;

      case 'url-test': {
        // pool is already ordered by score desc, latency asc.
        const best = pool[0]!;
        const held = this.current && pool.find((p) => p.addr === this.current!.addr);
        chosen =
          held && (held.latency_ms ?? Infinity) <= (best.latency_ms ?? Infinity) + this.tolerance
            ? held
            : best;
        break;
      }
    }

    if (!chosen) return null;
    if (chosen.addr !== this.current?.addr) this.served = 0;
    this.current = chosen;
    this.served++;
    return chosen;
  }

  /** Feed the real outcome back into scoring; this is the /report loop, internal. */
  report(addr: string, ok: boolean) {
    recordResult(addr, ok, { delta: ok ? SCORE.reportOk : SCORE.reportFail });
    if (!ok) {
      if (this.current?.addr === addr) this.current = null;
      this.invalidate(); // a dead node must not linger in the cache
    }
  }

  get active() {
    return this.current;
  }
}

export const picker = new Picker();
