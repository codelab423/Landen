'use strict';

// Files the app cannot run without. server.js refuses to start when one is missing, and
// `npm test` also checks that they are committed to git (a .gitignore rule once kept
// public/data/world.json out of the repo, and the deploy crashed).
module.exports = {
  // Part of the repository.
  APP_FILES: [
    'public/index.html',
    'public/app.js',
    'public/i18n.js',
    'public/countries.js',
    'public/climate.js',
    'public/style.css',
    'public/sw.js',
    'public/data/world.json',
  ],
  // Installed by `npm ci`.
  PACKAGE_FILES: [
    'node_modules/d3/dist/d3.min.js',
    'node_modules/topojson-client/dist/topojson-client.min.js',
    'node_modules/flag-icons/flags/4x3/nl.svg',
  ],
};
