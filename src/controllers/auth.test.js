// Single-device sign-out reporting. Run: node src/controllers/auth.test.js
const assert = require('assert');
const { describeSignOut } = require('./auth.controller');

const at = new Date('2026-09-02T12:08:00.000Z');
const phone = { deviceId: 'ed309ece15f04b50', createdAt: at };

// A different device really was ended — this is the alert the new device shows.
const kicked = describeSignOut(phone, '4252993c2d7d9468');
assert.strictEqual(kicked.signedOutOtherDevice, true);
assert(kicked.notice.includes('signed out on your other device'));
assert.strictEqual(kicked.previousSession.sameDevice, false);
assert.strictEqual(kicked.previousSession.deviceId, 'ed309ece15f04b50');
assert.strictEqual(kicked.previousSession.signedInAt, at);

// The same device signing in again is NOT a device switch. Firing the alert
// here would tell a student they had been kicked off the phone in their hand,
// and it happens on every ordinary re-login — the alert would cry wolf until
// it was ignored.
const again = describeSignOut(phone, 'ed309ece15f04b50');
assert.strictEqual(again.signedOutOtherDevice, false);
assert.strictEqual(again.notice, null, 'no alert when it is the same phone');
assert.strictEqual(again.previousSession.sameDevice, true);
// The session is still reported, so an app that wants to say "welcome back"
// has the detail; only the alarm is withheld.
assert.strictEqual(again.previousSession.deviceId, 'ed309ece15f04b50');

// A brand new account, or one whose session was already logged out, has no
// elsewhere to have been signed out of.
for (const nothing of [null, undefined]) {
  const fresh = describeSignOut(nothing, 'any-device');
  assert.strictEqual(fresh.signedOutOtherDevice, false);
  assert.strictEqual(fresh.notice, null);
  assert.strictEqual(fresh.previousSession, null);
}

// deviceId is compared exactly. Two devices whose ids differ only by case are
// two devices — guessing otherwise would silently merge them.
assert.strictEqual(describeSignOut(phone, 'ED309ECE15F04B50').signedOutOtherDevice, true);

// An empty deviceId cannot match a real one. Login rejects it with a 400
// before this runs, but the function must not treat "" as "same".
assert.strictEqual(describeSignOut(phone, '').signedOutOtherDevice, true);

// The notice is a complete sentence the app can show without editing it.
assert(kicked.notice.endsWith('.'));
assert(!kicked.notice.includes('undefined'));

console.log('auth.test.js: all assertions passed');
