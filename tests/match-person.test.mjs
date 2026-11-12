// Unit tests for matching AI-heard names to workspace members (Backend/match-person.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPerson } from '../Backend/match-person.js';

const team = [
  { id: 1, name: 'Latif Naderi' },
  { id: 2, name: 'Chris Bobby' },
  { id: 3, name: 'Chris Lee' },
  { id: 4, name: 'Muhammad Taha' },
];

test('exact full name', () => assert.equal(matchPerson('Latif Naderi', team)?.id, 1));
test('ignores case and punctuation', () => assert.equal(matchPerson('  muhammad TAHA. ', team)?.id, 4));
test('unique first name', () => assert.equal(matchPerson('Latif', team)?.id, 1));
test('shared first name is not guessed', () => assert.equal(matchPerson('Chris', team), null));
test('full name still works when the first name is shared', () => assert.equal(matchPerson('Chris Lee', team)?.id, 3));
test('unknown name', () => assert.equal(matchPerson('Jessica', team), null));
test('empty or missing input', () => {
  assert.equal(matchPerson('', team), null);
  assert.equal(matchPerson(null, team), null);
  assert.equal(matchPerson('Latif', []), null);
});
