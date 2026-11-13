import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trimInput, buildPrompt, extractJson, normalizeNotes, tableHtml, toMarkdown, cleanMermaid, slugify,
  LANGUAGES, langCode, buildDoubtPrompt, normalizeDoubt, buildDeck, startQueue, reviewCard, deckStats, parseProgress, MASTERED_BOX,
} from '../js/core.js';
import { SAMPLE_NOTES } from '../js/sample.js';

test('trimInput cleans and truncates', () => {
  assert.deepEqual(trimInput('  a\r\n\n\n\nb   c '), { text: 'a\n\nb c', truncated: false });
  assert.equal(trimInput('x'.repeat(10), 4).truncated, true);
});

test('prompt includes lecture and detail', () => {
  const p = buildPrompt('LECTURE BODY', { detail: 'deep', focus: 'first' });
  assert.ok(p.includes('LECTURE BODY'));
  assert.ok(p.includes('8 to 10'));
  assert.ok(p.includes('first time'));
});

test('extractJson handles fences and noise', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":{"b":2}} thanks'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json'));
  assert.throws(() => extractJson('{"a": [1, 2}'), /cut off/);
});

test('normalizeNotes repairs bad shapes', () => {
  const n = normalizeNotes({
    sections: [
      { heading: 'A', table: { columns: ['x', 'y'], rows: [['1'], 'bad', ['2', '3', '4']] }, diagram: { mermaid: '```mermaid\nflowchart LR\\nA-->B\n```' }, remember: ['1', '2', '3', '4'] },
      { idea: 'no heading, dropped' },
      { heading: 'B', diagram: { mermaid: 'not a diagram' }, table: { columns: [], rows: [] } },
    ],
    quiz: [{ q: 'Q', options: ['a', 'b'], answer: 7 }, { q: 'bad' }],
  });
  assert.equal(n.title, 'Study notes');
  assert.equal(n.sections.length, 2);
  assert.deepEqual(n.sections[0].table.rows, [['1', ''], ['2', '3']]);
  assert.equal(n.sections[0].diagram.mermaid, 'flowchart LR\nA-->B');
  assert.equal(n.sections[0].remember.length, 3);
  assert.equal(n.sections[1].diagram, null);
  assert.equal(n.sections[1].table, null);
  assert.equal(n.quiz.length, 1);
  assert.equal(n.quiz[0].answer, 0);
  assert.throws(() => normalizeNotes({ sections: [] }));
});

test('tableHtml escapes', () => {
  const html = tableHtml({ columns: ['<b>'], rows: [['a&b']] });
  assert.ok(html.includes('&lt;b&gt;') && html.includes('a&amp;b'));
});

test('sample notes are valid and export to markdown', () => {
  const n = normalizeNotes(SAMPLE_NOTES);
  assert.equal(n.sections.length, 6);
  assert.equal(n.sections.filter((s) => s.diagram).length, 3);
  const md = toMarkdown(n);
  assert.ok(md.startsWith('# Transactions and Concurrency Control'));
  assert.ok(md.includes('```mermaid'));
  assert.ok(md.includes('| Time | T1 | T2 | X in DB |'));
});

test('small helpers', () => {
  assert.equal(cleanMermaid('```mermaid\nflowchart TD\n```'), 'flowchart TD');
  assert.equal(slugify('Transactions & Concurrency!'), 'transactions-concurrency');
});

// ---------- output language ----------

test('buildPrompt adds a language rule that keeps technical terms in English', () => {
  const en = buildPrompt('BODY');
  assert.ok(!en.includes('LANGUAGE:'));
  assert.ok(!en.includes('\n\n\nReturn ONLY'));
  for (const code of ['ta', 'hi', 'te', 'ml']) {
    const p = buildPrompt('BODY', { language: code });
    assert.ok(p.includes(`LANGUAGE: write every text value in ${LANGUAGES[code].name}`), code);
    assert.ok(p.includes('technical terms in English inside brackets'), code);
    assert.ok(p.includes('(Transaction)'), code);
  }
  assert.ok(buildPrompt('BODY', { language: 'ta' }).includes('தமிழ்'));
  assert.equal(langCode('xx'), 'en');
  assert.equal(langCode('__proto__'), 'en');
  assert.ok(!buildPrompt('BODY', { language: 'klingon' }).includes('LANGUAGE:'));
});

test('normalizeNotes keeps language and doubts', () => {
  const n = normalizeNotes({ language: 'hi', sections: [{ heading: 'A', doubts: [{ q: 'why?', answer: 'because' }, { q: 'bad' }] }] });
  assert.equal(n.language, 'hi');
  assert.equal(n.sections[0].doubts.length, 1);
  assert.equal(normalizeNotes({ sections: [{ heading: 'A' }] }).language, 'en');
});

// ---------- ask a doubt ----------
test('buildDoubtPrompt sends the section and question, not old doubts', () => {
  const section = { heading: '2PL', idea: 'lock then unlock', doubts: [{ q: 'OLD DOUBT', answer: 'x' }] };
  const p = buildDoubtPrompt(section, '  why no deadlock prevention? ', { title: 'DBMS', language: 'ta' });
  assert.ok(p.includes('"heading":"2PL"'));
  assert.ok(p.includes('why no deadlock prevention?'));
  assert.ok(!p.includes('OLD DOUBT'));
  assert.ok(p.includes('"DBMS"'));
  assert.ok(p.includes('LANGUAGE: write every text value in Tamil'));
  assert.ok(buildDoubtPrompt(section, 'x'.repeat(1000)).length < 2000);
});

test('normalizeDoubt repairs or rejects answers', () => {
  const d = normalizeDoubt({ answer: ' Yes ', example: { setup: 'S', steps: ['a', '', 'b', 'c', 'd', 'e', 'f'] } }, 'Q?');
  assert.deepEqual(d, { q: 'Q?', answer: 'Yes', example: { setup: 'S', steps: ['a', 'b', 'c', 'd', 'e'] } });
  assert.equal(normalizeDoubt({ answer: 'ok', example: { steps: [] } }, 'q').example, null);
  assert.throws(() => normalizeDoubt({ answer: '' }, 'q'));
  assert.throws(() => normalizeDoubt(null, 'q'));
});

test('markdown export includes doubts', () => {
  const n = normalizeNotes({ sections: [{ heading: 'A', doubts: [{ q: 'Why?', answer: 'Because.', example: { setup: 'S', steps: ['one'] } }] }] });
  const md = toMarkdown(n);
  assert.ok(md.includes('> **Doubt:** Why?'));
  assert.ok(md.includes('> 1. one'));
});

// ---------- flashcards ----------
test('buildDeck makes cards from key terms and quiz with stable ids', () => {
  const n = normalizeNotes(SAMPLE_NOTES);
  const deck = buildDeck(n);
  assert.equal(deck.length, n.keyTerms.length + n.quiz.length);
  assert.equal(new Set(deck.map((c) => c.id)).size, deck.length);
  assert.deepEqual(buildDeck(n).map((c) => c.id), deck.map((c) => c.id));
  const q = deck.find((c) => c.kind === 'quiz');
  assert.match(q.back, /^[A-D]\) /);
  assert.equal(buildDeck({ keyTerms: [{ term: 'X', meaning: '' }], quiz: [] }).length, 0);
});

test('Leitner review: got it promotes, again repeats soon, mastered cards leave the queue', () => {
  const deck = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  let progress = { e: { box: MASTERED_BOX }, d: { box: 1 } };
  let queue = startQueue(deck, progress);
  assert.deepEqual(queue, ['a', 'b', 'c', 'd']);

  ({ queue, progress } = reviewCard(queue, progress, false)); // a again
  assert.deepEqual(queue, ['b', 'c', 'd', 'a']);
  assert.equal(progress.a.box, 0);

  ({ queue, progress } = reviewCard(queue, progress, true)); // b got it
  assert.deepEqual(queue, ['c', 'd', 'a']);
  assert.equal(progress.b.box, 1);

  ({ queue, progress } = reviewCard(['d'], progress, false)); // last card again stays
  assert.deepEqual(queue, ['d']);
  assert.deepEqual(reviewCard([], progress, true).queue, []);

  const p3 = reviewCard(['x'], { x: { box: MASTERED_BOX } }, true).progress;
  assert.equal(p3.x.box, MASTERED_BOX);
  assert.deepEqual(deckStats(deck, { a: { box: 3 }, b: { box: 1 } }), { total: 5, mastered: 1, learning: 1, fresh: 3 });
});

test('parseProgress survives junk in storage', () => {
  assert.deepEqual(parseProgress('not json'), {});
  assert.deepEqual(parseProgress(null), {});
  assert.deepEqual(parseProgress('{"a":{"box":9},"b":{"box":-1},"c":"x","d":{"box":2}}'), { a: { box: 3 }, d: { box: 2 } });
});
