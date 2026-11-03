// Free / premium per video: what opens for whom, and what a save stores.
// Run: node src/controllers/lessonVideoAccess.test.js
const assert = require('assert');
const { lessonAccess, stripLockedContent } = require('./selected-course.controller');
const { readVideos } = require('./lesson.controller');

const nobody = { planIds: new Set(), entitlements: new Set() };
const videoPlan = { planIds: new Set([1]), entitlements: new Set(['video_lecture']) };
const mcqOnly = { planIds: new Set([2]), entitlements: new Set(['mcq']) };

const lesson = (videos, extra = {}) => ({
  id: 1, type: 'video', accessType: 'free', isFreePreview: false, lessonPlans: [],
  videoUrl: videos[0]?.videoUrl ?? null, quizId: null, noteUrl: null, content: null,
  videos, ...extra,
});
const free = { id: 1, videoUrl: 'a.mp4', accessType: 'free' };
const paid = { id: 2, videoUrl: 'b.mp4', accessType: 'premium' };

// A free student gets the free video and a padlock on the paid one, and the
// lesson itself is open because something inside is.
let g = lessonAccess(lesson([free, paid]), nobody, 'free');
assert.strictEqual(g.locked, false);
let out = stripLockedContent(lesson([free, paid]), g);
assert.deepStrictEqual(out.videos.map((v) => [v.videoUrl, v.locked]), [['a.mp4', false], [null, true]]);
assert.strictEqual(out.videoUrl, 'a.mp4');

// A premium course does not override a video marked free — that is the point
// of marking it.
g = lessonAccess(lesson([free, paid]), nobody, 'premium');
assert.strictEqual(g.videoOpen(free), true);
assert.strictEqual(g.videoOpen(paid), false);

// Only paid videos: locked for a free student, and video 1's URL is gone.
g = lessonAccess(lesson([paid]), nobody, 'free');
assert.strictEqual(g.locked, true);
assert.strictEqual(stripLockedContent(lesson([paid]), g).videoUrl, null);

// A plan that sells video lectures opens them; one that only sells MCQs does not.
assert.strictEqual(lessonAccess(lesson([paid]), videoPlan, 'premium').videoOpen(paid), true);
assert.strictEqual(lessonAccess(lesson([paid]), mcqOnly, 'premium').videoOpen(paid), false);

// The quiz follows the lesson's own setting, separately from the videos.
const withQuiz = lesson([free], { quizId: 9, quiz: { id: 9 }, accessType: 'premium' });
g = lessonAccess(withQuiz, nobody, 'free');
out = stripLockedContent(withQuiz, g);
assert.strictEqual(out.locked, false);
assert.strictEqual(out.contentLocked, true);
assert.strictEqual(out.quiz, null);
assert.strictEqual(out.videos[0].videoUrl, 'a.mp4');

// A lesson with no rows, saved through the old videoUrl field, follows the
// lesson exactly as before.
const legacy = { ...lesson([]), videoUrl: 'old.mp4', accessType: 'premium' };
assert.strictEqual(lessonAccess(legacy, nobody, 'free').locked, true);
assert.strictEqual(lessonAccess({ ...legacy, accessType: 'free' }, nobody, 'free').locked, false);

// Saving: a row may say free or premium. One that does not keeps what that
// link had, and a new one is premium — an older panel re-saving a lesson
// cannot open a paid video.
const previous = new Map([['b', 'free'], ['c', 'premium']]);
const rows = readVideos({
  videos: [
    { videoUrl: 'a', accessType: 'free' },
    { videoUrl: 'b' },
    { videoUrl: 'c' },
    { videoUrl: 'new', description: '  Hormones and axes. ' },
  ],
}, previous).rows;
assert.deepStrictEqual(rows.map((r) => r.accessType), ['free', 'free', 'premium', 'premium']);
assert.strictEqual(rows[3].description, 'Hormones and axes.');
assert.strictEqual(rows[0].description, null);
assert.match(readVideos({ videos: [{ videoUrl: 'a', accessType: 'paid' }] }).error, /videos\[0\]\.accessType/);

console.log('lesson video access: all assertions passed');
