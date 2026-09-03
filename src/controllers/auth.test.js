// First-device-wins login policy. Run: node src/controllers/auth.test.js
const assert = require('assert');
const { decideLogin, IDLE_RELEASE_MS } = require('./auth.controller');

const NOW = new Date('2026-09-02T12:00:00.000Z').getTime();
const ago = (ms) => new Date(NOW - ms);
const session = (deviceId, seenMsAgo, createdMsAgo = seenMsAgo) =>
  ({ deviceId, createdAt: ago(createdMsAgo), lastSeenAt: ago(seenMsAgo) });

// Nobody signed in: the first device just gets in.
const first = decideLogin(null, 'PHONE-A', NOW);
assert.strictEqual(first.allow, true);
assert.strictEqual(first.reason, 'first');
assert.strictEqual(first.notice, null);
assert.strictEqual(first.previousSession, null);

// ── the rule itself ──

// Another device, active a minute ago: REFUSED. This is the whole point — a
// shared account cannot be taken over while its owner is using it.
const busy = decideLogin(session('PHONE-A', 60 * 1000), 'TABLET-B', NOW);
assert.strictEqual(busy.allow, false);
assert.strictEqual(busy.reason, 'activeElsewhere');
assert.strictEqual(busy.previousSession.deviceId, 'PHONE-A');
assert.strictEqual(busy.retryAfterMinutes, 29);

// The same device signing in again is never refused, whatever the clock says.
// Refusing here would lock a student out with their own phone in their hand —
// after a reinstall that kept the device id, or a token they simply lost.
const mine = decideLogin(session('PHONE-A', 5 * 1000), 'PHONE-A', NOW);
assert.strictEqual(mine.allow, true);
assert.strictEqual(mine.reason, 'sameDevice');
assert.strictEqual(mine.previousSession.sameDevice, true);
assert.strictEqual(mine.notice, null, 'no alarm for your own device');

// ── the escape hatch ──

// Gone quiet for longer than the window: the lock is released. This is what
// saves a lost, wiped or reinstalled phone from locking the account for ever.
const stale = decideLogin(session('PHONE-A', IDLE_RELEASE_MS + 1000), 'TABLET-B', NOW);
assert.strictEqual(stale.allow, true);
assert.strictEqual(stale.reason, 'idleReleased');
assert(stale.notice.includes('inactive'), 'the new device is told why it was let in');

// Exactly at the boundary releases, rather than refusing by a millisecond.
assert.strictEqual(decideLogin(session('PHONE-A', IDLE_RELEASE_MS), 'TABLET-B', NOW).allow, true);
assert.strictEqual(decideLogin(session('PHONE-A', IDLE_RELEASE_MS - 1), 'TABLET-B', NOW).allow, false);

// A session that has never reported activity falls back to when it was
// created, so a row written before lastSeenAt existed cannot hold the lock for
// ever.
const legacy = { deviceId: 'PHONE-A', createdAt: ago(IDLE_RELEASE_MS * 2), lastSeenAt: null };
assert.strictEqual(decideLogin(legacy, 'TABLET-B', NOW).allow, true);
const legacyFresh = { deviceId: 'PHONE-A', createdAt: ago(1000), lastSeenAt: null };
assert.strictEqual(decideLogin(legacyFresh, 'TABLET-B', NOW).allow, false);

// ── the countdown shown to the blocked device ──

// Rounded up: a session seen seconds ago must never say "0 minutes".
assert.strictEqual(decideLogin(session('PHONE-A', 1000), 'TABLET-B', NOW).retryAfterMinutes, 30);
assert.strictEqual(decideLogin(session('PHONE-A', 29 * 60 * 1000), 'TABLET-B', NOW).retryAfterMinutes, 1);
// Never zero, never negative, right up to the boundary.
for (const secs of [1, 60, 900, 1799]) {
  const d = decideLogin(session('PHONE-A', secs * 1000), 'TABLET-B', NOW);
  assert(d.retryAfterMinutes >= 1, `retryAfterMinutes was ${d.retryAfterMinutes} at ${secs}s`);
}

// An allowed login never carries a countdown.
assert.strictEqual(first.retryAfterMinutes, undefined);
assert.strictEqual(stale.retryAfterMinutes, undefined);

console.log('auth.test.js: all assertions passed');
