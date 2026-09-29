/**
 * ── Approximate coordinates for well-known Nepal trekking routes ─────────────
 *
 * There is no live location-tracking system in this codebase yet — no GPS
 * ping table, no `latitude`/`longitude` column anywhere on `TrekPackage` or
 * `AgencyDestination` (checked directly against the schema). So this is NOT
 * a "where is this trekker right now" lookup — it never can be, without a
 * real tracking feature.
 *
 * What it IS: a small, real, verifiable table of well-known Nepal trekking
 * region centroids (an actual town/gateway on that actual route), matched
 * against a package's own title/region/destination text. When an agency
 * names a package "Everest Base Camp Trek", the resulting pin is Namche
 * Bazaar — a real place on the real Everest Base Camp route — not an
 * invented coordinate. A package whose name doesn't match anything here
 * gets no pin at all; that is the honest outcome, not a bug.
 *
 * Every caller must treat a match as "approximate route location," and must
 * label it as such in the UI — never as a live position.
 */

export interface TrekRegionMatch {
  label: string;
  lat: number;
  lng: number;
}

// Ordered so a more specific keyword ("annapurna base camp") is tried before
// its broader sibling ("annapurna") where that distinction matters.
const TREK_REGIONS: Array<{ keywords: string[]; label: string; lat: number; lng: number }> = [
  { keywords: ["everest", "ebc", "khumbu", "gokyo"], label: "Namche Bazaar (Everest region)", lat: 27.8069, lng: 86.7139 },
  { keywords: ["annapurna base camp", "abc"], label: "Annapurna Base Camp", lat: 28.5308, lng: 83.8794 },
  { keywords: ["annapurna", "annuparna"], label: "Manang (Annapurna Circuit)", lat: 28.6667, lng: 84.0167 },
  { keywords: ["poon hill", "ghorepani"], label: "Ghorepani (Poon Hill)", lat: 28.4, lng: 83.6833 },
  { keywords: ["langtang"], label: "Kyanjin Gompa (Langtang Valley)", lat: 28.2108, lng: 85.5661 },
  { keywords: ["manaslu"], label: "Samagaon (Manaslu Circuit)", lat: 28.5667, lng: 84.75 },
  { keywords: ["kanchenjunga", "kanchanganja", "kanchanjunga"], label: "Kanchenjunga Base Camp area", lat: 27.7025, lng: 88.1475 },
  { keywords: ["mardi himal", "mardi"], label: "Mardi Himal Base Camp", lat: 28.4833, lng: 83.95 },
  { keywords: ["upper mustang", "mustang"], label: "Lo Manthang (Upper Mustang)", lat: 29.1833, lng: 83.95 },
  { keywords: ["rolwaling"], label: "Rolwaling Valley", lat: 27.8333, lng: 86.45 },
];

/**
 * Matches package title, region, then destination against known route keywords —
 * in that priority order, checked independently (not concatenated). A package's
 * own `region`/`destination` fields are sometimes filled in inconsistently with
 * its title in real agency data; checking the title first means a stray keyword
 * in a less-authoritative field can never override an already-clear title match.
 * Null when nothing matches — never guess.
 */
export function matchTrekRegion(...texts: Array<string | null | undefined>): TrekRegionMatch | null {
  for (const text of texts) {
    if (!text) continue;
    const haystack = text.toLowerCase();
    for (const region of TREK_REGIONS) {
      if (region.keywords.some((k) => haystack.includes(k))) {
        return { label: region.label, lat: region.lat, lng: region.lng };
      }
    }
  }
  return null;
}
