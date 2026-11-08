export function distanceMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function formatDistance(m) {
  if (m == null) return '';
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
}

export function bboxAreaKm2(b) {
  const midLat = ((b.n + b.s) / 2) * (Math.PI / 180);
  const h = (b.n - b.s) * 110.57;
  const w = (b.e - b.w) * 111.32 * Math.cos(midLat);
  return Math.abs(h * w);
}

export function bboxContains(outer, inner) {
  return outer.n >= inner.n && outer.s <= inner.s && outer.e >= inner.e && outer.w <= inner.w;
}

export function inBounds(b, lat, lon) {
  return lat <= b.n && lat >= b.s && lon <= b.e && lon >= b.w;
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

// localStorage that never throws (private windows, blocked storage...).
export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

// #map=15/42.36/-71.05&lang=en&place=wp:en:123
export function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const out = {};
  const m = /^(\d{1,2}(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(params.get('map') || '');
  if (m) out.view = { zoom: Number(m[1]), lat: Number(m[2]), lon: Number(m[3]) };
  if (params.get('lang')) out.lang = params.get('lang');
  if (params.get('place')) out.place = params.get('place');
  return out;
}

export function writeHash({ view, lang, place }) {
  const params = new URLSearchParams();
  if (view) params.set('map', `${Math.round(view.zoom)}/${view.lat.toFixed(5)}/${view.lon.toFixed(5)}`);
  if (lang && lang !== 'en') params.set('lang', lang);
  if (place) params.set('place', place);
  const next = '#' + params.toString().replace(/%2F/g, '/').replace(/%3A/g, ':');
  if (next !== location.hash) history.replaceState(null, '', next);
}
