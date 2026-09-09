#!/usr/bin/env node
// Times the endpoints that were slow, so a change can be judged by numbers
// rather than by whether it felt faster.
//
//   node scripts/bench.js                        → production
//   node scripts/bench.js http://localhost:3000  → a local server
//
// Reports the MEDIAN of several warm runs. The first run is thrown away on
// purpose: it wakes the database and measures Neon, not your change.
require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');

const BASE = process.argv[2] || 'https://doctorapp-backend-30gd.onrender.com';
const RUNS = 6;

const admin = jwt.sign({ adminId: 1, role: 'admin' }, process.env.ADMIN_JWT_SECRET, { expiresIn: '10m' });

const ENDPOINTS = [
  ['no database at all', '/api/health', false],
  ['1 query, no relations', '/api/subjects', true],
  ['20 questions, 4 relations', '/api/questions?page=1&limit=20', true],
  ['50 questions, 4 relations', '/api/questions?page=1&limit=50', true],
  ['admin test list', '/api/admin/tests', true],
  ['student list', '/admin/students?limit=10', true],
];

async function time(path, auth) {
  const started = Date.now();
  const res = await fetch(BASE + path, auth ? { headers: { Authorization: `Bearer ${admin}` } } : undefined);
  await res.arrayBuffer();
  return { ms: Date.now() - started, status: res.status };
}

(async () => {
  console.log(`\n  ${BASE}\n  median of ${RUNS - 1} warm runs, first discarded\n`);
  let floor = null;

  for (const [label, path, auth] of ENDPOINTS) {
    const times = [];
    let status = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const r = await time(path, auth);
      status = r.status;
      if (i > 0) times.push(r.ms);          // discard the wake-up run
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    if (floor === null) floor = median;      // /api/health is your own latency

    // Subtracting the no-database endpoint leaves the part the server spent
    // talking to Postgres, which is the only part any code change can move.
    const dbMs = Math.max(0, median - floor);
    const flag = status >= 400 ? `  HTTP ${status}` : '';
    console.log(
      `  ${String(median).padStart(5)} ms   db~${String(dbMs).padStart(4)} ms   ` +
      `${label.padEnd(26)} ${path}${flag}`,
    );
  }

  console.log('\n  A slow first run is Neon waking from autosuspend, not the code.');
  console.log('  "db~" is total minus the no-database endpoint: your own network is removed.\n');
})();
