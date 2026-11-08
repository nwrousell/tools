// Turns the messy signals we get from Wikipedia / Wikidata / OSM into a
// category, a year, and a few flags (lost, heritage-listed).
//
// Signals, strongest first: Wikidata "instance of" labels, their superclass
// labels, the Wikipedia short description, then the article title.

export const CATEGORIES = [
  { id: 'events', label: 'Events & disasters', color: '#e03131' },
  { id: 'military', label: 'Battles & forts', color: '#8b5a2b' },
  { id: 'memorials', label: 'Monuments & memorials', color: '#7048e8' },
  { id: 'graves', label: 'Cemeteries & graves', color: '#5c6670' },
  { id: 'archaeology', label: 'Ancient & archaeological', color: '#7c8a1e' },
  { id: 'religious', label: 'Religious sites', color: '#3b5bdb' },
  { id: 'buildings', label: 'Historic buildings', color: '#f08c00' },
  { id: 'industry', label: 'Industry & transport', color: '#0c8599' },
  { id: 'culture', label: 'Museums & institutions', color: '#2f9e44' },
  { id: 'places', label: 'Neighborhoods & landscape', color: '#4dabf7' },
  { id: 'markers', label: 'Plaques & markers', color: '#c99700' },
  { id: 'other', label: 'Other', color: '#9aa1a8' },
  { id: 'everyday', label: 'Everyday & modern', color: '#c3c8cd', defaultOff: true },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export const ERAS = [
  { id: 'ancient', label: 'Before 1500', test: (y) => y < 1500 },
  { id: 'early', label: '1500–1799', test: (y) => y >= 1500 && y < 1800 },
  { id: 'c19', label: '1800s', test: (y) => y >= 1800 && y < 1900 },
  { id: 'c20', label: '1900–1945', test: (y) => y >= 1900 && y < 1946 },
  { id: 'modern', label: '1946–now', test: (y) => y >= 1946 },
  { id: 'undated', label: 'Undated', test: () => false },
];

export function eraOf(year) {
  if (year == null) return 'undated';
  for (const e of ERAS) if (e.test(year)) return e.id;
  return 'undated';
}

// Checked before everything else; things that are usually not "lore"
// (transit stops, modern schools, companies, roads...). Overridden when the
// place is old, lost or heritage-listed.
const EVERYDAY =
  /\b(metro station|subway station|underground station|light rail station|tram stop|tram station|bus station|bus stop|bus terminal|transit station|commuter rail station|mrt station|lrt station|s-bahn station|u-bahn station|rer station|station on the|railway station|train station|high school|elementary school|primary school|secondary school|middle school|junior high|public school|charter school|private school|school district|preschool|kindergarten|company|corporation|headquarters|business|retailer|restaurant chain|supermarket|shopping (mall|centre|center)|mall|office building|office tower|skyscraper|high-rise|apartment building|condominium|residential building|stadium|arena|sports venue|ballpark|ice rink|golf course|car park|parking|highway|motorway|interstate|expressway|freeway|state route|interchange|radio station|television station|tv station|broadcaster|electoral (ward|division|district)|constituency|county|census tract)\b/;

const RULES = [
  [
    'memorials',
    /\b(memorial|(?<!(scheduled|national|ancient|historic|historical|listed) )monument|statue|sculpture|obelisk|plaque|bust|cenotaph|public art|fountain|mural|commemorat\w*|equestrian)\b/,
  ],
  [
    'events',
    /\b(disaster|massacre|riots?|murders?|killings?|shootings?|bombing|explosion|flood|flooding|earthquake|fire of|great fire|conflagration|shipwrecks?|wreck|sinking|accident|crash|derailment|collision|incident|assassination|lynching|protest|uprising|rebellion|revolt|tragedy|hurricane|tornado|epidemic|eruption|heist|robbery|duel|execution|tea party|historical event|event)\b/,
    // Exact Wikidata class labels that are too short to regex safely.
    /^(fire|urban fire|wildfire|strike|labor strike|trial)$/,
  ],
  [
    'archaeology',
    /\b(archaeolog\w*|ruins?|ruined|prehistoric|neolithic|bronze age|iron age|mesolithic|paleolithic|megalith\w*|standing stones?|stone circle|henge|dolmen|menhir|cairns?|barrows?|tumulus|burial mound|mounds?|earthworks?|hill ?fort|roman (villa|fort|road|bath|baths|camp|town)|ancient|petroglyphs?|rock art|pueblo|cliff dwelling|scheduled (ancient )?monument|excavation|hoard)\b/,
  ],
  [
    'graves',
    /\b(cemetery|cemeteries|graveyard|churchyard|burial|burying ground|graves?|tombs?|mausoleum|crypt|necropolis|ossuary|catacombs?)\b/,
  ],
  [
    'military',
    /\b(battles?|battlefield|siege|raid|skirmish|forts?|fortress|fortification|fortified|castle|citadel|bastion|redoubt|barracks|armou?ry|arsenal|military|naval|navy|army|bunker|blockhouse|battery|garrison|war)\b/,
  ],
  [
    'religious',
    /\b(church|churches|chapel|cathedral|basilica|minster|abbey|priory|monastery|convent|nunnery|friary|synagogue|mosque|temple|shrine|meeting ?house|oratory|mission|gurdwara|pagoda|stupa|kirk|baptistery|religious|quaker|hermitage)\b/,
  ],
  [
    'industry',
    /\b(mill|mills|factory|works|mine|mines|mining|colliery|quarry|brewery|distillery|foundry|furnace|kiln|forge|tannery|warehouse|wharf|pier|docks?|shipyard|harbou?r|port|canal|lock|aqueduct|viaduct|bridge|railway|railroad|rail|tramway|tunnel|lighthouse|light station|dam|reservoir|waterworks|pumping station|power station|gasworks|windmill|watermill|signal box|roundhouse|depot|turnpike|toll|ferry|industrial|engine house|smokestack|chimney|water tower)\b/,
  ],
  [
    'culture',
    /\b((?<!house )museum|library|libraries|theat(re|er)|opera|cinema|movie palace|music hall|concert hall|gallery|school|schoolhouse|college|university|academy|seminary|institute|observatory|hospital|asylum|sanatorium|infirmary|almshouse|poorhouse|workhouse|orphanage|prison|jail|gaol|penitentiary|court ?house|town hall|city hall|capitol|post office|custom ?house|fire station|firehouse|police station|club|lodge|masonic|society|archives?|newspaper|zoo|botanical gardens?|arboretum|aquarium)\b/,
  ],
  [
    'buildings',
    /\b(house|houses|home|homestead|mansion|manor|hall|villa|cottage|cabin|farm|farmhouse|farmstead|plantation|ranch|estate|palace|ch[aâ]teau|residence|building|block|terrace|tower|inn|tavern|pub|hotel|saloon|store|shop|market|bank|exchange|arcade|barn|gatehouse|townhouse|brownstone|tenement|listed building|structure)\b/,
  ],
  [
    'places',
    /\b(neighbou?rhood|district|quarter|village|hamlet|town|city|settlement|community|ghost town|borough|suburb|square|plaza|piazza|street|alley|lane|road|avenue|common|green|park|gardens?|island|hill|mountain|mount|peak|river|creek|brook|stream|lake|pond|bay|cove|beach|cape|point|cave|cavern|waterfall|falls|springs?|forest|woods?|tree|rock|valley|gorge|canyon|marsh|swamp|meadow|cliff|headland|peninsula|locality|area|region)\b/,
  ],
];

const LOST =
  /\b(former|formerly|demolished|destroyed|defunct|razed|burned down|burnt down|no longer (exists|extant|standing)|lost|ghost town|abandoned|deserted|vanished|site of|sunken|submerged|drowned|dissolved|ruins?|ruined|partly demolished|disused)\b/;

const HERITAGE_TEXT =
  /\b(national register of historic places|nrhp|national historic landmark|grade (i|ii\*?|ii) listed|listed building|scheduled monument|monument historique|rijksmonument|heritage[- ]listed|heritage site|world heritage)\b/i;

// Within one tier, category priority wins over label order, so a generic
// label ("building") never beats a specific one ("lighthouse").
function firstMatch(rawTexts, skipEveryday) {
  const texts = rawTexts.filter(Boolean).map((t) => t.toLowerCase());
  if (!texts.length) return null;
  if (!skipEveryday && texts.some((t) => EVERYDAY.test(t))) return 'everyday';
  for (const [id, re, exact] of RULES) {
    if (texts.some((t) => re.test(t) || (exact && exact.test(t)))) return id;
  }
  return null;
}

function categorize(p, skipEveryday) {
  // Each tier is tested in full before falling through to the next weaker one.
  const tiers = [p.classes, p.supers, [p.description], [p.title]];
  for (const tier of tiers) {
    const hit = firstMatch(tier || [], skipEveryday);
    if (hit) return hit;
  }
  return null;
}

export function parseYear(value) {
  if (value == null) return null;
  const m = /^(-?)0*(\d{1,4})-/.exec(String(value)) || /^(-?)0*(\d{1,4})$/.exec(String(value));
  if (!m) return null;
  const y = Number(m[2]) * (m[1] ? -1 : 1);
  return Number.isFinite(y) ? y : null;
}

const YEAR_IN_TEXT = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

export function yearFromText(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = YEAR_IN_TEXT.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

const HERITAGE_SHORT = [
  [/^National Register of Historic Places listed place$/i, 'NRHP listed'],
  [/^National Historic Landmark$/i, 'National Historic Landmark'],
  [/^contributing property$/i, null],
];

export function shortHeritage(label) {
  for (const [re, short] of HERITAGE_SHORT) if (re.test(label)) return short;
  return label.length > 42 ? label.slice(0, 40) + '…' : label;
}

// Mutates and returns the place.
export function classify(p) {
  if (p.source === 'osm') {
    p.category = 'markers';
    p.lost = false;
    return p;
  }

  const allText = [...(p.classes || []), ...(p.states || []), p.description || ''].join(' | ').toLowerCase();

  p.lost = Boolean(p.lostByData) || LOST.test(allText);

  if (p.year == null && p.dataYear != null) p.year = p.dataYear;
  if (p.year == null) p.year = yearFromText(p.description, p.title);

  const heritage = (p.heritageData || []).map(shortHeritage).filter(Boolean);
  if (!heritage.length) {
    const m = HERITAGE_TEXT.exec(p.description || '');
    if (m) heritage.push(m[0].replace(/^./, (c) => c.toUpperCase()));
  }
  p.heritage = heritage;

  let cat = categorize(p, false);
  if (cat === 'everyday' && (p.heritage.length || p.lost || (p.year != null && p.year < 1920))) {
    cat = categorize(p, true) || 'buildings';
  }
  p.category = cat || 'other';
  return p;
}

export function formatYear(y) {
  if (y == null) return '';
  return y < 0 ? `${-y} BC` : String(y);
}
