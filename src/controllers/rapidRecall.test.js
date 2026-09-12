// Rapid Recall card validation. Run: node src/controllers/rapidRecall.test.js
const assert = require('assert');
const { cardProblems } = require('./rapidRecall.controller');

const img = 'https://res.cloudinary.com/x/y.png';

// A card carries an image, a note, or both.
assert.strictEqual(cardProblems([{ imageUrl: img }]), null);
assert.strictEqual(cardProblems([{ note: 'ACE inhibitors reduce mortality.' }]), null);
assert.strictEqual(cardProblems([{ imageUrl: img, note: 'Lead II' }]), null);

// Neither is the one thing it may not be — an empty card renders as a blank
// screen the student has to swipe past with no way to know it is not a bug.
assert(cardProblems([{}]).includes('needs an image or a note'));
assert(cardProblems([{ imageUrl: '', note: '   ' }]).includes('needs an image or a note'));
assert(cardProblems([{ imageUrl: null, note: null }]).includes('needs an image or a note'));

// The message names the position, because a deck of forty is unfixable
// otherwise.
assert(cardProblems([{ note: 'ok' }, { note: 'ok' }, {}]).includes('Card 3'));

// A filename or a relative path can never load. Rejecting it here beats a
// student meeting a broken image during revision.
assert(cardProblems([{ imageUrl: 'ecg.png' }]).includes('not a valid URL'));
assert(cardProblems([{ imageUrl: '/uploads/ecg.png' }]).includes('not a valid URL'));

// An empty deck is allowed: it is how an admin clears one.
assert.strictEqual(cardProblems([]), null);

// Anything that is not an array at all.
assert.strictEqual(cardProblems(undefined), 'cards must be an array');
assert.strictEqual(cardProblems('nope'), 'cards must be an array');
assert(cardProblems([null]).includes('Card 1 must be an object'));

console.log('rapidRecall.test.js: all assertions passed');
