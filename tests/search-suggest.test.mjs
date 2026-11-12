// Unit tests for the search box suggestions (lib/search-suggest.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestions } from '../lib/search-suggest.ts';

const opts = { recent: ['campus it'], meetings: ['Sprint 13 retro', 'Q4 budget review'], people: ['Priya Sharma', 'Tom Walsh'] };

test('empty box shows recent searches first', () => {
  const s = buildSuggestions('', opts);
  assert.equal(s[0].text, 'campus it');
  assert.equal(s[0].kind, 'recent');
});

test('completes a known phrase', () => {
  const s = buildSuggestions('overd', opts);
  assert.ok(s.some(x => x.text === 'overdue tasks'));
});

test('suggests team members after "assigned to"', () => {
  const s = buildSuggestions('tasks assigned to pr', opts);
  assert.ok(s.some(x => x.text === 'tasks assigned to Priya Sharma' && x.kind === 'person'));
});

test('suggests meeting titles after "about"', () => {
  const s = buildSuggestions('meetings about budg', opts);
  assert.ok(s.some(x => x.text === 'meetings about Q4 budget review'));
});

test('never suggests the exact text already typed', () => {
  const s = buildSuggestions('open tasks', opts);
  assert.ok(!s.some(x => x.text === 'open tasks'));
});

test('respects the limit', () => {
  assert.ok(buildSuggestions('t', opts, 3).length <= 3);
});
