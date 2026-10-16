'use strict';

// Country geometry on the server, from the same simplified world map the browser uses.
// For every country: the outline (GeoJSON), a centre point (the centre of its biggest piece of
// land, so the Netherlands isn't pulled towards the Caribbean) and a rough size.
// Used by the daily quiz (shape, distance + direction hints) and the distance records.

const path = require('path');
const topojson = require('topojson-client');
const L = require('./public/countries.js');

const EARTH_RADIUS_KM = 6371;
const EARTH_CIRCUMFERENCE_KM = 40075;

let cache = null;

// Planar area and centroid of one ring in lon/lat degrees (good enough for one country's main land).
function ringStats(ring) {
  // A ring that crosses the date line: shift its western half by 360° first.
  const lons = ring.map((p) => p[0]);
  const wraps = Math.max(...lons) - Math.min(...lons) > 180;
  const pts = wraps ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f;
    cx += (pts[j][0] + pts[i][0]) * f;
    cy += (pts[j][1] + pts[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate (a dot-sized country): average of the points.
    const n = pts.length || 1;
    return { area: 0, centroid: [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n] };
  }
  let lon = cx / (3 * a);
  if (lon > 180) lon -= 360;
  return { area: Math.abs(a / 2), centroid: [lon, cy / (3 * a)] };
}

function load() {
  if (cache) return cache;
  const world = require(path.join(__dirname, 'public', 'data', 'world.json'));
  // Some ids occur more than once (e.g. Australia and the Ashmore and Cartier Islands): merge them.
  const byId = new Map();
  topojson.feature(world, world.objects.countries).features.forEach((f) => {
    if (!f.geometry) return;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    byId.set(String(f.id), [...(byId.get(String(f.id)) || []), ...polys]);
  });
  const countries = new Map();
  L.COUNTRIES.forEach((c) => {
    const polys = byId.get(c.id);
    if (!polys) return;
    let best = null;
    let total = 0;
    polys.forEach((poly) => {
      const s = ringStats(poly[0]);
      total += s.area;
      if (!best || s.area > best.area) best = s;
    });
    countries.set(c.code, { code: c.code, centroid: best.centroid, area: total, geometry: { type: 'MultiPolygon', coordinates: polys } });
  });
  cache = countries;
  return cache;
}

const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in km between two [lon, lat] points.
function distanceKm(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Compass bearing (0 = north, 90 = east) from a to b along the great circle.
function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const centroid = (code) => (load().get(code) || {}).centroid || null;
const distanceBetween = (a, b) => {
  const ca = centroid(a);
  const cb = centroid(b);
  return ca && cb ? distanceKm(ca, cb) : null;
};

module.exports = { load, centroid, distanceKm, distanceBetween, bearing, EARTH_CIRCUMFERENCE_KM };
