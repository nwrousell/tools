// Thin clients for the public, CORS-enabled APIs we use. No keys needed.
//   Wikipedia action API  – geosearch, page details, extracts
//   Wikidata Query Service – types, dates, heritage status
//   Overpass (OSM)        – plaques & history boards with inscriptions
//   Nominatim (OSM)       – place search

const wikiEndpoint = (lang) => `https://${lang}.wikipedia.org/w/api.php`;

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function wikiQuery(lang, params, signal) {
  const url = new URL(wikiEndpoint(lang));
  const all = { action: 'query', format: 'json', formatversion: '2', origin: '*', ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ApiError(`Wikipedia returned ${res.status}`, `http-${res.status}`);
  const json = await res.json();
  if (json.error) throw new ApiError(json.error.info || json.error.code, json.error.code);
  return json;
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;

// area: { type: 'bbox', n, s, e, w } | { type: 'radius', lat, lon, radius }
export async function geosearch(lang, area, signal) {
  const params = { list: 'geosearch', gslimit: 500, gsprimary: 'primary', gsnamespace: 0 };
  if (area.type === 'bbox') {
    params.gsbbox = `${r5(area.n)}|${r5(area.w)}|${r5(area.s)}|${r5(area.e)}`;
  } else {
    params.gscoord = `${r5(area.lat)}|${r5(area.lon)}`;
    params.gsradius = Math.max(10, Math.min(10000, Math.round(area.radius)));
  }
  const json = await wikiQuery(lang, params, signal);
  return json.query?.geosearch ?? [];
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined) continue;
    if (target[k] === undefined) target[k] = v;
    else if (isPlainObject(target[k]) && isPlainObject(v)) target[k] = { ...v, ...target[k] };
  }
  return target;
}

// Up to 50 pageids. Returns Map<pageid, page>.
export async function fetchPageDetails(lang, pageids, signal) {
  const base = {
    pageids: pageids.join('|'),
    prop: 'pageimages|description|info|pageprops|pageviews',
    piprop: 'thumbnail',
    pithumbsize: 480,
    pilimit: 50,
    ppprop: 'wikibase_item',
    pvipdays: 30,
  };
  const pages = new Map();
  let cont = {};
  // Some props (pageviews especially) paginate across continuation rounds.
  for (let round = 0; round < 6; round++) {
    const json = await wikiQuery(lang, { ...base, ...cont }, signal);
    for (const p of json.query?.pages ?? []) {
      if (p.missing || p.invalid) continue;
      pages.set(p.pageid, mergeInto(pages.get(p.pageid) || {}, p));
    }
    if (!json.continue) break;
    cont = json.continue;
  }
  return pages;
}

export function sumPageviews(pv) {
  if (!isPlainObject(pv)) return null;
  let total = 0;
  let any = false;
  for (const v of Object.values(pv)) {
    if (typeof v === 'number') {
      total += v;
      any = true;
    }
  }
  return any ? total : 0;
}

// Plain-text extract. intro=true gives just the lead section.
export async function fetchExtract(lang, pageid, { intro = true } = {}, signal) {
  const params = { pageids: pageid, prop: 'extracts', explaintext: 1, exsectionformat: 'wiki' };
  if (intro) params.exintro = 1;
  const json = await wikiQuery(lang, params, signal);
  return json.query?.pages?.[0]?.extract || '';
}

const SKIP_SECTIONS =
  /^(see also|references|notes|footnotes|citations|sources|bibliography|further reading|external links|gallery|works cited|literature|weblinks|einzelnachweise|références|liens externes|notes et références|voir aussi|referencias|enlaces externos|véase también|note|bibliografia|collegamenti esterni|voci correlate)$/i;

// Split a TextExtracts plain-text blob ("== Heading ==" markers) into sections,
// dropping reference-ish sections and their children.
export function parseSections(text) {
  const sections = [{ title: null, level: 1, paragraphs: [] }];
  let skipping = 0; // level of the heading we're skipping under, 0 = not skipping
  for (const line of text.split('\n')) {
    const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (skipping && level > skipping) continue;
      skipping = 0;
      if (SKIP_SECTIONS.test(h[2])) {
        skipping = level;
        continue;
      }
      sections.push({ title: h[2], level, paragraphs: [] });
      continue;
    }
    if (skipping) continue;
    const t = line.trim();
    if (t) sections[sections.length - 1].paragraphs.push(t);
  }
  return sections.filter((s) => s.paragraphs.length);
}

// ---------------------------------------------------------------- Wikidata

const SPARQL = 'https://query.wikidata.org/sparql';

function sparqlFor(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  return `
SELECT ?item
  (GROUP_CONCAT(DISTINCT ?classLabel; separator="|") AS ?classes)
  (GROUP_CONCAT(DISTINCT ?superLabel; separator="|") AS ?supers)
  (MIN(?start) AS ?startDate)
  (SAMPLE(STR(?end)) AS ?endDate)
  (GROUP_CONCAT(DISTINCT ?heritageLabel; separator="|") AS ?heritage)
  (GROUP_CONCAT(DISTINCT ?stateLabel; separator="|") AS ?states)
WHERE {
  VALUES ?item { ${values} }
  OPTIONAL {
    ?item wdt:P31 ?class .
    ?class rdfs:label ?classLabel . FILTER(LANG(?classLabel) = "en")
    OPTIONAL { ?class wdt:P279 ?super . ?super rdfs:label ?superLabel . FILTER(LANG(?superLabel) = "en") }
  }
  OPTIONAL { ?item wdt:P571|wdt:P585|wdt:P580|wdt:P1619 ?start . FILTER(isLiteral(?start)) }
  OPTIONAL { ?item wdt:P576 ?end . }
  OPTIONAL { ?item wdt:P1435 ?h . ?h rdfs:label ?heritageLabel . FILTER(LANG(?heritageLabel) = "en") }
  OPTIONAL { ?item wdt:P5817 ?st . ?st rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en") }
}
GROUP BY ?item`;
}

const splitList = (v) => (v ? v.split('|').filter(Boolean) : []);

// Returns Map<qid, facts>.
export async function fetchWikidataFacts(qids, signal) {
  const body = new URLSearchParams({ query: sparqlFor(qids), format: 'json' });
  const res = await fetch(SPARQL, {
    method: 'POST',
    body,
    signal,
    headers: { Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new ApiError(`Wikidata returned ${res.status}`, `http-${res.status}`);
  const json = await res.json();
  const out = new Map();
  for (const b of json.results?.bindings ?? []) {
    const qid = b.item.value.split('/').pop();
    out.set(qid, {
      classes: splitList(b.classes?.value),
      supers: splitList(b.supers?.value),
      startDate: b.startDate?.value ?? null,
      endDate: b.endDate?.value ?? null,
      heritage: splitList(b.heritage?.value),
      states: splitList(b.states?.value),
    });
  }
  return out;
}

// ---------------------------------------------------------------- Overpass

const OVERPASS = 'https://overpass-api.de/api/interpreter';
export const OSM_LIMIT = 400;

export async function fetchOsmMarkers(b, signal) {
  const bbox = `${r5(b.s)},${r5(b.w)},${r5(b.n)},${r5(b.e)}`;
  const query = `[out:json][timeout:25];
(
  nwr["historic"="memorial"]["memorial"~"^(plaque|blue_plaque|stolperstein)$"](${bbox});
  nwr["historic"="memorial"]["inscription"](${bbox});
  nwr["tourism"="information"]["information"="board"]["board_type"~"^(history|historic|historical)$"](${bbox});
);
out tags center ${OSM_LIMIT};`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), signal });
  if (!res.ok) {
    throw new ApiError(
      res.status === 429 ? 'OpenStreetMap is rate-limiting us, try again in a bit' : `Overpass returned ${res.status}`,
      `http-${res.status}`,
    );
  }
  const json = await res.json();
  return json.elements ?? [];
}

// ---------------------------------------------------------------- Nominatim

export async function searchPlaces(q, signal) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '6');
  url.searchParams.set('q', q);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ApiError(`Search returned ${res.status}`, `http-${res.status}`);
  const json = await res.json();
  return json.map((r) => ({
    name: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    // Nominatim: [south, north, west, east] as strings
    bbox: r.boundingbox ? r.boundingbox.map(Number) : null,
  }));
}
