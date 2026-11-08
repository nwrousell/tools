import { useState } from 'preact/hooks';
import { formatYear } from './classify.js';
import { PlaceRow } from './Panel.jsx';
import { PHOTO_WINDOW } from './time.js';

// Slider with a "built per period" histogram sitting on its track, a play button
// and the current year.
const STEPS = 1000;

export function TimeControls({ year, range, scale, hist, playing, onYear, onPlay }) {
  const max = Math.max(1, ...hist.map((c) => c.count));
  const n = hist.length;
  return (
    <div className="time-controls">
      <button
        className={`play ${playing ? 'on' : ''}`}
        onClick={onPlay}
        aria-label={playing ? 'Pause' : 'Play through the years'}
        title={playing ? 'Pause' : 'Play through the years'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" rx="1" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L5.2 1.5A.8.8 0 0 0 4 2.2z" />
          </svg>
        )}
      </button>
      <div className="time-track">
        <svg className="hist" viewBox={`0 0 ${n * 10} 40`} preserveAspectRatio="none" aria-hidden="true">
          {hist.map((c, i) => {
            const h = c.count ? Math.max(3, (c.count / max) * 38) : 0;
            return (
              <rect
                key={i}
                x={i * 10 + 1}
                y={40 - h}
                width="8"
                height={h}
                className={c.start <= year ? 'past' : 'future'}
              >
                <title>
                  {formatYear(c.start)}–{formatYear(Math.max(c.start, c.end))}: {c.count} built
                </title>
              </rect>
            );
          })}
        </svg>
        <input
          id="year-slider"
          type="range"
          min="0"
          max={STEPS}
          step="1"
          value={Math.round(scale.toPos(year) * STEPS)}
          onInput={(e) => onYear(scale.toYear(Number(e.currentTarget.value) / STEPS))}
          aria-label="Year"
          aria-valuetext={formatYear(year)}
        />
        <div className="time-ends" aria-hidden="true">
          <span>{formatYear(range.min)}</span>
          <span>{formatYear(range.max)}</span>
        </div>
      </div>
      <output className="time-year" htmlFor="year-slider">
        {formatYear(year)}
      </output>
    </div>
  );
}

function HistoryCard({ town, year, eventIndex, onYear }) {
  const [all, setAll] = useState(false);
  if (!town) return <p className="muted small-note">Finding out which town this is…</p>;
  const heading = <h3 className="time-h">{town.name} through time</h3>;
  if (town.status === 'loading')
    return (
      <section className="time-card">
        {heading}
        <p className="muted">Reading {town.name}’s history on Wikipedia…</p>
      </section>
    );
  if (town.status === 'error')
    return (
      <section className="time-card">
        {heading}
        <p className="error">Couldn’t load the town’s history. Pan a little to try again.</p>
      </section>
    );
  if (town.status === 'none' || !town.events.length)
    return (
      <section className="time-card">
        {heading}
        <p className="muted">No dated history found for {town.name} on this Wikipedia.</p>
      </section>
    );

  const events = town.events;
  const cur = eventIndex;
  const from = all ? 0 : Math.max(0, cur - 2);
  const to = all ? events.length : Math.min(events.length, Math.max(cur, 0) + 5);
  return (
    <section className="time-card">
      {heading}
      <ol className="events">
        {events.slice(from, to).map((e, i) => {
          const idx = from + i;
          return (
            <li key={idx}>
              <button
                className={`event ${idx === cur ? 'current' : ''} ${e.year > year ? 'later' : ''}`}
                onClick={() => onYear(e.year)}
              >
                <span className="event-year">{formatYear(e.year)}</span>
                <span className="event-text">{e.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="time-card-foot">
        <button className="link-button" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `All ${events.length} events`}
        </button>
        <span className="muted">
          From{' '}
          {town.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ', '}
              <a href={s.url} target="_blank" rel="noopener">
                {s.title}
              </a>
            </span>
          ))}
        </span>
      </div>
    </section>
  );
}

function PhotoStrip({ photos, year, note, onSelect }) {
  return (
    <section className="time-card">
      <h3 className="time-h">
        Photos from around {formatYear(year)}
        {photos.length > 0 && <span className="count"> {photos.length}</span>}
      </h3>
      {photos.length === 0 ? (
        <p className="muted">
          {note === 'zoom'
            ? 'Zoom in to look for old photos taken around here.'
            : `No dated photos from ${formatYear(year - PHOTO_WINDOW)}–${formatYear(year + PHOTO_WINDOW)} found here yet. Try another year or pan around.`}
        </p>
      ) : (
        <div className="photo-strip">
          {photos.map((p) => (
            <button key={p.id} className="photo-tile" onClick={() => onSelect(p.id, { from: 'list' })}>
              <img src={p.thumb} alt={p.title} loading="lazy" />
              <span>{formatYear(p.year)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function TimeBody({ year, stats, town, eventIndex, photos, photoNote, built, gone, onYear, onSelect, store }) {
  return (
    <div className="time-body">
      <p className="time-stats">
        <strong>{stats.standing.toLocaleString()}</strong> places standing in {formatYear(year)}
        {stats.fresh > 0 && (
          <>
            {' · '}
            <strong>{stats.fresh}</strong> built in the last 10 years
          </>
        )}
        {stats.undated > 0 && <span className="muted"> · {stats.undated.toLocaleString()} undated not shown</span>}
      </p>

      <HistoryCard town={town} year={year} eventIndex={eventIndex} onYear={onYear} />
      <PhotoStrip photos={photos} year={year} note={photoNote} onSelect={onSelect} />

      {built.length > 0 && (
        <section className="time-card">
          <h3 className="time-h">New around then</h3>
          <ul className="list">
            {built.map((p) => (
              <PlaceRow key={p.id} place={p} gem={store.isGem(p)} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      )}
      {gone.length > 0 && (
        <section className="time-card">
          <h3 className="time-h">Gone around then</h3>
          <ul className="list">
            {gone.map((p) => (
              <PlaceRow key={p.id} place={p} gem={store.isGem(p)} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
