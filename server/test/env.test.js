import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

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
  for (const [, name] of read('../../.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)) example.add(name);
  assert.deepEqual(sorted(example), sorted(variablesReadByServer()));
});

test('README documents every variable the server reads', () => {
  const readme = read('../../README.md');
  const missing = sorted(variablesReadByServer()).filter((name) => !readme.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});

test('.env.example parses as an env file once uncommented, with no real secrets', async () => {
  const { parseEnv } = await import('node:util');
  const text = read('../../.env.example')
    .split('\n')
    .filter((line) => /^#\s*[A-Z][A-Z0-9_]+=/.test(line))
    .map((line) => line.replace(/^#\s*/, '').replace(/\s{2,}\S.*$/, ''))
    .join('\n');
  const parsed = parseEnv(text);
  assert.equal(parsed.EMAIL_FROM, 'ROAMR <no-reply@roamr.id>');
  assert.match(parsed.MIDTRANS_SERVER_KEY, /x{8}$/);
  assert.match(parsed.GOOGLE_CLIENT_SECRET, /x{8}$/);
  assert.match(parsed.RESEND_API_KEY, /x{8}$/);
});
