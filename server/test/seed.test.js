import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { testDb } from './helpers.js';
import { haversine } from '../src/geo.js';
import { seed } from '../src/seed.js';

const tracks = JSON.parse(fs.readFileSync(new URL('../src/seed-tracks.json', import.meta.url), 'utf8'));

test('every demo route is a dense, road-following track', async () => {
  const db = await testDb();
  await seed(db);
  const routes = await db.prepare('SELECT name, geometry, distance_m FROM routes').all();
  assert.equal(routes.length, Object.keys(tracks).length);
  for (const r of routes) {
    const line = JSON.parse(r.geometry);
    assert.ok(line.length >= 100, `${r.name}: only ${line.length} points`);
    // The old demo data joined a handful of points with straight lines that
    // cut across blocks. Real tracks never jump more than a few hundred metres.
    for (let i = 1; i < line.length; i++) {
      const gap = haversine(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      assert.ok(gap < 500, `${r.name}: ${Math.round(gap)} m straight line at point ${i}`);
    }
    assert.ok(line.every((p) => p[2] != null), `${r.name}: missing elevation`);
  }
  db.close();
});
