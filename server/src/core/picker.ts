import { SCORE } from '../config.js';
import { get, recordResult, type Proxy } from './store.js';

export type Strategy = 'url-test' | 'round-robin' | 'random';

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

  private current: Proxy | null = null;
  private served = 0;
  private cursor = 0;
  private cache: Proxy[] = [];
  private cachedAt = 0;

  /** Live candidates, refreshed at most once a second. */
  private candidates(httpsOnly: boolean): Proxy[] {
    const now = Date.now();
    if (now - this.cachedAt > 1000) {
      this.cache = get({ n: 200, https: httpsOnly, minScore: 1 });
      this.cachedAt = now;
    }
    return this.cache;
  }

  /** Pick an upstream, excluding any that already failed for this request. */
  pick(httpsOnly: boolean, exclude: Set<string> = new Set()): Proxy | null {
    const pool = this.candidates(httpsOnly).filter((p) => !exclude.has(p.addr));
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
      this.cachedAt = 0; // a dead node must not linger in the cache
    }
  }

  get active() {
    return this.current;
  }
}

export const picker = new Picker();
