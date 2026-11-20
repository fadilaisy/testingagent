import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { loadConfig } from '../src/config.js';

// Keeps .env.example and the README settings table in step with the
// variables the server actually reads.
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function variablesReadByServer() {
  const names = new Set();
  for (const file of ['../src/config.js', '../src/seed.js']) {
    const src = read(file);
    for (const [, name] of src.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) names.add(name);
    for (const [, name] of src.matchAll(/\bflag\('([A-Z][A-Z0-9_]+)'/g)) names.add(name);
  }
  return names;
}

const sorted = (set) => [...set].sort();

test('.env.example lists exactly the variables the server reads', () => {
  const example = new Set();
  for (const [, name] of read('../../.env.example').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) example.add(name);
  assert.deepEqual(sorted(example), sorted(variablesReadByServer()));
});

test('README documents every variable the server reads', () => {
  const readme = read('../../README.md');
  const missing = sorted(variablesReadByServer()).filter((name) => !readme.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});

test('.env.example holds no values, and as-is behaves like no settings at all', () => {
  const parsed = parseEnv(read('../../.env.example'));
  assert.deepEqual(Object.keys(parsed).sort(), sorted(variablesReadByServer()));
  for (const [name, value] of Object.entries(parsed)) assert.equal(value, '', `${name} should be empty`);
  assert.deepEqual(loadConfig(parsed), loadConfig({}));
});
