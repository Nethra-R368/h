// Pure helpers (no DOM, no network) so they can be unit-tested in Node.

export const MAX_INPUT_CHARS = 60000;

export const DETAIL = {
  quick: { sections: '3 to 4', label: 'Quick revision' },
  standard: { sections: '5 to 7', label: 'Standard' },
  deep: { sections: '8 to 10', label: 'Deep dive' },
};

export const LANGUAGES = {
  en: { name: 'English', native: 'English', example: '' },
  ta: { name: 'Tamil', native: 'தமிழ்', example: 'பரிவர்த்தனை (Transaction)' },
  hi: { name: 'Hindi', native: 'हिन्दी', example: 'लेन-देन (Transaction)' },
  te: { name: 'Telugu', native: 'తెలుగు', example: 'లావాదేవీ (Transaction)' },
  ml: { name: 'Malayalam', native: 'മലയാളം', example: 'ഇടപാട് (Transaction)' },
};

export const langCode = (code) => (Object.hasOwn(LANGUAGES, code) ? code : 'en');

/** One rule line telling the model which language to write in ('' for English). */
export function languageRule(code) {
  const c = langCode(code);
  if (c === 'en') return '';
  const l = LANGUAGES[c];
  return `- LANGUAGE: write every text value in ${l.name} (${l.native}), in simple spoken-style ${l.name} a student would use. ` +
    `Keep technical terms in English inside brackets right after the ${l.name} word, like "${l.example}". ` +
    `Keep numbers, variable names, code and formulas as they are. JSON keys and Mermaid keywords stay in English; Mermaid labels may be in ${l.name}.`;
}

export function trimInput(text, max = MAX_INPUT_CHARS) {
  const clean = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean.length > max ? { text: clean.slice(0, max), truncated: true } : { text: clean, truncated: false };
}

export function buildPrompt(lectureText, { detail = 'standard', focus = 'exam', language = 'en' } = {}) {
  const d = DETAIL[detail] || DETAIL.standard;
  const audience =
    focus === 'first'
      ? 'a student seeing this topic for the first time'
      : 'a student revising for an exam the night before';

  return `You turn lecture material into visual study notes for ${audience} who does NOT like reading long text.

RULES
- Teach every idea through a small, concrete worked EXAMPLE with real values (numbers, names, steps). No abstract paragraphs.
- Every text field is short: at most 25 words. No paragraphs.
- Prefer TABLES whenever something changes over time or is compared (timelines of steps, before/after, A vs B, input -> output).
- Add a DIAGRAM (Mermaid) when there is a flow, cycle, hierarchy or interaction. Use only "flowchart LR", "flowchart TD" or "sequenceDiagram".
  Mermaid safety: put every node label in double quotes like A["Read X"], no parentheses or quotes inside labels, no HTML, no "end" as a node id.
- Use only facts from the lecture. If the lecture is unclear, keep it simple rather than inventing details.
- Write ${d.sections} sections, in the order a student should learn them.
- Write 6 to 10 key terms and 5 multiple-choice quiz questions (4 options each).
${languageRule(language)}

Return ONLY JSON with exactly this shape:
{
  "title": "short topic title",
  "summary": "one sentence: what this lecture is about",
  "sections": [
    {
      "heading": "concept name",
      "idea": "the concept in one short sentence",
      "example": { "setup": "the example situation", "steps": ["step 1", "step 2"] },
      "table": { "caption": "what the table shows", "columns": ["col1", "col2"], "rows": [["a", "b"]] } or null,
      "diagram": { "caption": "what the diagram shows", "mermaid": "flowchart LR\\n A[\\"x\\"] --> B[\\"y\\"]" } or null,
      "remember": ["up to 3 one-line takeaways or exam traps"]
    }
  ],
  "keyTerms": [{ "term": "word", "meaning": "short meaning" }],
  "quiz": [{ "q": "question", "options": ["a", "b", "c", "d"], "answer": 0, "why": "short reason" }]
}

LECTURE MATERIAL
"""
${lectureText}
"""`.replace(/\n\n\nReturn ONLY/, '\n\nReturn ONLY');
}

/** Pull a JSON object out of a model reply, even if wrapped in ``` fences or extra text. */
export function extractJson(reply) {
  const text = String(reply || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The AI reply did not contain JSON. Please try again.');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('The AI reply was cut off or malformed. Please try again (Quick revision gives shorter replies).');
  }
}

const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : v == null ? fallback : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);

export function cleanMermaid(code) {
  return str(code)
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/, '')
    .replace(/\\n/g, '\n')
    .trim();
}

function normTable(t) {
  if (!t || typeof t !== 'object') return null;
  const columns = arr(t.columns).map((c) => str(c));
  const rows = arr(t.rows)
    .filter(Array.isArray)
    .map((r) => columns.map((_, i) => str(r[i], '')));
  if (!columns.length || !rows.length) return null;
  return { caption: str(t.caption), columns, rows };
}

function normDiagram(d) {
  if (!d || typeof d !== 'object') return null;
  const mermaid = cleanMermaid(d.mermaid);
  if (!/^(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|mindmap|timeline)/.test(mermaid)) return null;
  return { caption: str(d.caption), mermaid };
}

/** Make sure the notes object has the shape the renderer expects, whatever the AI returned. */
export function normalizeNotes(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Notes are empty.');
  const sections = arr(raw.sections)
    .filter((s) => s && typeof s === 'object' && str(s.heading))
    .map((s) => ({
      heading: str(s.heading),
      idea: str(s.idea),
      example: s.example && typeof s.example === 'object'
        ? { setup: str(s.example.setup), steps: arr(s.example.steps).map((x) => str(x)).filter(Boolean) }
        : null,
      table: normTable(s.table),
      diagram: normDiagram(s.diagram),
      remember: arr(s.remember).map((x) => str(x)).filter(Boolean).slice(0, 3),
      doubts: arr(s.doubts).map((d) => { try { return normalizeDoubt(d, d && d.q); } catch { return null; } }).filter(Boolean),
    }));
  if (!sections.length) throw new Error('The AI returned no sections. Try a longer or clearer lecture text.');

  const quiz = arr(raw.quiz)
    .filter((q) => q && str(q.q) && arr(q.options).length >= 2)
    .map((q) => {
      const options = arr(q.options).map((o) => str(o)).slice(0, 4);
      const answer = Number.isInteger(q.answer) && q.answer >= 0 && q.answer < options.length ? q.answer : 0;
      return { q: str(q.q), options, answer, why: str(q.why) };
    });

  return {
    title: str(raw.title, 'Study notes') || 'Study notes',
    summary: str(raw.summary),
    language: langCode(raw.language),
    sections,
    keyTerms: arr(raw.keyTerms)
      .filter((k) => k && str(k.term))
      .map((k) => ({ term: str(k.term), meaning: str(k.meaning) })),
    quiz,
  };
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function tableHtml(table) {
  const head = table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown export (diagrams kept as mermaid blocks, which GitHub/Obsidian/Notion render). */
export function toMarkdown(notes) {
  const out = [`# ${notes.title}`, ''];
  if (notes.summary) out.push(`> ${notes.summary}`, '');
  notes.sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.heading}`, '');
    if (s.idea) out.push(`**Idea:** ${s.idea}`, '');
    if (s.example) {
      out.push(`**Example:** ${s.example.setup}`, '');
      s.example.steps.forEach((step, j) => out.push(`${j + 1}. ${step}`));
      out.push('');
    }
    if (s.table) {
      if (s.table.caption) out.push(`*${s.table.caption}*`, '');
      out.push(`| ${s.table.columns.map(mdCell).join(' | ')} |`);
      out.push(`| ${s.table.columns.map(() => '---').join(' | ')} |`);
      s.table.rows.forEach((r) => out.push(`| ${r.map(mdCell).join(' | ')} |`));
      out.push('');
    }
    if (s.diagram) {
      if (s.diagram.caption) out.push(`*${s.diagram.caption}*`, '');
      out.push('```mermaid', s.diagram.mermaid, '```', '');
    }
    if (s.remember.length) {
      out.push('**Remember:**');
      s.remember.forEach((r) => out.push(`- ${r}`));
      out.push('');
    }
    (s.doubts || []).forEach((d) => {
      out.push(`> **Doubt:** ${d.q}`, '>', `> ${d.answer}`);
      if (d.example) {
        if (d.example.setup) out.push('>', `> *Example:* ${d.example.setup}`);
        d.example.steps.forEach((step, j) => out.push(`> ${j + 1}. ${step}`));
      }
      out.push('');
    });
  });
  if (notes.keyTerms.length) {
    out.push('## Key terms', '', '| Term | Meaning |', '| --- | --- |');
    notes.keyTerms.forEach((k) => out.push(`| ${mdCell(k.term)} | ${mdCell(k.meaning)} |`));
    out.push('');
  }
  if (notes.quiz.length) {
    out.push('## Quiz', '');
    notes.quiz.forEach((q, i) => {
      out.push(`**Q${i + 1}. ${q.q}**`, '');
      q.options.forEach((o, j) => out.push(`- ${String.fromCharCode(65 + j)}) ${o}`));
      out.push('', `<details><summary>Answer</summary>${String.fromCharCode(65 + q.answer)}: ${q.why}</details>`, '');
    });
  }
  return out.join('\n');
}

export function slugify(text) {
  return String(text || 'notes').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'notes';
}

// ---------- Ask a doubt ----------

export const MAX_DOUBT_CHARS = 300;

/** Prompt for a short, example-based answer to a student's question about one section. */
export function buildDoubtPrompt(section, question, { title = '', language = 'en' } = {}) {
  const { doubts, ...plain } = section || {};
  const q = String(question || '').trim().slice(0, MAX_DOUBT_CHARS);
  return `You are a friendly tutor. A student is studying "${title || 'a lecture'}" and has a doubt about one section of their notes.

SECTION (JSON)
${JSON.stringify(plain)}

STUDENT'S DOUBT
"""
${q}
"""

RULES
- Answer the doubt directly in at most 50 words, then show it with ONE tiny worked example with real values (2 to 4 steps, each at most 20 words).
- Reuse the names and numbers from the section when possible.
- If the doubt is outside this section, say so in a few words and still answer it simply.
- If you are not sure, say so instead of inventing facts.
${languageRule(language)}

Return ONLY JSON: {"answer": "short answer", "example": {"setup": "example situation", "steps": ["step 1", "step 2"]}}`.replace(/\n\n\nReturn ONLY/, '\n\nReturn ONLY');
}

export function normalizeDoubt(raw, question) {
  if (!raw || typeof raw !== 'object') throw new Error('The AI gave an empty answer. Try asking again.');
  const answer = str(raw.answer);
  if (!answer) throw new Error('The AI gave an empty answer. Try asking again.');
  const ex = raw.example && typeof raw.example === 'object'
    ? { setup: str(raw.example.setup), steps: arr(raw.example.steps).map((x) => str(x)).filter(Boolean).slice(0, 5) }
    : null;
  return { q: str(question).slice(0, MAX_DOUBT_CHARS), answer, example: ex && (ex.setup || ex.steps.length) ? ex : null };
}

// ---------- Flashcards (Leitner boxes 0..3; box 3 = mastered) ----------

export const MASTERED_BOX = 3;
const AGAIN_GAP = 3;

/** Small stable hash so a card keeps its progress across sessions. */
export function hashId(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Flashcards from key terms (term -> meaning) and quiz (question -> answer + why). */
export function buildDeck(notes) {
  const cards = [];
  const seen = new Set();
  const add = (kind, front, back, extra) => {
    const id = hashId(`${kind}|${front}`);
    if (!front || !back || seen.has(id)) return;
    seen.add(id);
    cards.push({ id, kind, front, back, extra: extra || '' });
  };
  arr(notes && notes.keyTerms).forEach((k) => add('term', str(k.term), str(k.meaning)));
  arr(notes && notes.quiz).forEach((q) => {
    const opt = arr(q.options)[q.answer];
    add('quiz', str(q.q), `${String.fromCharCode(65 + q.answer)}) ${str(opt)}`, str(q.why));
  });
  return cards;
}

/** Ids of cards still to learn, weakest box first (original order within a box). */
export function startQueue(deck, progress = {}) {
  return deck
    .map((c, i) => ({ id: c.id, i, box: progress[c.id]?.box ?? 0 }))
    .filter((c) => c.box < MASTERED_BOX)
    .sort((a, b) => a.box - b.box || a.i - b.i)
    .map((c) => c.id);
}

/** "Got it" (true) moves the front card up a box and out of this round; "Again" resets it and shows it again soon. */
export function reviewCard(queue, progress, gotIt) {
  if (!queue.length) return { queue, progress };
  const [id, ...rest] = queue;
  const box = progress[id]?.box ?? 0;
  const next = { ...progress, [id]: { box: gotIt ? Math.min(MASTERED_BOX, box + 1) : 0 } };
  if (gotIt) return { queue: rest, progress: next };
  const at = Math.min(AGAIN_GAP, rest.length);
  return { queue: [...rest.slice(0, at), id, ...rest.slice(at)], progress: next };
}

export function deckStats(deck, progress = {}) {
  const boxes = deck.map((c) => progress[c.id]?.box ?? 0);
  return {
    total: deck.length,
    mastered: boxes.filter((b) => b >= MASTERED_BOX).length,
    learning: boxes.filter((b) => b > 0 && b < MASTERED_BOX).length,
    fresh: boxes.filter((b) => b === 0).length,
  };
}

/** Read saved flashcard progress defensively (storage may hold anything). */
export function parseProgress(json) {
  try {
    const raw = JSON.parse(json || '{}');
    const out = {};
    if (raw && typeof raw === 'object') {
      for (const [id, v] of Object.entries(raw)) {
        const box = Number(v && v.box);
        if (Number.isInteger(box) && box >= 0) out[id] = { box: Math.min(MASTERED_BOX, box) };
      }
    }
    return out;
  } catch {
    return {};
  }
}
