import { Batch, Offer, SiteSettings } from '../types';

const KEY_BATCHES = 'ksl_cache_batches_v1';
const KEY_OFFERS = 'ksl_cache_offers_v1';
const KEY_SETTINGS = 'ksl_cache_settings_v1';
const KEY_TS = 'ksl_cache_ts_v1';

export interface CachedCatalog {
  settings: Partial<SiteSettings> | null;
  batches: Batch[];
  offers: Offer[];
  ts: number;
}

export function readCachedCatalog(): CachedCatalog {
  if (typeof window === 'undefined') {
    return { settings: null, batches: [], offers: [], ts: 0 };
  }
  try {
    const rawB = localStorage.getItem(KEY_BATCHES);
    const rawO = localStorage.getItem(KEY_OFFERS);
    const rawS = localStorage.getItem(KEY_SETTINGS);
    const rawTs = localStorage.getItem(KEY_TS);

    const batches = rawB ? (JSON.parse(rawB) as Batch[]) : [];
    const offers = rawO ? (JSON.parse(rawO) as Offer[]) : [];
    const settings = rawS ? (JSON.parse(rawS) as Partial<SiteSettings>) : null;
    const ts = rawTs ? Number(rawTs) || 0 : 0;

    return {
      settings: settings && typeof settings === 'object' ? settings : null,
      batches: Array.isArray(batches) ? batches : [],
      offers: Array.isArray(offers) ? offers : [],
      ts,
    };
  } catch {
    return { settings: null, batches: [], offers: [], ts: 0 };
  }
}

export function writeCachedCatalog(partial: {
  settings?: Partial<SiteSettings> | null;
  batches?: Batch[];
  offers?: Offer[];
}): void {
  if (typeof window === 'undefined') return;
  try {
    if (partial.settings) {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(partial.settings));
    }
    if (Array.isArray(partial.batches)) {
      localStorage.setItem(KEY_BATCHES, JSON.stringify(partial.batches));
    }
    if (Array.isArray(partial.offers)) {
      localStorage.setItem(KEY_OFFERS, JSON.stringify(partial.offers));
    }
    localStorage.setItem(KEY_TS, String(Date.now()));
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('ksl_catalog_sync');
      ch.postMessage({ ts: Date.now() });
      ch.close();
    }
  } catch {
    // Ignore localStorage quota restrictions cleanly
  }
}
