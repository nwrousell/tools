// Time-travel helpers: what was standing in a given year, the decade histogram,
// and pulling dated events out of Wikipedia history text.

export const THIS_YEAR = new Date().getFullYear();

const EVENTISH = /\b(battles?|siege|raid|skirmish|massacre|riot|disaster|fire|flood|explosion|wreck|accident|crash|earthquake|hurricane|epidemic|protest|strike|assassination|murder)\b/i;

// Things that happened (rather than were built) only show up around their year.
export function isEvent(p) {
  if (p.category === 'events') return true;
  if (p.category !== 'military') return false;
  const text = [...(p.classes || []), p.description || '', p.title].join(' ');
  return /\b(battle|siege|raid|skirmish|massacre)\b/i.test(text);
}

export const EVENT_WINDOW = 5; // years an event stays on the map

// 'standing' | 'event' | null (not on the map in that year)
export function presenceAt(p, year) {
  if (p.year == null) return null;
  if (isEvent(p)) return year >= p.year && year - p.year <= EVENT_WINDOW ? 'event' : null;
  if (p.year > year) return null;
  if (p.endYear != null && p.endYear <= year) return null;
  return 'standing';
}

export const FRESH_WINDOW = 10; // "built in the last N years" highlight

export function isFresh(p, year) {
  return p.year != null && !isEvent(p) && year - p.year >= 0 && year - p.year < FRESH_WINDOW;
}

// Slider range: from just before the bulk of dated places to today. A handful of
// very old outliers (a 3000 BC shell midden) shouldn't squash the whole scale.
export function yearRange(places) {
  const years = places.map((p) => p.year).filter((y) => y != null).sort((a, b) => a - b);
  if (years.length < 3) return { min: 1600, max: THIS_YEAR };
  const lo = years[Math.floor(years.length * 0.03)];
  const min = Math.max(-3000, Math.min(1900, Math.floor((lo - 10) / 10) * 10));
  return { min, max: THIS_YEAR };
}

// Where to open time travel: early in the story, but with something on the map.
export function startYear(places, range) {
  const years = places.map((p) => p.year).filter((y) => y != null).sort((a, b) => a - b);
  if (!years.length) return range.min;
  return Math.max(range.min, Math.min(range.max, years[Math.floor(years.length * 0.15)]));
}

// Slider position (0..1) <-> year. Linear for towns whose story starts after the
// Middle Ages; otherwise everything before 1500 gets the first quarter of the track
// so Roman ruins don't squash the last 500 years into a sliver.
const SPLIT_YEAR = 1500;
const SPLIT_POS = 0.25;

export function makeScale({ min, max }) {
  const lin = (a, b, t) => a + (b - a) * t;
  if (min >= SPLIT_YEAR - 200) {
    return {
      toYear: (pos) => Math.round(lin(min, max, pos)),
      toPos: (y) => (y - min) / Math.max(1, max - min),
    };
  }
  return {
    toYear: (pos) =>
      Math.round(
        pos <= SPLIT_POS
          ? lin(min, SPLIT_YEAR, pos / SPLIT_POS)
          : lin(SPLIT_YEAR, max, (pos - SPLIT_POS) / (1 - SPLIT_POS)),
      ),
    toPos: (y) =>
      y <= SPLIT_YEAR
        ? ((y - min) / (SPLIT_YEAR - min)) * SPLIT_POS
        : SPLIT_POS + ((y - SPLIT_YEAR) / (max - SPLIT_YEAR)) * (1 - SPLIT_POS),
  };
}

// Places built per equal-width stretch of the slider.
export function histogram(places, scale, buckets = 40) {
  const counts = new Array(buckets).fill(0);
  for (const p of places) {
    if (p.year == null || isEvent(p)) continue;
    const pos = Math.max(0, Math.min(0.9999, scale.toPos(p.year)));
    counts[Math.floor(pos * buckets)]++;
  }
  return counts.map((count, i) => ({
    start: scale.toYear(i / buckets),
    end: scale.toYear((i + 1) / buckets) - 1,
    count,
  }));
}

// ---------------------------------------------------------------- events from text

const sane = (y) => y >= 500 && y <= THIS_YEAR;

// "1630", "c. 1630", "1630s"
const YEAR_ONLY = /^(?:c\.\s*|circa\s+|ca\.\s*)?(\d{3,4})s?\s*[.:]?$/i;
// "1630 – Boston founded", "1630: ...", "1630s - ..."
const YEAR_LEAD = /^(?:c\.\s*|circa\s+|ca\.\s*)?(\d{3,4})s?\s*(?:[–—:]|-\s)\s*(.+)$/i;

// Wikipedia "Timeline of X" articles: list items like "1630 – ...", or a bare year
// line followed by the events of that year.
export function eventsFromTimeline(sections) {
  const out = [];
  for (const s of sections) {
    let current = null;
    for (const line of s.paragraphs) {
      const lead = YEAR_LEAD.exec(line);
      if (lead && sane(+lead[1])) {
        current = +lead[1];
        out.push({ year: current, text: lead[2].trim() });
        continue;
      }
      const only = YEAR_ONLY.exec(line);
      if (only && sane(+only[1])) {
        current = +only[1];
        continue;
      }
      if (current != null && line.length <= 400) out.push({ year: current, text: line });
    }
  }
  return tidy(out);
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/;
const YEAR_IN = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

// Prose history: every sentence that mentions a year becomes an event at that year.
export function eventsFromProse(sections) {
  const out = [];
  for (const s of sections) {
    for (const para of s.paragraphs) {
      for (const sentence of para.split(SENTENCE_SPLIT)) {
        const t = sentence.trim();
        if (t.length < 25 || t.length > 360) continue;
        const m = YEAR_IN.exec(t);
        if (m && sane(+m[1])) out.push({ year: +m[1], text: t });
      }
    }
  }
  return tidy(out);
}

function tidy(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const text = e.text.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ year: e.year, text });
  }
  return out.sort((a, b) => a.year - b.year).slice(0, 400);
}

const HISTORY_HEAD = /histor|geschichte|histoire|historia|storia|geschiedenis|historie|dzieje|история|історія|歴史|历史|역사/i;

// The History section of a town article, with its sub-sections.
export function historySections(sections) {
  const out = [];
  let level = 0;
  for (const s of sections) {
    if (level && s.level > level) {
      out.push(s);
      continue;
    }
    level = 0;
    if (s.title && HISTORY_HEAD.test(s.title)) {
      level = s.level;
      out.push(s);
    }
  }
  return out;
}

// Latest event at or before the year (what the narrator says).
export function eventAt(events, year) {
  let lo = 0;
  let hi = events.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].year <= year) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// Old photos: parse a year out of Commons' DateTimeOriginal (often HTML or free text).
export function photoYear(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/<[^>]*>/g, ' ');
  const m = /\b(18[2-9][0-9]|19[0-9]{2}|20[0-2][0-9])\b/.exec(text);
  return m ? Number(m[1]) : null;
}

export const PHOTO_MAX_YEAR = 1965;
export const PHOTO_WINDOW = 12; // show photos within ±N years of the slider

// DOMParser documents are inert: no scripts run and no images load, so this is
// safe for untrusted HTML from Commons metadata.
const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

export function stripHtml(html) {
  if (!html) return '';
  const text = parser
    ? parser.parseFromString(String(html), 'text/html').body.textContent || ''
    : String(html).replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}
