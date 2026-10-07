// A lesson's video list: what the panel sends and what gets stored.
// Run: node src/controllers/lessonVideos.test.js
const assert = require('assert');
const { readVideos, mirrorFirstVideo } = require('./lesson.controller');

// Absent means "leave them alone" — an edit that only renames a lesson must
// not wipe its videos.
assert.strictEqual(readVideos({ title: 'x' }).provided, false);

// Null and [] both mean "remove them all", which is a real instruction.
assert.deepStrictEqual(readVideos({ videos: null }), { provided: true, rows: [] });
assert.deepStrictEqual(readVideos({ videos: [] }), { provided: true, rows: [] });

// Order is the array's own order, so reordering in the panel is reordering
// the list — no index field to keep in sync.
const three = readVideos({
  videos: [
    { videoUrl: 'a.mp4', title: 'Part 1', durationSeconds: 610 },
    { videoUrl: 'b.mp4' },
    { videoUrl: 'c.mp4', title: '  ' },
  ],
});
assert.strictEqual(three.error, undefined);
assert.deepStrictEqual(three.rows.map((v) => v.displayOrder), [0, 1, 2]);
assert.deepStrictEqual(three.rows.map((v) => v.videoUrl), ['a.mp4', 'b.mp4', 'c.mp4']);
// A blank title is no title, not a title made of spaces.
assert.strictEqual(three.rows[1].title, null);
assert.strictEqual(three.rows[2].title, null);
assert.strictEqual(three.rows[0].durationSeconds, 610);

// A row without a playable URL is the one thing that cannot be stored.
assert.match(readVideos({ videos: [{ title: 'no url' }] }).error, /videos\[0\]\.videoUrl is required/);
assert.match(readVideos({ videos: [{ videoUrl: '   ' }] }).error, /videos\[0\]\.videoUrl is required/);
assert.match(readVideos({ videos: 'a.mp4' }).error, /videos must be an array/);
assert.match(readVideos({ videos: [null] }).error, /videos\[0\] must be an object/);
assert.match(
  readVideos({ videos: [{ videoUrl: 'a.mp4', durationSeconds: 'ten' }] }).error,
  /videos\[0\]\.durationSeconds must be a number/,
);

// The legacy columns track video 1, so every client still reading
// lesson.videoUrl gets the first video rather than nothing.
assert.deepStrictEqual(mirrorFirstVideo(three.rows), {
  videoUrl: 'a.mp4',
  videoPublicId: null,
  durationSeconds: 610,
});

// Clearing the list clears them, or the lesson would advertise a video it no
// longer has.
assert.deepStrictEqual(mirrorFirstVideo([]), {
  videoUrl: null,
  videoPublicId: null,
  durationSeconds: null,
});

console.log('lesson videos: all assertions passed');
