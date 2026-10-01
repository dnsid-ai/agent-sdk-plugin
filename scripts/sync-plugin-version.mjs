// npm runs this after `npm version` bumps package.json, so the plugin manifest
// always carries the same version.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const file = '.claude-plugin/plugin.json';
const plugin = JSON.parse(readFileSync(file, 'utf8'));
writeFileSync(file, JSON.stringify({ ...plugin, version }, null, 2) + '\n');
