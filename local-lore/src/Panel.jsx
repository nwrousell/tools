import { CATEGORIES, CATEGORY_BY_ID, ERAS, formatYear } from './classify.js';
import { formatDistance } from './util.js';

export const LANGUAGES = [
  ['en', 'English'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['pt', 'Português'],
  ['sv', 'Svenska'],
  ['no', 'Norsk'],
  ['da', 'Dansk'],
  ['fi', 'Suomi'],
  ['cs', 'Čeština'],
  ['ca', 'Català'],
  ['uk', 'Українська'],
  ['ru', 'Русский'],
  ['ja', '日本語'],
  ['zh', '中文'],
  ['ko', '한국어'],
];

export const SORTS = [
  ['near', 'Nearest'],
  ['old', 'Oldest first'],
  ['obscure', 'Least known first'],
  ['famous', 'Best known first'],
];

export function Filters({ filters, setFilters, counts, eraCounts, lang, setLang, changed, onReset }) {
  const toggle = (group, id) =>
    setFilters((f) => ({ ...f, [group]: { ...f[group], [id]: !f[group][id] } }));
  const only = (group, id) =>
    setFilters((f) => ({
      ...f,
      [group]: Object.fromEntries(Object.keys(f[group]).map((k) => [k, k === id])),
    }));
  const all = (group, value) =>
    setFilters((f) => ({ ...f, [group]: Object.fromEntries(Object.keys(f[group]).map((k) => [k, value])) }));
  const groupTools = (group) => (
    <span className="group-tools">
      <button className="link-button" onClick={() => all(group, true)}>
        all
      </button>
      <button className="link-button" onClick={() => all(group, false)}>
        none
      </button>
    </span>
  );

  return (
    <div className="filters">
      <div className="filter-group">
        <div className="filter-label">
          What
          {groupTools('categories')}
        </div>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`chip ${filters.categories[c.id] ? 'on' : ''}`}
              onClick={() => toggle('categories', c.id)}
              onDblClick={() => only('categories', c.id)}
              title={c.id === 'markers' ? 'Plaques, blue plaques and history boards mapped on OpenStreetMap' : undefined}
            >
              <span className="dot" style={{ background: c.color }} />
              {c.label}
              <span className="count">{counts[c.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="filter-label">
          When
          {groupTools('eras')}
        </div>
        <div className="chips">
          {ERAS.map((e) => (
            <button
              key={e.id}
              className={`chip ${filters.eras[e.id] ? 'on' : ''}`}
              onClick={() => toggle('eras', e.id)}
              onDblClick={() => only('eras', e.id)}
            >
              {e.label}
              <span className="count">{eraCounts[e.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-row">
        <label className="lang">
          Wikipedia
          <select value={lang} onChange={(e) => setLang(e.currentTarget.value)}>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {changed > 0 && (
          <button className="link-button" onClick={onReset}>
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}

export function QuickFlags({ filters, setFilters, changed, open, onToggle }) {
  const flag = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }));
  return (
    <div className="quick">
      <div className="chips">
        <button
          className={`chip flag ${filters.lostOnly ? 'on' : ''}`}
          onClick={() => flag('lostOnly')}
          title="Demolished buildings, ruins, former villages: things that are gone"
        >
          † Lost places
        </button>
        <button
          className={`chip flag ${filters.gemsOnly ? 'on' : ''}`}
          onClick={() => flag('gemsOnly')}
          title="Substantial articles that few people read: the least-viewed third of what's loaded"
        >
          ◆ Hidden gems
        </button>
        <button
          className={`chip flag ${filters.heritageOnly ? 'on' : ''}`}
          onClick={() => flag('heritageOnly')}
          title="Officially protected: NRHP, listed buildings, monuments historiques…"
        >
          Heritage-listed
        </button>
        <button className={`chip flag more-filters ${open ? 'open' : ''}`} onClick={onToggle} aria-expanded={open}>
          {open ? '▾' : '▸'} Type &amp; era
          {changed > 0 && <span className="pill">{changed}</span>}
        </button>
      </div>
    </div>
  );
}

export function PlaceRow({ place, distance, gem, onSelect, selected }) {
  const cat = CATEGORY_BY_ID[place.category];
  return (
    <li>
      <button className={`row ${selected ? 'selected' : ''}`} onClick={() => onSelect(place.id, { from: 'list' })}>
        {place.thumb ? (
          <img className="thumb" src={place.thumb} alt="" loading="lazy" />
        ) : (
          <span className="thumb thumb-empty" style={{ '--c': cat?.color }} />
        )}
        <span className="row-text">
          <span className="row-title">{place.title}</span>
          <span className="row-meta">
            <span className="dot" style={{ background: cat?.color }} />
            {place.source === 'osm' ? place.kind : cat?.label}
            {place.year != null && <> · {formatYear(place.year)}</>}
            {distance != null && <> · {formatDistance(distance)}</>}
          </span>
          {(place.source === 'osm' ? place.inscription : place.description) && (
            <span className="row-desc">{place.source === 'osm' ? place.inscription : place.description}</span>
          )}
        </span>
        <span className="row-flags">
          {place.lost && (
            <span className="flag-icon lost" title="Lost / former">
              †
            </span>
          )}
          {gem && (
            <span className="flag-icon gem" title="Hidden gem">
              ◆
            </span>
          )}
          {place.saved && (
            <span className="flag-icon saved" title="Saved">
              ★
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
