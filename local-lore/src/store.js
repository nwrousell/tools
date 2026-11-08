import {
  geosearch,
  fetchPageDetails,
  fetchWikidataFacts,
  fetchOsmMarkers,
  sumPageviews,
  OSM_LIMIT,
} from './api.js';
import { classify, parseYear } from './classify.js';
import { bboxAreaKm2, bboxContains, chunk, mapLimit, percentile, storage, distanceMeters } from './util.js';

export const MIN_WIKI_ZOOM = 11;
export const MIN_OSM_ZOOM = 14;
// GeoData rejects boxes much bigger than 20 km x 20 km; stay comfortably under.
const MAX_BBOX_KM2 = 300;
const GEO_LIMIT = 500;
const MAX_PLACES = 6000;

const SAVED_KEY = 'local-lore:saved';

function wikiPlace(lang, r) {
  return {
    id: `wp:${lang}:${r.pageid}`,
    source: 'wikipedia',
    lang,
    pageid: r.pageid,
    title: r.title,
    lat: r.lat,
    lon: r.lon,
    description: null,
    thumb: null,
    length: null,
    views: null,
    qid: null,
    classes: [],
    supers: [],
    states: [],
    heritageData: [],
    dataYear: null,
    endYear: null,
    lostByData: false,
    year: null,
    category: 'other',
    lost: false,
    heritage: [],
    ready: false,
  };
}

const MEMORIAL_KIND = {
  plaque: 'Plaque',
  blue_plaque: 'Blue plaque',
  stolperstein: 'Stolperstein',
};

function osmPlace(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const inscription = t.inscription || t['inscription:en'] || null;
  const kind =
    t.tourism === 'information' ? 'History board' : MEMORIAL_KIND[t.memorial] || (t.memorial ? 'Memorial' : 'Plaque');
  let title = t.name || t['name:en'] || null;
  if (!title && t.subject) title = `${kind}: ${t.subject}`;
  if (!title && inscription) {
    const first = inscription.split(/(?<=[.!?])\s|\n/)[0];
    title = first.length > 70 ? first.slice(0, 67).trimEnd() + '…' : first;
  }
  if (!title && !t.description) return null; // nothing to show
  return {
    id: `osm:${el.type}/${el.id}`,
    source: 'osm',
    osmType: el.type,
    osmId: el.id,
    title: title || kind,
    kind,
    lat,
    lon,
    description: kind,
    inscription,
    note: t.description || null,
    subject: t.subject || null,
    subjectWikipedia: t['subject:wikipedia'] || null,
    wikipedia: t.wikipedia || null,
    commons: t.wikimedia_commons || null,
    installed: t.start_date || null,
    year: null,
    category: 'markers',
    lost: false,
    heritage: [],
    ready: true,
  };
}

function applyDetails(p, d) {
  if (d) {
    p.description = d.description || null;
    p.thumb = d.thumbnail?.source || null;
    p.length = d.length ?? null;
    p.views = sumPageviews(d.pageviews);
    p.qid = d.pageprops?.wikibase_item || null;
  }
  p.ready = true;
  classify(p);
}

function applyFacts(p, f) {
  if (!f) return;
  p.classes = f.classes;
  p.supers = f.supers;
  p.states = f.states;
  p.heritageData = f.heritage;
  p.dataYear = parseYear(f.startDate);
  p.endYear = parseYear(f.endDate);
  p.lostByData = f.endDate != null;
  p.year = null; // re-derive with the better data
  classify(p);
}

export class LoreStore {
  constructor(lang) {
    this.lang = lang;
    this.places = new Map();
    this.version = 0;
    this.pending = { wikipedia: 0, wikidata: 0, osm: 0 };
    this.errors = {};
    this.notes = {};
    this.listeners = new Set();
    this.searched = { wikipedia: [], osm: [] };
    this.saved = new Map(storage.get(SAVED_KEY, []).map((p) => [p.id, p]));
    for (const p of this.saved.values()) this.places.set(p.id, { ...p, saved: true });
    this._raf = 0;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.version++;
      for (const fn of this.listeners) fn(this.version);
    });
  }

  get loading() {
    return this.pending.wikipedia + this.pending.wikidata + this.pending.osm > 0;
  }

  async track(source, fn) {
    this.pending[source]++;
    this.emit();
    try {
      await fn();
      delete this.errors[source];
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn(`[local-lore] ${source}`, e);
        this.errors[source] = e.message || String(e);
      }
    } finally {
      this.pending[source]--;
      this.emit();
    }
  }

  setLang(lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    for (const [id, p] of this.places) {
      if (p.source === 'wikipedia' && !p.saved) this.places.delete(id);
    }
    this.searched.wikipedia = [];
    this.emit();
  }

  // ---------------------------------------------------------- Wikipedia

  loadWikipedia(view) {
    if (view.zoom < MIN_WIKI_ZOOM) {
      this.notes.wiki = 'zoom';
      this.emit();
      return;
    }
    const bounds = { n: view.n, s: view.s, e: view.e, w: view.w };
    if (this.searched.wikipedia.some((b) => bboxContains(b, bounds))) return;

    const lang = this.lang;
    const useBox = bboxAreaKm2(bounds) <= MAX_BBOX_KM2;
    const area = useBox
      ? { type: 'bbox', ...bounds }
      : { type: 'radius', lat: view.lat, lon: view.lon, radius: 10000 };

    return this.track('wikipedia', async () => {
      let results;
      let mode = area.type;
      try {
        results = await geosearch(lang, area);
      } catch (e) {
        if (area.type !== 'bbox') throw e;
        // Box rejected (too big / odd shape) – fall back to a radius search.
        mode = 'radius';
        results = await geosearch(lang, { type: 'radius', lat: view.lat, lon: view.lon, radius: 10000 });
      }
      if (lang !== this.lang) return;

      const capped = results.length >= GEO_LIMIT;
      if (!capped) this.searched.wikipedia.push(mode === 'bbox' ? bounds : inscribedBox(view.lat, view.lon, 10000));
      this.notes.wiki = capped ? 'capped' : mode === 'radius' ? 'radius' : null;

      const fresh = [];
      for (const r of results) {
        const id = `wp:${lang}:${r.pageid}`;
        if (this.places.has(id)) continue;
        const p = wikiPlace(lang, r);
        this.places.set(id, p);
        fresh.push(p);
      }
      this.prune(view);
      this.emit();
      if (fresh.length) await this.enrich(lang, fresh);
    });
  }

  async enrich(lang, places) {
    await mapLimit(chunk(places, 50), 3, async (batch) => {
      let details = new Map();
      try {
        details = await fetchPageDetails(
          lang,
          batch.map((p) => p.pageid),
        );
        delete this.errors.details;
      } catch (e) {
        console.warn('[local-lore] page details', e);
        this.errors.details = e.message;
      }
      for (const p of batch) applyDetails(p, details.get(p.pageid));
      this.emit();
    });

    const withQ = places.filter((p) => p.qid);
    if (!withQ.length) return;
    await this.track('wikidata', () =>
      mapLimit(chunk(withQ, 120), 2, async (batch) => {
        const facts = await fetchWikidataFacts(batch.map((p) => p.qid));
        for (const p of batch) applyFacts(p, facts.get(p.qid));
        this.emit();
      }),
    );
  }

  // ---------------------------------------------------------- OSM

  loadOsm(view) {
    if (view.zoom < MIN_OSM_ZOOM) {
      this.notes.osm = 'zoom';
      this.emit();
      return;
    }
    this.notes.osm = null;
    const bounds = { n: view.n, s: view.s, e: view.e, w: view.w };
    if (this.searched.osm.some((b) => bboxContains(b, bounds))) return;
    // Pad a little so small pans don't refetch.
    const padLat = (bounds.n - bounds.s) * 0.25;
    const padLon = (bounds.e - bounds.w) * 0.25;
    const box = { n: bounds.n + padLat, s: bounds.s - padLat, e: bounds.e + padLon, w: bounds.w - padLon };

    return this.track('osm', async () => {
      const elements = await fetchOsmMarkers(box);
      if (elements.length < OSM_LIMIT) this.searched.osm.push(box);
      this.notes.osm = elements.length >= OSM_LIMIT ? 'capped' : null;
      for (const el of elements) {
        const p = osmPlace(el);
        if (p && !this.places.has(p.id)) this.places.set(p.id, p);
      }
      this.emit();
    });
  }

  // ---------------------------------------------------------- housekeeping

  prune(view) {
    if (this.places.size <= MAX_PLACES) return;
    const ranked = [...this.places.values()]
      .filter((p) => !p.saved)
      .map((p) => [p, distanceMeters(view.lat, view.lon, p.lat, p.lon)])
      .sort((a, b) => b[1] - a[1]);
    for (const [p] of ranked.slice(0, this.places.size - MAX_PLACES)) this.places.delete(p.id);
    // Searched areas may no longer be fully loaded.
    this.searched = { wikipedia: [], osm: [] };
  }

  gemThreshold() {
    if (this._gemVersion === this.version) return this._gem;
    const views = [];
    for (const p of this.places.values()) if (p.views != null && p.source === 'wikipedia') views.push(p.views);
    views.sort((a, b) => a - b);
    this._gem = views.length >= 20 ? percentile(views, 0.35) : 300;
    this._gemVersion = this.version;
    return this._gem;
  }

  isGem(p) {
    return p.source === 'wikipedia' && p.views != null && p.length >= 2500 && p.views <= this.gemThreshold();
  }

  // ---------------------------------------------------------- saved

  toggleSaved(id) {
    const p = this.places.get(id);
    if (!p) return;
    if (this.saved.has(id)) {
      this.saved.delete(id);
      p.saved = false;
    } else {
      const { ready, ...snapshot } = p;
      this.saved.set(id, { ...snapshot, ready: true, savedAt: Date.now() });
      p.saved = true;
    }
    storage.set(SAVED_KEY, [...this.saved.values()]);
    this.emit();
  }
}

function inscribedBox(lat, lon, radius) {
  const half = radius / Math.SQRT2;
  const dLat = half / 110570;
  const dLon = half / (111320 * Math.cos((lat * Math.PI) / 180));
  return { n: lat + dLat, s: lat - dLat, e: lon + dLon, w: lon - dLon };
}
