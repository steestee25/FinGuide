// Keep Metro from watching large generated folders: Gradle builds under android/
// and benchmark results. Watching them grows the dev server's memory over time.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const escape = (p) => path.resolve(__dirname, p).replace(/[/\\]/g, '[/\\\\]').replace(/\./g, '\\.');
const blocked = [
  new RegExp(`^${escape('android')}[/\\\\](\\.gradle|build|app[/\\\\]build|app[/\\\\]\\.cxx)[/\\\\].*`),
  new RegExp(`^${escape('benchmark/risultati')}[/\\\\].*`),
];

const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ...blocked,
];

module.exports = config;
