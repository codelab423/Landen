'use strict';

// Builds public/data/world.json: the 1:10m Natural Earth countries (all 195 present)
// simplified for screen use, so the map downloads and draws fast on phones.
// Small countries (Vatican City, Tuvalu, Nauru, …) keep their full detail so they never
// collapse and always get their clickable dot. Run `npm run build:map` after upgrading world-atlas.

const fs = require('fs');
const path = require('path');
const { presimplify, quantile, simplify } = require('topojson-simplify');
const { quantize, feature } = require('topojson-client');

const KEEP = Number(process.argv[2] || 0.08); // fraction of detail points to keep
const SMALL = 3e-5; // steradians, about 1,200 km²: countries this small keep every point

(async () => {
  const { geoArea } = await import('d3-geo');
  const src = require('world-atlas/countries-10m.json');

  // Which arcs belong to small countries?
  const protectedArcs = new Set();
  const addArcs = (arcs) => arcs.forEach((a) => (Array.isArray(a) ? addArcs(a) : protectedArcs.add(a < 0 ? ~a : a)));
  src.objects.countries.geometries.forEach((g) => {
    if (!g.arcs) return;
    let area = geoArea(feature(src, g));
    if (area > 2 * Math.PI) area = 4 * Math.PI - area; // a few shapes are wound inside-out
    if (area < SMALL) addArcs(g.arcs);
  });

  let topo = presimplify(JSON.parse(JSON.stringify(src)));
  topo.arcs.forEach((arc, i) => {
    if (protectedArcs.has(i)) arc.forEach((p) => (p[2] = Infinity));
  });
  topo = simplify(topo, quantile(topo, KEEP)); // quantile(p) = weight that keeps a fraction p of the points

  // Drop the helper weights again and re-quantize: integer deltas keep the file small.
  topo.arcs = topo.arcs.map((arc) => arc.map((p) => [p[0], p[1]]));
  topo = quantize(topo, 1e5);

  const out = path.join(__dirname, '..', 'public', 'data', 'world.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(topo));
  console.log(`wrote ${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${protectedArcs.size} protected arcs`);
})();
