import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_BY_ID } from './classify.js';

// OpenStreetMap's own tiles: free, no key, attribution required. Their colors are
// muted (and inverted for dark mode) with a CSS filter on .lore-tiles.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Places: <a href="https://www.wikipedia.org/">Wikipedia</a>, <a href="https://www.wikidata.org/">Wikidata</a>, OSM';

function viewOf(map) {
  const b = map.getBounds();
  const c = map.getCenter();
  return {
    n: b.getNorth(),
    s: b.getSouth(),
    e: b.getEast(),
    w: b.getWest(),
    lat: c.lat,
    lon: L.Util.wrapNum(c.lng, [-180, 180], true),
    zoom: map.getZoom(),
  };
}

function radiusFor(p) {
  if (p.source === 'osm') return 5;
  if (p.views == null) return 5;
  // ~4px for a few views a day up to ~10px for very famous places.
  const lv = Math.log10(p.views + 1);
  return 4 + Math.max(0, Math.min(6, (lv - 1.5) * 1.6));
}

function styleFor(p, selected, dark) {
  const color = CATEGORY_BY_ID[p.category]?.color || '#999';
  const r = radiusFor(p);
  return {
    radius: selected ? r + 4 : r,
    color: selected ? (dark ? '#fff' : '#1d1a16') : dark ? '#1d1a16' : '#ffffff',
    weight: selected ? 3 : 1.5,
    fillColor: color,
    fillOpacity: p.lost ? 0.45 : 0.92,
    dashArray: p.lost && !selected ? '2 2' : null,
  };
}

// Phones: no hover tooltips, and a generous tap area around each dot.
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const canHover = window.matchMedia?.('(hover: hover)').matches ?? true;
const renderer = L.canvas({ padding: 0.5, tolerance: coarsePointer ? 12 : 3 });

function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function MapView({ places, selectedId, onSelect, onMove, initialView, command, userLocation }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // id -> { marker, sig }
  const darkRef = useRef(prefersDark());
  const onSelectRef = useRef(onSelect);
  const onMoveRef = useRef(onMove);
  const selectedRef = useRef(selectedId);
  const userLayerRef = useRef(null);
  onSelectRef.current = onSelect;
  onMoveRef.current = onMove;

  // Create the map once.
  useEffect(() => {
    const map = L.map(elRef.current, {
      preferCanvas: true,
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 3,
    }).setView([initialView.lat, initialView.lon], initialView.zoom);
    mapRef.current = map;
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.attributionControl.setPrefix(false);

    L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxNativeZoom: 19,
      maxZoom: 20,
      className: 'lore-tiles',
    }).addTo(map);

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => {
      darkRef.current = mq.matches;
      for (const [id, entry] of markersRef.current) {
        entry.marker.setStyle(styleFor(entry.place, id === selectedRef.current, darkRef.current));
      }
    };
    mq?.addEventListener?.('change', onScheme);

    let t = 0;
    map.on('moveend', () => {
      clearTimeout(t);
      t = setTimeout(() => onMoveRef.current(viewOf(map)), 250);
    });
    map.on('click', () => onSelectRef.current(null, { from: 'map' }));
    onMoveRef.current(viewOf(map));

    return () => {
      mq?.removeEventListener?.('change', onScheme);
      clearTimeout(t);
      map.remove();
    };
  }, []);

  const nearestMarker = (pt) => {
    const map = mapRef.current;
    if (!map || !pt) return null;
    let best = null;
    let bestD = Infinity;
    for (const [id, { marker }] of markersRef.current) {
      const d = map.latLngToContainerPoint(marker.getLatLng()).distanceTo(pt);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return bestD <= 40 ? best : null;
  };

  // Sync markers with the filtered place list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const keep = new Set();
    for (const p of places) {
      keep.add(p.id);
      const sig = `${p.category}|${p.lost}|${p.views}`;
      const existing = markers.get(p.id);
      if (existing) {
        existing.place = p;
        if (existing.sig !== sig) {
          existing.sig = sig;
          existing.marker.setStyle(styleFor(p, p.id === selectedRef.current, darkRef.current));
        }
        continue;
      }
      const marker = L.circleMarker([p.lat, p.lon], {
        ...styleFor(p, p.id === selectedRef.current, darkRef.current),
        bubblingMouseEvents: false,
        renderer,
      });
      if (canHover) {
        marker.bindTooltip(() => markers.get(p.id)?.place.title ?? p.title, {
          direction: 'top',
          offset: [0, -6],
          className: 'lore-tooltip',
        });
      }
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        // With a big touch radius several dots can match; pick the nearest, not the top-most.
        // (Leaflet's e.containerPoint is the dot's own position for small circles, so use
        // the raw pointer position instead.)
        const pt = e.originalEvent ? mapRef.current.mouseEventToContainerPoint(e.originalEvent) : null;
        onSelectRef.current(nearestMarker(pt) ?? p.id, { from: 'map' });
      });
      marker.addTo(map);
      markers.set(p.id, { marker, sig, place: p });
    }
    for (const [id, entry] of markers) {
      if (!keep.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
    const sel = markers.get(selectedRef.current);
    if (sel) sel.marker.bringToFront();
  }, [places]);

  // Selection highlight.
  useEffect(() => {
    const markers = markersRef.current;
    const prev = markers.get(selectedRef.current);
    if (prev) prev.marker.setStyle(styleFor(prev.place, false, darkRef.current));
    selectedRef.current = selectedId;
    const next = markers.get(selectedId);
    if (next) {
      next.marker.setStyle(styleFor(next.place, true, darkRef.current));
      next.marker.bringToFront();
    }
  }, [selectedId]);

  // Imperative commands from the app: fly somewhere, fit a box.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !command) return;
    if (command.type === 'fit') {
      const [s, n, w, e] = command.bbox;
      map.flyToBounds(
        [
          [s, w],
          [n, e],
        ],
        { maxZoom: 16, duration: 0.8 },
      );
    } else if (command.type === 'fly') {
      const zoom = command.zoom ?? Math.max(map.getZoom(), 16);
      let target = L.latLng(command.lat, command.lon);
      if (command.offsetY) {
        // Shift so the point lands in the middle of the visible (uncovered) map area.
        const pt = map.project(target, zoom).add([0, command.offsetY]);
        target = map.unproject(pt, zoom);
      }
      if (command.instant) map.setView(target, zoom);
      else map.flyTo(target, zoom, { duration: 0.8 });
    }
  }, [command]);

  // "You are here" dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userLayerRef.current?.remove();
    userLayerRef.current = null;
    if (!userLocation) return;
    const group = L.layerGroup([
      L.circle([userLocation.lat, userLocation.lon], {
        radius: Math.min(userLocation.accuracy || 0, 500),
        color: '#1c7ed6',
        weight: 1,
        fillOpacity: 0.08,
        interactive: false,
      }),
      L.circleMarker([userLocation.lat, userLocation.lon], {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#1c7ed6',
        fillOpacity: 1,
        interactive: false,
      }),
    ]).addTo(map);
    userLayerRef.current = group;
  }, [userLocation]);

  return <div ref={elRef} className="map" />;
}
