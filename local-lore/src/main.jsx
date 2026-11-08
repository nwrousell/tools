import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MapView } from './MapView.jsx';
import { Detail } from './Detail.jsx';
import { Filters, PlaceRow, QuickFlags, SORTS } from './Panel.jsx';
import { LoreStore, MIN_OSM_ZOOM, MIN_WIKI_ZOOM } from './store.js';
import { CATEGORIES, ERAS, eraOf } from './classify.js';
import { searchPlaces } from './api.js';
import { distanceMeters, inBounds, readHash, storage, writeHash } from './util.js';
import './styles.css';

const DEFAULT_VIEW = { lat: 42.3637, lon: -71.0545, zoom: 15 }; // Boston's North End
const FILTERS_KEY = 'local-lore:filters';
const VIEW_KEY = 'local-lore:view';
const LANG_KEY = 'local-lore:lang';
const LIST_PAGE = 150;

function defaultFilters() {
  return {
    categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, !c.defaultOff])),
    eras: Object.fromEntries(ERAS.map((e) => [e.id, true])),
    lostOnly: false,
    gemsOnly: false,
    heritageOnly: false,
  };
}

function loadFilters() {
  const d = defaultFilters();
  const s = storage.get(FILTERS_KEY, null);
  if (!s) return d;
  return {
    ...d,
    ...s,
    categories: { ...d.categories, ...(s.categories || {}) },
    eras: { ...d.eras, ...(s.eras || {}) },
  };
}

function countChanged(f) {
  const d = defaultFilters();
  let n = 0;
  for (const k in d.categories) if (d.categories[k] !== f.categories[k]) n++;
  for (const k in d.eras) if (d.eras[k] !== f.eras[k]) n++;
  for (const k of ['lostOnly', 'gemsOnly', 'heritageOnly']) if (f[k]) n++;
  return n;
}

function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatch(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return match;
}

const hash = readHash();

function App() {
  const [lang, setLangState] = useState(() => hash.lang || storage.get(LANG_KEY, 'en'));
  const store = useMemo(() => new LoreStore(lang), []);
  const [version, setVersion] = useState(0);
  useEffect(() => store.subscribe(setVersion), [store]);

  const initialView = useMemo(() => hash.view || storage.get(VIEW_KEY, null) || DEFAULT_VIEW, []);
  const [view, setView] = useState(null);
  const viewRef = useRef(null);
  const [filters, setFilters] = useState(loadFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(() => storage.get('local-lore:sort', 'near'));
  const [selectedId, setSelectedId] = useState(null);
  const pendingPlace = useRef(hash.place || null);
  const [tab, setTab] = useState('explore');
  const [command, setCommand] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [listLimit, setListLimit] = useState(LIST_PAGE);
  const [search, setSearch] = useState({ q: '', results: null, loading: false, error: null });
  const [toast, setToast] = useState(null);
  const mobile = useMedia('(max-width: 720px)');
  const listRef = useRef(null);
  const listScroll = useRef(0);
  const touch = useRef(null);

  useEffect(() => storage.set(FILTERS_KEY, filters), [filters]);
  useEffect(() => storage.set('local-lore:sort', sort), [sort]);

  const load = useCallback(
    (v) => {
      if (!v) return;
      store.loadWikipedia(v);
      if (filtersRef.current.categories.markers) store.loadOsm(v);
    },
    [store],
  );

  const onMove = useCallback(
    (v) => {
      viewRef.current = v;
      setView(v);
      setListLimit(LIST_PAGE);
      storage.set(VIEW_KEY, { lat: v.lat, lon: v.lon, zoom: v.zoom });
      load(v);
    },
    [load],
  );

  // Turning the plaques layer on should load it right away.
  useEffect(() => {
    if (filters.categories.markers) load(viewRef.current);
  }, [filters.categories.markers]);

  const setLang = (l) => {
    setLangState(l);
    storage.set(LANG_KEY, l);
    store.setLang(l);
    load(viewRef.current);
  };

  // Keep the URL shareable.
  useEffect(() => {
    if (view) writeHash({ view, lang, place: selectedId });
  }, [view, lang, selectedId]);

  // Select a place from a shared link once it has loaded.
  useEffect(() => {
    const id = pendingPlace.current;
    if (id && store.places.get(id)?.ready) {
      pendingPlace.current = null;
      setSelectedId(id);
      setSheetOpen(true);
    }
  }, [version]);

  // ------------------------------------------------------------ derived data

  const derived = useMemo(() => {
    const f = filters;
    const q = query.trim().toLowerCase();
    const counts = {};
    const eraCounts = {};
    const onMap = [];
    const inView = [];
    for (const p of store.places.values()) {
      if (!p.ready) continue;
      if (p.source === 'wikipedia' && p.lang !== lang && !p.saved) continue;
      const okCat = f.categories[p.category] !== false;
      const era = eraOf(p.year);
      const okEra = f.eras[era] !== false;
      let okRest =
        (!f.lostOnly || p.lost) && (!f.heritageOnly || p.heritage?.length) && (!f.gemsOnly || store.isGem(p));
      if (okRest && q) {
        okRest =
          p.title.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q) ||
          (p.inscription || '').toLowerCase().includes(q);
      }
      const visible = view && inBounds(view, p.lat, p.lon);
      if (visible && okRest) {
        if (okEra) counts[p.category] = (counts[p.category] || 0) + 1;
        if (okCat) eraCounts[era] = (eraCounts[era] || 0) + 1;
      }
      if (okCat && okEra && okRest) {
        onMap.push(p);
        if (visible) inView.push(p);
      }
    }
    return { counts, eraCounts, onMap, inView };
  }, [version, filters, query, view, lang]);

  // Distances are from you if you're on screen, otherwise from the map center.
  const origin = useMemo(() => {
    if (userLocation && view && inBounds(view, userLocation.lat, userLocation.lon)) return userLocation;
    return view ? { lat: view.lat, lon: view.lon } : null;
  }, [userLocation, view]);

  const sorted = useMemo(() => {
    const withD = derived.inView.map((p) => ({
      place: p,
      d: origin ? distanceMeters(origin.lat, origin.lon, p.lat, p.lon) : null,
    }));
    const cmp = {
      near: (a, b) => a.d - b.d,
      old: (a, b) => (a.place.year ?? 1e9) - (b.place.year ?? 1e9) || a.d - b.d,
      obscure: (a, b) => (a.place.views ?? 1e12) - (b.place.views ?? 1e12) || a.d - b.d,
      famous: (a, b) => (b.place.views ?? -1) - (a.place.views ?? -1) || a.d - b.d,
    }[sort];
    return withD.sort(cmp);
  }, [derived, origin, sort]);

  const selected = selectedId ? store.places.get(selectedId) : null;

  const nearby = useMemo(() => {
    if (!selected) return [];
    return derived.onMap
      .filter((p) => p.id !== selected.id)
      .map((p) => ({ place: p, d: distanceMeters(selected.lat, selected.lon, p.lat, p.lon) }))
      .filter((x) => x.d < 1500)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
  }, [selected, derived]);

  // ------------------------------------------------------------ actions

  const flyTo = (p, opts = {}) => {
    // On phones the open sheet covers the bottom of the map; center the place in what's left.
    const sheet = document.querySelector('.panel')?.getBoundingClientRect().height ?? 0;
    const offsetY = mobile ? Math.round(sheet / 2) : 0;
    setCommand({ type: 'fly', lat: p.lat, lon: p.lon, offsetY, ...opts, key: Math.random() });
  };

  const onSelect = (id, { from } = {}) => {
    if (!id) {
      if (from === 'map' && mobile) setSheetOpen(false);
      return;
    }
    if (!selectedId) listScroll.current = listRef.current?.scrollTop ?? 0;
    setSelectedId(id);
    setTab('explore');
    const p = store.places.get(id);
    if (!p) return;
    if (mobile) setSheetOpen(true);
    if (from !== 'map' || mobile) flyTo(p, { zoom: Math.max(viewRef.current?.zoom ?? 16, 16) });
  };

  const back = () => setSelectedId(null);

  // Open a place at its top; going back returns to where you were in the list.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = selectedId ? 0 : listScroll.current;
  }, [selectedId]);

  // Swipe the top of the sheet up or down to open or close it on phones.
  const onSheetTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onSheetTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start || !mobile) return;
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dx = t.clientX - start.x;
    if (Math.abs(dy) < 40 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    setSheetOpen(dy < 0);
  };

  const surprise = () => {
    const pool = derived.inView.length ? derived.inView : derived.onMap;
    if (!pool.length) {
      setToast('Nothing loaded here yet. Pan or zoom in first.');
      return;
    }
    const weight = (p) =>
      1 +
      (p.lost ? 2 : 0) +
      (store.isGem(p) ? 2 : 0) +
      (['events', 'archaeology', 'graves', 'markers', 'military'].includes(p.category) ? 1.5 : 0) +
      (p.year != null && p.year < 1800 ? 1 : 0) -
      (p.category === 'everyday' ? 0.8 : 0);
    const total = pool.reduce((s, p) => s + weight(p), 0);
    let r = Math.random() * total;
    let pick = pool[0];
    for (const p of pool) {
      r -= weight(p);
      if (r <= 0) {
        pick = p;
        break;
      }
    }
    onSelect(pick.id, { from: 'surprise' });
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setToast('Your browser can’t share its location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setUserLocation(loc);
        setSelectedId(null);
        setCommand({ type: 'fly', ...loc, zoom: 16, key: Math.random() });
      },
      (err) => {
        setLocating(false);
        setToast(err.code === 1 ? 'Location permission was denied.' : 'Couldn’t get your location.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  const runSearch = async (e) => {
    e.preventDefault();
    const q = search.q.trim();
    if (!q) return;
    setSearch((s) => ({ ...s, loading: true, error: null, results: null }));
    try {
      const results = await searchPlaces(q);
      setSearch((s) => ({ ...s, loading: false, results }));
      if (results.length === 1) goToResult(results[0]);
    } catch (err) {
      setSearch((s) => ({ ...s, loading: false, error: err.message }));
    }
  };

  const goToResult = (r) => {
    setSelectedId(null);
    setSearch((s) => ({ ...s, results: null }));
    if (r.bbox) setCommand({ type: 'fit', bbox: r.bbox, key: Math.random() });
    else setCommand({ type: 'fly', lat: r.lat, lon: r.lon, zoom: 15, key: Math.random() });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (search.results) setSearch((s) => ({ ...s, results: null }));
        else if (selectedId) back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, search.results]);

  // ------------------------------------------------------------ status line

  const notes = [];
  if (view && view.zoom < MIN_WIKI_ZOOM) notes.push('Zoom in to load places from Wikipedia.');
  else if (store.notes.wiki === 'capped') notes.push('Busy area: zoom in to see everything.');
  else if (store.notes.wiki === 'radius') notes.push('Loaded about 10 km around the center. Pan around to load more.');
  if (filters.categories.markers && view && view.zoom >= MIN_WIKI_ZOOM && view.zoom < MIN_OSM_ZOOM)
    notes.push('Zoom in further for plaques & markers.');
  const errors = Object.entries(store.errors).map(([k, v]) => {
    const label = { wikipedia: 'Wikipedia', details: 'Wikipedia', wikidata: 'Wikidata', osm: 'OpenStreetMap' }[k];
    return `${label}: ${v}`;
  });

  const changed = countChanged(filters);
  // Changes hidden inside the collapsed "Type & era" section.
  const changedHidden = changed - ['lostOnly', 'gemsOnly', 'heritageOnly'].filter((k) => filters[k]).length;
  const saved = [...store.saved.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  // ------------------------------------------------------------ render

  return (
    <div className={`app ${sheetOpen ? 'sheet-open' : ''}`}>
      <MapView
        places={derived.onMap}
        selectedId={selectedId}
        onSelect={onSelect}
        onMove={onMove}
        initialView={initialView}
        command={command}
        userLocation={userLocation}
      />

      <aside className="panel" aria-label="Places">
        <div className="sheet-top" onTouchStart={onSheetTouchStart} onTouchEnd={onSheetTouchEnd}>
        <button
          className="sheet-handle"
          aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'}
          onClick={() => setSheetOpen((o) => !o)}
        >
          <span />
        </button>

        <header className="brand">
          <div className="brand-row">
            <h1>
              Local Lore
              {store.loading && <span className="spinner" aria-label="Loading" />}
            </h1>
            <div className="brand-actions">
              <button className="icon-button" onClick={locate} disabled={locating} title="Show what’s around me">
                {locating ? 'Locating…' : 'Near me'}
              </button>
              <button className="icon-button accent" onClick={surprise} title="Jump to a random interesting place">
                Surprise me
              </button>
            </div>
          </div>
          <form className="search" onSubmit={runSearch}>
            <input
              type="search"
              placeholder="Search a town or address"
              value={search.q}
              onInput={(e) => setSearch((s) => ({ ...s, q: e.currentTarget.value }))}
              onFocus={() => mobile && setSheetOpen(true)}
              aria-label="Search for a place"
            />
            <button type="submit" disabled={search.loading}>
              {search.loading ? '…' : 'Go'}
            </button>
          </form>
          {search.error && <p className="error small">{search.error}</p>}
          {search.results && (
            <ul className="search-results">
              {search.results.length === 0 && <li className="muted">No matches.</li>}
              {search.results.map((r, i) => (
                <li key={i}>
                  <button onClick={() => goToResult(r)}>{r.name}</button>
                </li>
              ))}
            </ul>
          )}
        </header>

        <nav className="tabs">
          <button className={tab === 'explore' ? 'on' : ''} onClick={() => setTab('explore')}>
            Explore
          </button>
          <button
            className={tab === 'saved' ? 'on' : ''}
            onClick={() => {
              setTab('saved');
              setSelectedId(null);
            }}
          >
            Saved{saved.length ? ` (${saved.length})` : ''}
          </button>
          {mobile && !sheetOpen && !selected && tab === 'explore' && (
            <span className="peek-count">
              {sorted.length.toLocaleString()} {sorted.length === 1 ? 'place' : 'places'} here
            </span>
          )}
        </nav>
        </div>

        <div className="panel-scroll" ref={listRef} tabIndex={-1}>
          {selected ? (
            <Detail
              place={selected}
              store={store}
              nearby={nearby}
              onBack={back}
              onSelect={onSelect}
              distance={origin ? distanceMeters(origin.lat, origin.lon, selected.lat, selected.lon) : null}
            />
          ) : tab === 'saved' ? (
            <div className="saved">
              {saved.length === 0 ? (
                <p className="empty">
                  Nothing saved yet. Open a place and tap <strong>☆ Save</strong> to keep it here. Saved places
                  stay in this browser only.
                </p>
              ) : (
                <ul className="list">
                  {saved.map((p) => (
                    <PlaceRow
                      key={p.id}
                      place={store.places.get(p.id) || p}
                      distance={origin ? distanceMeters(origin.lat, origin.lon, p.lat, p.lon) : null}
                      gem={false}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <QuickFlags
                filters={filters}
                setFilters={setFilters}
                changed={changedHidden}
                open={filtersOpen}
                onToggle={() => setFiltersOpen((o) => !o)}
              />
              {filtersOpen && (
                <Filters
                  filters={filters}
                  setFilters={setFilters}
                  counts={derived.counts}
                  eraCounts={derived.eraCounts}
                  lang={lang}
                  setLang={setLang}
                  changed={changed}
                  onReset={() => setFilters(defaultFilters())}
                />
              )}

              <div className="list-head">
                <span className="count-line">
                  <strong>{sorted.length.toLocaleString()}</strong> {sorted.length === 1 ? 'place' : 'places'} in view
                </span>
                <select value={sort} onChange={(e) => setSort(e.currentTarget.value)} aria-label="Sort by">
                  {SORTS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="name-filter"
                type="search"
                placeholder="Filter by name or text…"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
                aria-label="Filter places by text"
              />
              {(notes.length > 0 || errors.length > 0) && (
                <div className="notes">
                  {notes.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                  {errors.map((e) => (
                    <p key={e} className="error">
                      {e}
                    </p>
                  ))}
                </div>
              )}

              {sorted.length === 0 ? (
                <p className="empty">
                  {view && view.zoom < MIN_WIKI_ZOOM
                    ? 'Zoom in on somewhere to start digging.'
                    : store.loading
                      ? 'Digging through the archives…'
                      : changed > 0 || query
                        ? 'Nothing here matches your filters.'
                        : 'Nothing found here. Try panning around.'}
                </p>
              ) : (
                <ul className="list">
                  {sorted.slice(0, listLimit).map(({ place, d }) => (
                    <PlaceRow
                      key={place.id}
                      place={place}
                      distance={d}
                      gem={store.isGem(place)}
                      onSelect={onSelect}
                      selected={place.id === selectedId}
                    />
                  ))}
                </ul>
              )}
              {sorted.length > listLimit && (
                <button className="more" onClick={() => setListLimit((n) => n + LIST_PAGE)}>
                  Show {Math.min(LIST_PAGE, sorted.length - listLimit)} more
                </button>
              )}
            </>
          )}
        </div>
      </aside>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

render(<App />, document.getElementById('app'));
