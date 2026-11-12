// Unit tests for the plain-English search parser (lib/nl-search.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, describe } from '../lib/nl-search.ts';

// Thursday 12 November 2026, so date ranges are predictable
const NOW = new Date(2026, 10, 12, 10, 0);
const day = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test('unfinished high priority tasks', () => {
  const q = parseQuery('unfinished high priority tasks', NOW);
  assert.equal(q.kind, 'tasks');
  assert.deepEqual(q.statuses, ['Open', 'In Progress']);
  assert.equal(q.priority, 'High');
  assert.deepEqual(q.terms, []);
});

test('tasks assigned to me', () => {
  const q = parseQuery('tasks assigned to me', NOW);
  assert.equal(q.kind, 'tasks');
  assert.equal(q.mine, true);
  assert.equal(q.assignee, null);
});

test('tasks assigned to a named person', () => {
  const q = parseQuery('open tasks assigned to priya', NOW);
  assert.equal(q.assignee, 'priya');
  assert.deepEqual(q.statuses, ['Open']);
});

test('overdue implies tasks', () => {
  const q = parseQuery('overdue', NOW);
  assert.equal(q.overdue, true);
  assert.equal(q.kind, 'tasks');
});

test('unassigned action items', () => {
  const q = parseQuery('unassigned action items', NOW);
  assert.equal(q.kind, 'tasks');
  assert.equal(q.unassigned, true);
  assert.equal(q.mine, false);
});

test('completed tasks this month', () => {
  const q = parseQuery('completed tasks this month', NOW);
  assert.deepEqual(q.statuses, ['Completed']);
  assert.equal(day(q.from), '2026-11-1');
  assert.equal(day(q.to), '2026-12-1');
});

test('meetings last week covers Monday to Monday', () => {
  const q = parseQuery('meetings last week', NOW);
  assert.equal(q.kind, 'meetings');
  assert.equal(day(q.from), '2026-11-2');
  assert.equal(day(q.to), '2026-11-9');
  assert.equal(q.dateLabel, 'last week');
});

test('tasks due this week', () => {
  const q = parseQuery('tasks due this week', NOW);
  assert.equal(q.dueWindow, true);
  assert.equal(day(q.from), '2026-11-9');
  assert.equal(day(q.to), '2026-11-16');
});

test('last 3 days', () => {
  const q = parseQuery('meetings in the last 3 days', NOW);
  assert.equal(day(q.from), '2026-11-9');
  assert.equal(day(q.to), '2026-11-13');
});

test('a month name in the future means last year', () => {
  const q = parseQuery('meetings in december', NOW);
  assert.equal(day(q.from), '2025-12-1');
  assert.equal(day(q.to), '2026-1-1');
});

test('topic words become search terms', () => {
  const q = parseQuery('what did we decide about the budget review?', NOW);
  assert.equal(q.kind, 'all');
  assert.deepEqual(q.terms, ['budget', 'review']);
});

test('describe() builds the filter chips shown above results', () => {
  const chips = describe(parseQuery('unfinished high priority tasks', NOW));
  assert.deepEqual(chips, ['Tasks', 'Not finished', 'High priority']);
});
