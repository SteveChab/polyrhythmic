import test from 'node:test';
import assert from 'node:assert/strict';
import { INFO } from '../toggle/info.js';

// The Info box sizes itself to the longest entry, and the settings panel grows with it.
// Keep entries short enough that the box stays a calm size; shorten the copy rather than raising the budget.
const MAX_TITLE = 28;
const MAX_TEXT = 140;

test('every Info entry has a title and text within budget', () => {
  for (const [key, entry] of Object.entries(INFO)) {
    assert.equal(entry.length, 2, `${key}: [title, text]`);
    const [title, text] = entry;
    assert.ok(title.trim() && text.trim(), `${key}: empty copy`);
    assert.ok(title.length <= MAX_TITLE, `${key}: title is ${title.length} characters (max ${MAX_TITLE})`);
    assert.ok(text.length <= MAX_TEXT, `${key}: text is ${text.length} characters (max ${MAX_TEXT})`);
  }
});

test('the start entry exists', () => {
  assert.ok(INFO.start);
});
