// The lesson-level videoUrl follows the first published video, never the
// Lesson.videoUrl column, whenever the lesson has video rows.
// Run: node src/controllers/lessonVideoUrlSync.test.js
//
// The column is meant to mirror video 1, but the admin's lesson update writes
// it on its own. These tests set it OUT OF SYNC on purpose (column = the
// premium video, video 1 free) and check that no unpaid response carries the
// premium URL: the pure rule first, then each student endpoint that serves a
// lesson-level videoUrl (course tree, single lesson, saved lessons, /home).
//
// No database: prisma is swapped for a recorder in require.cache before any
// controller loads, the same way fullAccess.test.js does it.
const assert = require('assert');
const path = require('path');

const log = [];
let handlers = {};
const DEFAULTS = { findMany: [], count: 0, groupBy: [] };
const model = (name) => new Proxy({}, {
  get: (_, op) => async (args) => {
    log.push({ model: name, op, args });
    const h = handlers[`${name}.${op}`];
    if (h) return typeof h === 'function' ? h(args) : h;
    return op in DEFAULTS ? DEFAULTS[op] : null;
  },
});
const fakeDb = new Proxy({}, { get: (_, name) => model(name) });
require.cache[path.resolve(__dirname, '../db.js')] = { exports: fakeDb };

const calls = (m, op) => log.filter((c) => c.model === m && (!op || c.op === op));
const reset = (next = {}) => { log.length = 0; handlers = next; };

function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
async function call(fn, req) {
  const res = fakeRes();
  await fn({ params: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const errors = [];
console.error = (...a) => errors.push(a.map(String).join(' '));

const access = require('../services/access.service');
const { lessonAccess, stripLockedContent, lessonVideoUrl, fullAccessGrant } = access;
const selected = require('./selected-course.controller');
const saved = require('./saved.controller');
const home = require('./home.controller');

const PAID_URL = 'paid.mp4';
const noLeak = (value, label) => assert.ok(!JSON.stringify(value).includes(PAID_URL),
  `${label}: premium URL must not appear anywhere in an unpaid response`);

// ── who is asking ──
const unpaid = access.accessFrom([]);
const paid = access.accessFrom([{ planId: 1, plan: { entitlements: ['video_lecture'] } }]);
const owner = fullAccessGrant();

// ── the out-of-sync lesson ──
const FREE_PART = { id: 11, title: 'Part 1', videoUrl: 'free.mp4', accessType: 'free', displayOrder: 0 };
const PAID_PART = { id: 12, title: 'Part 2', videoUrl: PAID_URL, accessType: 'premium', displayOrder: 1 };
const lesson = (videos, extra = {}) => ({
  id: 1, title: 'L', description: null, type: 'video', accessType: 'premium', isFreePreview: false,
  // The column points at the premium video: the drift the admin update causes.
  videoUrl: PAID_URL, thumbnailUrl: null, noteUrl: null, noteFileType: null, content: null,
  durationSeconds: 600, displayOrder: 1, quizId: null, quiz: null, lessonPlans: [],
  videos: videos.map((v) => ({ ...v })), ...extra,
});

// ───────────────────────── pure rule ─────────────────────────

for (const course of ['free', 'premium']) {
  // Unpaid, video 1 free: the lesson plays video 1, part 2 is shut.
  const l = lesson([FREE_PART, PAID_PART]);
  const g = lessonAccess(l, unpaid, course);
  const out = stripLockedContent(l, g);
  assert.strictEqual(out.videoUrl, 'free.mp4', `${course} course, unpaid: lesson-level is video 1`);
  assert.deepStrictEqual(out.videos.map((v) => [v.videoUrl, v.locked]), [['free.mp4', false], [null, true]]);
  noLeak(out, `${course} course, unpaid, video 1 free`);
  assert.strictEqual(lessonVideoUrl(l, g), 'free.mp4');

  // Unpaid, video 1 premium: nothing at lesson level, even though the column
  // is set and video 2 is free.
  const l2 = lesson([{ ...PAID_PART, displayOrder: 0 }, { ...FREE_PART, displayOrder: 1 }]);
  const out2 = stripLockedContent(l2, lessonAccess(l2, unpaid, course));
  assert.strictEqual(out2.videoUrl, null, `${course} course, unpaid, video 1 premium: lesson-level null`);
  assert.deepStrictEqual(out2.videos.map((v) => v.videoUrl), [null, 'free.mp4']);
  noLeak(out2, `${course} course, unpaid, video 1 premium`);

  // Paid (live plan selling video lectures) and owner (full access): all of it,
  // and the lesson-level URL is still video 1's, not the column's.
  for (const [who, a] of [['paid', paid], ['owner', owner]]) {
    const o = stripLockedContent(l, lessonAccess(l, a, course));
    assert.strictEqual(o.videoUrl, 'free.mp4', `${who}: lesson-level = video 1`);
    assert.deepStrictEqual(o.videos.map((v) => [v.videoUrl, v.locked]),
      [['free.mp4', false], [PAID_URL, false]], `${who}: every video open`);
    assert.strictEqual(o.locked, false);
    const o2 = stripLockedContent(l2, lessonAccess(l2, a, course));
    assert.strictEqual(o2.videoUrl, PAID_URL, `${who}: video 1 premium opens`);
    assert.deepStrictEqual(o2.videos.map((v) => v.videoUrl), [PAID_URL, 'free.mp4']);
  }
}

// A row that does not carry videoUrl fails closed: null, never the column.
{
  const l = lesson([{ id: 11, accessType: 'free' }]);
  assert.strictEqual(stripLockedContent(l, lessonAccess(l, unpaid, 'free')).videoUrl, null);
}

// Legacy lesson with no rows: the column, gated on the lesson, exactly as before.
{
  const legacy = lesson([], { videoUrl: 'old.mp4' });
  assert.strictEqual(stripLockedContent(legacy, lessonAccess(legacy, unpaid, 'free')).videoUrl, null,
    'premium legacy lesson, unpaid: stripped');
  assert.strictEqual(stripLockedContent(legacy, lessonAccess(legacy, paid, 'premium')).videoUrl, 'old.mp4');
  assert.strictEqual(stripLockedContent(legacy, lessonAccess(legacy, owner, 'premium')).videoUrl, 'old.mp4');
  const freeLegacy = { ...legacy, accessType: 'free' };
  assert.strictEqual(stripLockedContent(freeLegacy, lessonAccess(freeLegacy, unpaid, 'free')).videoUrl, 'old.mp4',
    'free legacy lesson: open');
  // Output shape unchanged: no videoUrl key in, none out.
  const { videoUrl, ...noKey } = freeLegacy;
  assert.ok(!('videoUrl' in stripLockedContent(noKey, lessonAccess(noKey, unpaid, 'free'))));
}

// ───────────────────────── endpoints ─────────────────────────

// The queries must hand stripLockedContent published rows WITH videoUrl, in
// the same order lessonAccess reads video 1 from.
function assertVideosQuery(videos, label, { take } = {}) {
  assert.ok(videos, `${label}: selects videos`);
  assert.deepStrictEqual(videos.where, { status: 'published' }, `${label}: published only`);
  assert.strictEqual(videos.select.videoUrl, true, `${label}: selects videos.videoUrl`);
  assert.strictEqual(videos.select.accessType, true, `${label}: selects videos.accessType`);
  assert.deepStrictEqual(videos.orderBy, [{ displayOrder: 'asc' }, { id: 'asc' }], `${label}: video order`);
  if (take !== undefined) assert.strictEqual(videos.take, take);
}

const USER = (who) => ({
  selectedCourseId: 3, selectedCourseTypeId: null,
  selectedCourse: { id: 3, title: 'C', thumbnail: null, accessType: 'premium' },
  fullAccess: who === 'owner', status: 'verified',
});
const SUBS = (who) => (who === 'paid' ? [{ planId: 1, plan: { entitlements: ['video_lecture'] } }] : []);

// Each scenario: [who, video rows, expected lesson-level URL, expected per-video URLs]
const SCENARIOS = [
  ['unpaid', [FREE_PART, PAID_PART], 'free.mp4', ['free.mp4', null]],
  ['unpaid', [{ ...PAID_PART, displayOrder: 0 }, { ...FREE_PART, displayOrder: 1 }], null, [null, 'free.mp4']],
  ['paid', [FREE_PART, PAID_PART], 'free.mp4', ['free.mp4', PAID_URL]],
  ['owner', [FREE_PART, PAID_PART], 'free.mp4', ['free.mp4', PAID_URL]],
];

(async () => {
  for (const [who, videos, want, wantParts] of SCENARIOS) {
    const label = `${who}, video 1 ${videos[0].accessType}`;

    // ── GET /users/me/selected-course/content (the tree) ──
    reset({
      'user.findUnique': USER(who),
      'subscription.findMany': SUBS(who),
      'chapter.findMany': [{ id: 1, title: 'Ch', displayOrder: 1, lessons: [lesson(videos)] }],
    });
    let res = await call(selected.getSelectedCourseContent, { user: { userId: 7 } });
    assert.strictEqual(res.statusCode, 200, errors.join('\n'));
    assertVideosQuery(calls('chapter', 'findMany')[0].args.select.lessons.select.videos, 'tree');
    let out = res.body.chapters[0].lessons[0];
    assert.strictEqual(out.videoUrl, want, `tree, ${label}: lesson-level videoUrl`);
    assert.deepStrictEqual(out.videos.map((v) => v.videoUrl), wantParts, `tree, ${label}: parts`);
    if (who === 'unpaid') noLeak(res.body, `tree, ${label}`);

    // ── GET /users/me/lessons/:id ──
    reset({
      'user.findUnique': USER(who),
      'subscription.findMany': SUBS(who),
      'lesson.findUnique': {
        ...lesson(videos), status: 'published', rapidRecalls: [],
        chapter: { id: 1, title: 'Ch', courseId: 3, courseTypeId: null },
      },
    });
    res = await call(selected.getStudentLesson, { user: { userId: 7 }, params: { id: '1' } });
    assert.strictEqual(res.statusCode, 200, errors.join('\n'));
    assertVideosQuery(calls('lesson', 'findUnique')[0].args.select.videos, 'single lesson');
    out = res.body.lesson;
    assert.strictEqual(out.videoUrl, want, `single lesson, ${label}: lesson-level videoUrl`);
    assert.deepStrictEqual(out.videos.map((v) => v.videoUrl), wantParts, `single lesson, ${label}: parts`);
    if (who === 'unpaid') noLeak(res.body, `single lesson, ${label}`);

    // ── GET /users/me/saved-lessons and GET /users/me/saved ──
    // The rows here are trimmed to what the saved query selects.
    const savedRow = () => {
      const l = lesson(videos.map(({ id, title, accessType, videoUrl }) => ({ id, title, accessType, videoUrl })),
        { chapter: { id: 1, title: 'Ch' } });
      delete l.content; delete l.durationSeconds; delete l.displayOrder; delete l.quiz; delete l.description;
      return [{ savedAt: new Date(0), lesson: l }];
    };
    for (const [name, fn] of [['saved-lessons', saved.listSavedLessons], ['saved', saved.listSaved]]) {
      reset({
        'user.findUnique': USER(who),
        'subscription.findMany': SUBS(who),
        'savedLesson.findMany': savedRow,
      });
      res = await call(fn, { user: { userId: 7 } });
      assert.strictEqual(res.statusCode, 200, errors.join('\n'));
      assertVideosQuery(calls('savedLesson', 'findMany')[0].args.select.lesson.select.videos, name);
      out = res.body.lessons[0];
      assert.strictEqual(out.videoUrl, want, `${name}, ${label}: lesson-level videoUrl`);
      // Per-video URLs stay out of saved lesson rows, as before.
      assert.ok(out.videos.every((v) => !('videoUrl' in v)), `${name}: rows carry no per-video URL`);
      assert.deepStrictEqual(out.videos.map((v) => v.locked), wantParts.map((u) => u === null));
      if (who === 'unpaid') noLeak(res.body, `${name}, ${label}`);
    }

    // ── GET /users/me/home: continueWatching and inProgressVideos ──
    // home asks for video 1 only (take: 1), so the row holds just that.
    reset({
      'user.findUnique': USER(who),
      'subscription.findMany': SUBS(who),
      'lesson.findMany': (args) => (args?.select?.lessonPlans
        ? [{ ...lesson(videos.slice(0, 1).map(({ accessType, videoUrl }) => ({ accessType, videoUrl }))),
            chapter: { id: 1, title: 'Ch' } }]
        : []),
      'lessonProgress.findMany': [{ lessonId: 1, completed: false, lastPositionSeconds: 30, updatedAt: new Date() }],
    });
    res = await call(home.getHome, { user: { userId: 7 } });
    assert.strictEqual(res.statusCode, 200, errors.join('\n'));
    const homeQuery = calls('lesson', 'findMany').find((c) => c.args?.select?.lessonPlans);
    assertVideosQuery(homeQuery.args.select.videos, 'home', { take: 1 });
    assert.strictEqual(res.body.continueWatching.videoUrl, want, `home continueWatching, ${label}`);
    assert.strictEqual(res.body.continueWatching.locked, want === null);
    assert.strictEqual(res.body.inProgressVideos.length, 1);
    assert.strictEqual(res.body.inProgressVideos[0].videoUrl, want, `home inProgressVideos, ${label}`);
    assert.strictEqual(res.body.inProgressVideos[0].locked, want === null);
    if (who === 'unpaid') noLeak(res.body, `home, ${label}`);
  }

  // /home with a legacy lesson (no rows): the column, gated as before.
  for (const [who, accessType, want] of [
    ['unpaid', 'premium', null], ['unpaid', 'free', 'old.mp4'], ['paid', 'premium', 'old.mp4'], ['owner', 'premium', 'old.mp4'],
  ]) {
    reset({
      'user.findUnique': { ...USER(who), selectedCourse: { id: 3, title: 'C', thumbnail: null, accessType: 'free' } },
      'subscription.findMany': SUBS(who),
      'lesson.findMany': (args) => (args?.select?.lessonPlans
        ? [{ ...lesson([], { videoUrl: 'old.mp4', accessType }), chapter: { id: 1, title: 'Ch' } }]
        : []),
      'lessonProgress.findMany': [{ lessonId: 1, completed: false, lastPositionSeconds: 30, updatedAt: new Date() }],
    });
    const res = await call(home.getHome, { user: { userId: 7 } });
    assert.strictEqual(res.statusCode, 200, errors.join('\n'));
    assert.strictEqual(res.body.continueWatching.videoUrl, want, `home legacy, ${who} ${accessType}`);
    assert.strictEqual(res.body.inProgressVideos[0].videoUrl, want);
  }

  console.log('lesson videoUrl sync: all assertions passed');
})().catch((err) => {
  console.log(errors.join('\n'));
  console.log(err);
  process.exit(1);
});
