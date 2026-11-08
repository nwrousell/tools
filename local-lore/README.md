# Local Lore

A map of the history hiding around you. Pan anywhere and it pulls in everything
with coordinates from Wikipedia, sorts it into kinds of lore, and lets you dig.

## Where the data comes from

All public, CORS-friendly APIs, no keys:

| Source | Used for |
| --- | --- |
| Wikipedia `list=geosearch` | articles with coordinates in the current view (bbox when zoomed in, 10 km radius otherwise; 500 max per query) |
| Wikipedia `prop=pageimages\|description\|info\|pageprops\|pageviews` | thumbnail, short description, article length, Wikidata id, 30-day views |
| Wikidata SPARQL | "instance of" types (+ one level of superclass), inception / event date, demolished date, heritage designation, state of conservation |
| Wikipedia `prop=extracts` | the intro (and the full article on "Keep reading") |
| Overpass (OpenStreetMap) | plaques, blue plaques, Stolpersteine and history boards, with their transcribed inscriptions; only at zoom ≥ 14 |
| Nominatim | place search |

Places accumulate as you explore, so zooming back out shows everything you've
loaded.

## Features

- **Types**: Wikidata types, then the short description, then the title, matched
  against keyword rules in `src/classify.js`. "Everyday & modern" (metro stations,
  modern schools, companies…) is hidden by default unless it's old, lost or listed.
- **Eras**: from the Wikidata inception / point-in-time / start date, or a year in
  the description.
- **Lost places**: has a Wikidata demolished date, or the description or types say
  former, demolished, ruins, ghost town…
- **Hidden gems**: the least-viewed third of what's loaded, among articles longer
  than about 2.5 KB. They're obscure but someone wrote them up properly.
- **Heritage-listed**: NRHP, listed buildings, monuments historiques, etc.
- **Wikipedia language switch**: local lore is often far better covered in the
  local-language Wikipedia.
- Near me, Surprise me (weighted toward lost, obscure, old and event-y places),
  saved places (in this browser only), shareable URLs (`#map=z/lat/lon&place=…`).

## Ideas not built yet

- Walking tour: pick N nearby places and route between them.
- "On this day": events nearby whose date matches today.
- Pull a "History" section specifically instead of the intro.
- More sources: Historical Marker Database (no public API), Commons geotagged
  old photos, local-language heritage registers.
- Pick the Wikipedia language automatically from the country you're looking at.
