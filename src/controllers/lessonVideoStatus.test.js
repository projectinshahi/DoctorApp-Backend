// Draft / published per video, under the lesson's own status.
// Run: node src/controllers/lessonVideoStatus.test.js
const assert = require('assert');
const { readVideos, videoStatusesFor, mirrorFirstVideo } = require('./lesson.controller');

const statuses = (rows) => rows.map((r) => r.status);

// A row says draft or published; one that does not keeps what that link had,
// and a new one is published.
const read = readVideos({
  videos: [
    { videoUrl: 'a', status: 'draft' },
    { videoUrl: 'b' },
    { videoUrl: 'new' },
  ],
}, new Map([['b', { status: 'draft' }]]));
assert.deepStrictEqual(statuses(read.rows), ['draft', 'draft', 'published']);
assert.match(readVideos({ videos: [{ videoUrl: 'a', status: 'archived' }] }).error, /videos\[0\]\.status/);

const mixed = [
  { videoUrl: 'a', status: 'published' },
  { videoUrl: 'b', status: 'draft' },
];

// Drafting (or archiving) a lesson drafts every video in it — whatever the
// rows asked for.
assert.deepStrictEqual(statuses(videoStatusesFor(mixed, 'draft', true)), ['draft', 'draft']);
assert.deepStrictEqual(statuses(videoStatusesFor(mixed, 'archived', true)), ['draft', 'draft']);

// Publishing a lesson publishes every video, so it never goes live empty
// because its videos were drafted with it.
assert.deepStrictEqual(statuses(videoStatusesFor(mixed, 'published', false)), ['published', 'published']);

// While it stays published, each video keeps its own status.
assert.deepStrictEqual(statuses(videoStatusesFor(mixed, 'published', true)), ['published', 'draft']);

// The lesson's own video columns reach students directly, so they point at
// the first PUBLISHED video, never a draft.
assert.strictEqual(mirrorFirstVideo([{ videoUrl: 'd', status: 'draft' }, { videoUrl: 'p', status: 'published' }]).videoUrl, 'p');
assert.strictEqual(mirrorFirstVideo([{ videoUrl: 'd', status: 'draft' }]).videoUrl, null);
// Rows from before statuses existed count as published.
assert.strictEqual(mirrorFirstVideo([{ videoUrl: 'x' }]).videoUrl, 'x');

console.log('lesson video status: all assertions passed');
