import { useEffect, useState } from 'preact/hooks';
import { fetchExtract, parseSections } from './api.js';
import { CATEGORY_BY_ID, formatYear } from './classify.js';
import { formatDistance } from './util.js';

const extractCache = new Map();

function wikiUrl(p) {
  return `https://${p.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
}

function wikiLinkFromTag(tag) {
  // OSM style "en:Article title"
  const m = /^([a-z-]{2,12}):(.+)$/.exec(tag || '');
  if (!m) return null;
  return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}`;
}

function commonsThumb(tag) {
  if (!tag) return null;
  const file = tag.replace(/^File:/i, '');
  if (!file || /^Category:/i.test(tag)) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=480`;
}

function directionsUrl(p) {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
}

function yearLine(p) {
  if (p.year == null && p.endYear == null) return null;
  if (p.lost && p.endYear != null && p.year != null && p.endYear !== p.year)
    return `${formatYear(p.year)} – ${formatYear(p.endYear)}`;
  if (p.lost && p.endYear != null && p.year == null) return `Gone by ${formatYear(p.endYear)}`;
  return formatYear(p.year);
}

// mode: 'intro' | 'full' | null (don't fetch)
function useExtract(p, mode) {
  const key = p.source === 'wikipedia' && mode ? `${p.lang}:${p.pageid}:${mode}` : null;
  const [state, setState] = useState(() => (key && extractCache.get(key)) || null);
  useEffect(() => {
    if (!key) {
      setState(null);
      return;
    }
    if (extractCache.has(key)) {
      setState(extractCache.get(key));
      return;
    }
    setState({ loading: true });
    const ctrl = new AbortController();
    fetchExtract(p.lang, p.pageid, { intro: mode === 'intro' }, ctrl.signal)
      .then((text) => {
        const value = { sections: parseSections(text) };
        extractCache.set(key, value);
        setState(value);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setState({ error: e.message });
      });
    return () => ctrl.abort();
  }, [key]);
  return state;
}

function Sections({ sections }) {
  return sections.map((s, i) => (
    <section key={i} className="lore-section">
      {s.title && <h3 className={`h${Math.min(s.level, 4)}`}>{s.title}</h3>}
      {s.paragraphs.map((t, j) => (
        <p key={j}>{t}</p>
      ))}
    </section>
  ));
}

function WikiBody({ place }) {
  const [full, setFull] = useState(false);
  useEffect(() => setFull(false), [place.id]);
  const intro = useExtract(place, 'intro');
  const article = useExtract(place, full ? 'full' : null);
  const shown = full && (article?.sections || article?.error) ? article : intro;

  return (
    <div className="detail-body">
      {shown?.loading && <p className="muted">Loading…</p>}
      {shown?.error && <p className="error">Couldn’t load the article: {shown.error}</p>}
      {shown?.sections && <Sections sections={shown.sections} />}
      {shown?.sections && shown.sections.length === 0 && <p className="muted">This article has no text yet.</p>}
      {full && !article?.sections && !article?.error && <p className="muted">Loading the rest of the article…</p>}
      {!full && intro?.sections && (
        <button className="link-button" onClick={() => setFull(true)}>
          Keep reading ↓
        </button>
      )}
    </div>
  );
}

function OsmBody({ place }) {
  const subjectLink = wikiLinkFromTag(place.subjectWikipedia);
  const ownLink = wikiLinkFromTag(place.wikipedia);
  return (
    <div className="detail-body">
      {place.inscription && (
        <blockquote className={`plaque ${place.kind === 'Blue plaque' ? 'plaque-blue' : ''}`}>
          {place.inscription.replace(/\\n/g, '\n')}
        </blockquote>
      )}
      {place.note && place.note !== place.inscription && <p>{place.note}</p>}
      {place.subject && (
        <p>
          <strong>About:</strong>{' '}
          {subjectLink ? (
            <a href={subjectLink} target="_blank" rel="noopener">
              {place.subject}
            </a>
          ) : (
            place.subject
          )}
        </p>
      )}
      {place.installed && <p className="muted">Put up {place.installed}</p>}
      {ownLink && (
        <p>
          <a href={ownLink} target="_blank" rel="noopener">
            Wikipedia article ↗
          </a>
        </p>
      )}
      {!place.inscription && !place.note && (
        <p className="muted">No inscription has been transcribed for this one on OpenStreetMap yet.</p>
      )}
    </div>
  );
}

export function Detail({ place, store, nearby, onBack, onSelect, distance }) {
  const cat = CATEGORY_BY_ID[place.category];
  const img = place.thumb || (place.source === 'osm' ? commonsThumb(place.commons) : null);
  const [copied, setCopied] = useState(false);
  const years = yearLine(place);
  const gem = store.isGem(place);

  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: place.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <article className="detail">
      <button className="back" onClick={onBack}>
        ← Back to list
      </button>
      {img && (
        <div className="hero">
          <img src={img} alt="" loading="lazy" />
        </div>
      )}
      <div className="detail-head">
        <div className="eyebrow">
          <span className="dot" style={{ background: cat?.color }} />
          {place.source === 'osm' ? place.kind : cat?.label}
          {years && <span className="sep">·</span>}
          {years && <span>{years}</span>}
          {distance != null && <span className="sep">·</span>}
          {distance != null && <span>{formatDistance(distance)} away</span>}
        </div>
        <h2>{place.title}</h2>
        {place.description && place.source === 'wikipedia' && <p className="subtitle">{place.description}</p>}
        <div className="badges">
          {place.lost && <span className="badge badge-lost">Lost / former</span>}
          {gem && <span className="badge badge-gem">Hidden gem</span>}
          {place.heritage.map((h) => (
            <span key={h} className="badge badge-heritage">
              {h}
            </span>
          ))}
        </div>
        <div className="actions">
          <button className={`action ${place.saved ? 'on' : ''}`} onClick={() => store.toggleSaved(place.id)}>
            {place.saved ? '★ Saved' : '☆ Save'}
          </button>
          <a className="action" href={directionsUrl(place)} target="_blank" rel="noopener">
            Directions ↗
          </a>
          {place.source === 'wikipedia' ? (
            <a className="action" href={wikiUrl(place)} target="_blank" rel="noopener">
              Wikipedia ↗
            </a>
          ) : (
            <a
              className="action"
              href={`https://www.openstreetmap.org/${place.osmType}/${place.osmId}`}
              target="_blank"
              rel="noopener"
            >
              OpenStreetMap ↗
            </a>
          )}
          <button className="action" onClick={share}>
            {copied ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      {place.source === 'wikipedia' ? <WikiBody place={place} /> : <OsmBody place={place} />}

      {nearby.length > 0 && (
        <div className="nearby">
          <h3>Nearby</h3>
          <ul>
            {nearby.map(({ place: n, d }) => (
              <li key={n.id}>
                <button onClick={() => onSelect(n.id, { from: 'list' })}>
                  <span className="dot" style={{ background: CATEGORY_BY_ID[n.category]?.color }} />
                  <span className="nearby-title">{n.title}</span>
                  <span className="muted">{formatDistance(d)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {place.source === 'wikipedia' && (place.views != null || place.length != null) && (
        <p className="stats muted">
          {place.views != null && <>{place.views.toLocaleString()} views in the last 30 days</>}
          {place.views != null && place.length != null && ' · '}
          {place.length != null && <>{Math.round(place.length / 1000)} KB article</>}
        </p>
      )}
    </article>
  );
}
