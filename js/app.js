import {
  trimInput, buildPrompt, extractJson, normalizeNotes, escapeHtml, tableHtml, toMarkdown, slugify,
  langCode, buildDoubtPrompt, normalizeDoubt, MAX_DOUBT_CHARS,
  hashId, buildDeck, startQueue, reviewCard, deckStats, parseProgress, MASTERED_BOX,
} from './core.js';
import { SAMPLE_LECTURE, SAMPLE_NOTES } from './sample.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs';
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
const KEY_STORE = 'notesketch.key';
const HISTORY_STORE = 'notesketch.history';
const LANG_STORE = 'notesketch.lang';
const THEME_STORE = 'notesketch.theme';
const CARDS_STORE = 'notesketch.cards.';

const $ = (id) => document.getElementById(id);
const els = {
  inputView: $('inputView'), notesView: $('notesView'), notes: $('notes'), cardsView: $('cardsView'),
  fileInput: $('fileInput'), dropZone: $('dropZone'), fileName: $('fileName'),
  text: $('lectureText'), charCount: $('charCount'), detail: $('detail'), focus: $('focus'), language: $('language'),
  apiKey: $('apiKey'), rememberKey: $('rememberKey'), model: $('model'), settings: $('settings'),
  generate: $('generateBtn'), sample: $('sampleBtn'), status: $('status'),
  back: $('backBtn'), md: $('mdBtn'), print: $('printBtn'), cardsBtn: $('cardsBtn'), notesTools: $('notesTools'),
  historyBtn: $('historyBtn'), historyDialog: $('historyDialog'), historyList: $('historyList'),
  themeBtn: $('themeBtn'),
  fcBack: $('fcBackBtn'), fcReset: $('fcResetBtn'), fcTitle: $('fcTitle'), fcStats: $('fcStats'), fcBar: $('fcBar'), fcStage: $('fcStage'),
};

let currentNotes = null;
let currentHistoryAt = null;

// ---------- storage (can fail in private mode, so always guarded) ----------
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const savedKey = store.get(KEY_STORE);
if (savedKey) { els.apiKey.value = savedKey; els.rememberKey.checked = true; }
els.language.value = langCode(store.get(LANG_STORE));
els.language.addEventListener('change', () => store.set(LANG_STORE, els.language.value));

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

function updateCount() {
  els.charCount.textContent = `${els.text.value.length.toLocaleString()} characters`;
}
els.text.addEventListener('input', updateCount);

function showView(name) {
  for (const v of ['inputView', 'notesView', 'cardsView']) els[v].classList.toggle('hidden', v !== name);
  window.scrollTo({ top: 0 });
  if (name === 'notesView') redrawDiagrams();
}

// ---------- theme (follows the system unless the user picks one) ----------
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';
function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  els.themeBtn.textContent = isDark() ? '☀️' : '🌙';
  els.themeBtn.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
}
applyTheme(store.get(THEME_STORE));
els.themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  store.set(THEME_STORE, next);
  applyTheme(next);
  redrawDiagrams();
});
systemDark.addEventListener('change', () => { applyTheme(store.get(THEME_STORE)); redrawDiagrams(); });

// ---------- file reading ----------
let pdfjs = null;
async function readPdf(file) {
  if (!pdfjs) {
    pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    setStatus(`Reading page ${i} of ${doc.numPages}…`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  return pages.join('\n\n');
}

async function handleFile(file) {
  if (!file) return;
  els.fileName.textContent = file.name;
  try {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const text = isPdf ? await readPdf(file) : await file.text();
    if (!text.trim()) throw new Error('No text found. Scanned PDFs (photos of pages) are not supported yet.');
    els.text.value = text;
    updateCount();
    setStatus(`Loaded ${file.name}. Click "Make my notes".`);
  } catch (err) {
    setStatus(err.message || 'Could not read that file.', true);
  }
}

els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));
['dragenter', 'dragover'].forEach((ev) =>
  els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.remove('over'); }));
els.dropZone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

// ---------- Gemini ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt, key, model, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Calls Gemini; retries once when the model is busy and falls back to another model name if the chosen one is gone. */
async function askGemini(prompt, key, model, signal) {
  const models = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  let lastMsg = '';
  let busy = false;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { res, data } = await callGemini(prompt, key, m, signal);
      if (res.ok) {
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
        if (!text) {
          const why = data.promptFeedback?.blockReason || cand?.finishReason;
          throw new Error(`Gemini returned an empty answer${why ? ` (${why})` : ''}. Try a different text.`);
        }
        if (cand?.finishReason === 'MAX_TOKENS') {
          try { extractJson(text); } catch { throw new Error('The notes were too long for one reply. Choose "Quick revision" or use a shorter part of the lecture.'); }
        }
        return text;
      }
      lastMsg = data.error?.message || `HTTP ${res.status}`;
      if ((res.status === 400 || res.status === 403) && /API key|permission|unregistered/i.test(lastMsg)) {
        throw new Error('That API key was rejected. Check it in Google AI Studio.');
      }
      if (res.status === 429) throw new Error('Free Gemini quota used up for now. Wait a minute and try again.');
      if (res.status === 404) break; // model name not available: try the next one
      if (res.status >= 500) { busy = true; if (attempt === 0) { await sleep(1500); continue; } break; } // still busy: try the next model
      throw new Error(`Gemini error: ${lastMsg}`);
    }
  }
  if (busy) throw new Error('Gemini is very busy right now. Wait a minute and try again.');
  throw new Error(`Model "${model}" was not found. Try another model name in settings. (${lastMsg})`);
}

function getKey() {
  const key = els.apiKey.value.trim();
  if (key) {
    if (els.rememberKey.checked) store.set(KEY_STORE, key); else store.remove(KEY_STORE);
  }
  return key;
}
const getModel = () => els.model.value.trim() || DEFAULT_MODEL;

// ---------- generating (with skeleton) ----------
const STEPS = ['Finding the key ideas', 'Inventing worked examples', 'Drawing tables and diagrams', 'Writing quiz questions'];
let genAbort = null;

function skeletonHtml() {
  const card = `<div class="card sk-card"><div class="sk sk-h"></div><div class="sk sk-line"></div><div class="sk sk-block"></div><div class="sk sk-line short"></div></div>`;
  return `<div class="gen-progress" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <div><b id="genStep">${STEPS[0]}…</b><div class="small muted">Usually 20–60 seconds. Bigger lectures take longer.</div></div>
      <button type="button" class="secondary" id="cancelGen">Cancel</button>
    </div>
    <ol class="gen-steps">${STEPS.map((s, i) => `<li data-i="${i}">${s}</li>`).join('')}</ol>
    <div class="notes-head"><div class="sk sk-title"></div><div class="sk sk-line center"></div></div>${card}${card}${card}`;
}

async function generate() {
  const { text, truncated } = trimInput(els.text.value);
  if (text.length < 200) {
    setStatus('Add a bit more lecture text (at least a couple of paragraphs), or upload a PDF.', true);
    return;
  }
  const key = getKey();
  if (!key) {
    els.settings.open = true;
    els.apiKey.focus();
    setStatus('Paste your free Gemini API key first (or click "See an example").', true);
    return;
  }
  const language = langCode(els.language.value);

  setStatus('');
  els.generate.disabled = true;
  els.notesTools.classList.add('hidden');
  els.notes.innerHTML = skeletonHtml();
  showView('notesView');
  genAbort = new AbortController();
  $('cancelGen').addEventListener('click', () => genAbort.abort());

  let s = 0;
  const mark = () => {
    const stepEl = $('genStep');
    if (stepEl) stepEl.textContent = `${STEPS[s]}…`;
    els.notes.querySelectorAll('.gen-steps li').forEach((li) => {
      li.classList.toggle('done', +li.dataset.i < s);
      li.classList.toggle('now', +li.dataset.i === s);
    });
  };
  mark();
  const ticker = setInterval(() => { s = Math.min(s + 1, STEPS.length - 1); mark(); }, 6000);
  try {
    const reply = await askGemini(
      buildPrompt(text, { detail: els.detail.value, focus: els.focus.value, language }),
      key, getModel(), genAbort.signal,
    );
    const notes = normalizeNotes({ ...extractJson(reply), language });
    saveHistory(notes);
    await showNotes(notes, truncated ? 'The lecture was long, so only the first part (60,000 characters) was used.' : '');
  } catch (err) {
    showView('inputView');
    setStatus(err.name === 'AbortError' ? 'Cancelled.' : (err.message || 'Something went wrong.'), err.name !== 'AbortError');
  } finally {
    clearInterval(ticker);
    els.generate.disabled = false;
    genAbort = null;
  }
}
els.generate.addEventListener('click', generate);

els.sample.addEventListener('click', async () => {
  els.text.value = SAMPLE_LECTURE;
  updateCount();
  currentHistoryAt = null;
  await showNotes(normalizeNotes(SAMPLE_NOTES));
});

// ---------- rendering ----------
let mermaidLib = null;
async function getMermaid() {
  if (!mermaidLib) mermaidLib = (await import(MERMAID_URL)).default;
  mermaidLib.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'neutral', securityLevel: 'strict', fontFamily: 'inherit' });
  return mermaidLib;
}

async function drawDiagrams(root) {
  const boxes = [...root.querySelectorAll('.diagram[data-code]')];
  if (!boxes.length) return;
  root.dataset.drawnTheme = isDark() ? 'dark' : 'light';
  let mermaid;
  try {
    mermaid = await getMermaid();
  } catch {
    boxes.forEach((b) => { b.innerHTML = `<pre>${escapeHtml(b.dataset.code)}</pre>`; });
    return;
  }
  for (const [i, box] of boxes.entries()) {
    const code = box.dataset.code;
    try {
      const { svg } = await mermaid.render(`dg-${Date.now()}-${i}`, code);
      box.innerHTML = svg;
    } catch {
      box.innerHTML = `<p class="small muted">Couldn't draw this diagram, here is its outline:</p><pre>${escapeHtml(code)}</pre>`;
    }
  }
}
function redrawDiagrams() {
  const theme = isDark() ? 'dark' : 'light';
  if (currentNotes && !els.notesView.classList.contains('hidden') && els.notes.dataset.drawnTheme && els.notes.dataset.drawnTheme !== theme) {
    drawDiagrams(els.notes);
  }
}

function exampleHtml(ex, cls = '') {
  if (!ex) return '';
  return `<div class="block example ${cls}"><div class="label">Example</div>` +
    (ex.setup ? `<div class="setup">${escapeHtml(ex.setup)}</div>` : '') +
    (ex.steps.length ? `<ol class="steps">${ex.steps.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>` : '') +
    '</div>';
}

function answerHtml(d) {
  return `<div class="answer"><div class="answer-q">🤔 ${escapeHtml(d.q)}</div><p>${escapeHtml(d.answer)}</p>${exampleHtml(d.example, 'mini')}</div>`;
}

function sectionHtml(s, i) {
  const parts = [`<section class="card" id="s${i + 1}"><h2><span class="num">${i + 1}</span>${escapeHtml(s.heading)}</h2>`];
  if (s.idea) parts.push(`<p class="idea">${escapeHtml(s.idea)}</p>`);
  parts.push(exampleHtml(s.example));
  if (s.table) {
    parts.push(`<div class="block"><div class="label">Table</div><div class="table-wrap">${tableHtml(s.table)}</div>`);
    if (s.table.caption) parts.push(`<div class="caption">${escapeHtml(s.table.caption)}</div>`);
    parts.push('</div>');
  }
  if (s.diagram) {
    parts.push(`<div class="block"><div class="label">Diagram</div><div class="diagram" data-code="${escapeHtml(s.diagram.mermaid)}">Drawing…</div>`);
    if (s.diagram.caption) parts.push(`<div class="caption">${escapeHtml(s.diagram.caption)}</div>`);
    parts.push('</div>');
  }
  if (s.remember.length) {
    parts.push(`<div class="block"><div class="label">Remember</div><div class="remember">${s.remember.map((r) => `<span class="chip">💡 ${escapeHtml(r)}</span>`).join('')}</div></div>`);
  }
  parts.push(`<div class="doubt-area" data-i="${i}"><div class="answers">${s.doubts.map(answerHtml).join('')}</div>
    <form class="doubt" novalidate>
      <input type="text" name="q" maxlength="${MAX_DOUBT_CHARS}" autocomplete="off" placeholder="🤔 Ask a doubt about this section…" aria-label="Ask a doubt about ${escapeHtml(s.heading)}" />
      <button type="submit" class="secondary">Ask</button>
    </form></div>`);
  parts.push('</section>');
  return parts.join('');
}

function wireDoubts(root, notes) {
  root.querySelectorAll('.doubt-area').forEach((area) => {
    const form = area.querySelector('form');
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    const answers = area.querySelector('.answers');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      area.querySelector('.doubt-err')?.remove();
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      const key = getKey();
      if (!key) {
        form.insertAdjacentHTML('afterend', '<p class="doubt-err">Add your free Gemini API key first: <button type="button" class="linkish">open settings</button></p>');
        area.querySelector('.linkish').addEventListener('click', () => {
          showView('inputView');
          els.settings.open = true;
          els.apiKey.focus();
        });
        return;
      }
      const section = notes.sections[+area.dataset.i];
      const loading = document.createElement('div');
      loading.className = 'answer loading';
      loading.innerHTML = `<div class="answer-q">🤔 ${escapeHtml(q)}</div><div class="sk sk-line"></div><div class="sk sk-line short"></div>`;
      answers.append(loading);
      input.disabled = true; btn.disabled = true;
      try {
        const reply = await askGemini(buildDoubtPrompt(section, q, { title: notes.title, language: notes.language }), key, getModel());
        const doubt = normalizeDoubt(extractJson(reply), q);
        section.doubts.push(doubt);
        loading.outerHTML = answerHtml(doubt);
        input.value = '';
        updateHistory(notes);
      } catch (err) {
        loading.remove();
        form.insertAdjacentHTML('afterend', `<p class="doubt-err">${escapeHtml(err.message || 'Could not get an answer.')}</p>`);
      } finally {
        input.disabled = false; btn.disabled = false;
      }
    });
  });
}

function quizHtml(quiz) {
  if (!quiz.length) return '';
  return `<section class="card" id="quiz"><h2><span class="num">?</span>Quick quiz <span class="score small muted" id="score"></span></h2>${quiz
    .map((q, i) => `<div class="q" data-i="${i}"><p>${i + 1}. ${escapeHtml(q.q)}</p><div class="opts">${q.options
      .map((o, j) => `<button type="button" class="opt" data-j="${j}">${String.fromCharCode(65 + j)}) ${escapeHtml(o)}</button>`)
      .join('')}</div><div class="why hidden"></div></div>`)
    .join('')}</section>`;
}

function wireQuiz(root, quiz) {
  let answered = 0;
  let right = 0;
  root.querySelectorAll('.q').forEach((qEl) => {
    const q = quiz[+qEl.dataset.i];
    qEl.querySelectorAll('.opt').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (qEl.dataset.done) return;
        qEl.dataset.done = '1';
        const j = +btn.dataset.j;
        answered++;
        if (j === q.answer) right++;
        btn.classList.add(j === q.answer ? 'right' : 'wrong');
        qEl.querySelector(`.opt[data-j="${q.answer}"]`).classList.add('right');
        const why = qEl.querySelector('.why');
        why.textContent = (j === q.answer ? '✅ ' : '❌ ') + q.why;
        why.classList.remove('hidden');
        root.querySelector('#score').textContent = `${right}/${answered} correct`;
      }));
  });
}

async function showNotes(notes, notice = '') {
  currentNotes = notes;
  const deckSize = buildDeck(notes).length;
  const html = [
    notice ? `<p class="notice">ℹ️ ${escapeHtml(notice)}</p>` : '',
    `<div class="notes-head"><h1>${escapeHtml(notes.title)}</h1>`,
    notes.summary ? `<p class="muted">${escapeHtml(notes.summary)}</p>` : '',
    `<div class="toc">${notes.sections.map((s, i) => `<a href="#s${i + 1}">${i + 1}. ${escapeHtml(s.heading)}</a>`).join('')}` +
      `${notes.keyTerms.length ? '<a href="#terms">Key terms</a>' : ''}${notes.quiz.length ? '<a href="#quiz">Quiz</a>' : ''}</div></div>`,
    notes.sections.map(sectionHtml).join(''),
    notes.keyTerms.length
      ? `<section class="card" id="terms"><h2><span class="num">Aa</span>Key terms</h2><div class="terms">${notes.keyTerms
          .map((k) => `<div class="term"><b>${escapeHtml(k.term)}</b><span class="small">${escapeHtml(k.meaning)}</span></div>`)
          .join('')}</div></section>`
      : '',
    quizHtml(notes.quiz),
    deckSize ? `<div class="cta-cards"><button type="button" class="primary" id="cardsCta">🃏 Practise ${deckSize} flashcards</button></div>` : '',
  ].join('');

  els.notes.innerHTML = html;
  delete els.notes.dataset.drawnTheme;
  els.notes.lang = notes.language;
  els.cardsBtn.classList.toggle('hidden', !deckSize);
  els.notesTools.classList.remove('hidden');
  showView('notesView');
  document.title = `${notes.title} · NoteSketch`;
  wireQuiz(els.notes, notes.quiz);
  wireDoubts(els.notes, notes);
  $('cardsCta')?.addEventListener('click', openCards);
  await drawDiagrams(els.notes);
}

els.back.addEventListener('click', () => {
  if (genAbort) genAbort.abort();
  showView('inputView');
  document.title = 'NoteSketch: lectures into visual study notes';
});

els.print.addEventListener('click', () => window.print());

els.md.addEventListener('click', () => {
  if (!currentNotes) return;
  const blob = new Blob([toMarkdown(currentNotes)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slugify(currentNotes.title)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- flashcards ----------
const fc = { deck: [], byId: new Map(), queue: [], progress: {}, flipped: false, key: '', round: { got: 0, again: 0 } };

const KIND_LABEL = { term: 'Key term', quiz: 'Quiz question' };

function cardsKey(notes) {
  return CARDS_STORE + hashId(`${notes.title}|${notes.sections.map((s) => s.heading).join('|')}`);
}

function saveProgress() { store.set(fc.key, JSON.stringify(fc.progress)); }

function openCards() {
  if (!currentNotes) return;
  fc.deck = buildDeck(currentNotes);
  fc.byId = new Map(fc.deck.map((c) => [c.id, c]));
  fc.key = cardsKey(currentNotes);
  fc.progress = parseProgress(store.get(fc.key));
  fc.queue = startQueue(fc.deck, fc.progress);
  fc.round = { got: 0, again: 0 };
  els.fcTitle.textContent = currentNotes.title;
  els.cardsView.lang = currentNotes.language;
  showView('cardsView');
  renderCard();
}

function renderStats() {
  const st = deckStats(fc.deck, fc.progress);
  els.fcStats.innerHTML = `<span><b>${st.mastered}</b> mastered</span><span><b>${st.learning}</b> learning</span><span><b>${st.fresh}</b> new</span><span><b>${fc.queue.length}</b> left this round</span>`;
  els.fcBar.style.width = `${st.total ? Math.round((100 * st.mastered) / st.total) : 0}%`;
  els.fcBar.parentElement.setAttribute('aria-valuenow', String(st.mastered));
  els.fcBar.parentElement.setAttribute('aria-valuemax', String(st.total));
}

function boxDots(id) {
  const box = fc.progress[id]?.box ?? 0;
  return `<span class="dots" title="Got it ${box} of ${MASTERED_BOX} times">${Array.from({ length: MASTERED_BOX }, (_, i) => `<i class="${i < box ? 'on' : ''}"></i>`).join('')}</span>`;
}

function renderCard() {
  renderStats();
  fc.flipped = false;
  if (!fc.queue.length) {
    const st = deckStats(fc.deck, fc.progress);
    const all = st.mastered === st.total;
    els.fcStage.innerHTML = `<div class="fc-done card">
        <div class="big">${all ? '🏆' : '🎉'}</div>
        <h2>${all ? `All ${st.total} cards mastered!` : 'Round complete'}</h2>
        <p class="muted">${fc.round.got} got it · ${fc.round.again} again this round. ${all ? 'Reset progress to practise again from scratch.' : `${st.total - st.mastered} cards still to master: each needs "Got it" ${MASTERED_BOX} times.`}</p>
        <div class="actions center">${all ? '' : '<button type="button" class="primary" id="fcNext">Next round →</button>'}<button type="button" class="secondary" id="fcToNotes">Back to notes</button></div>
      </div>`;
    $('fcNext')?.addEventListener('click', () => { fc.queue = startQueue(fc.deck, fc.progress); fc.round = { got: 0, again: 0 }; renderCard(); });
    $('fcToNotes').addEventListener('click', () => showView('notesView'));
    return;
  }
  const c = fc.byId.get(fc.queue[0]);
  els.fcStage.innerHTML = `
    <button type="button" class="fc" id="fcCard" aria-label="Flashcard. Press to flip.">
      <span class="fc-inner">
        <span class="fc-face fc-front"><span class="fc-kind">${KIND_LABEL[c.kind]} ${boxDots(c.id)}</span><span class="fc-text">${escapeHtml(c.front)}</span><span class="fc-hint">Think of the answer, then tap or press Space to flip</span></span>
        <span class="fc-face fc-back"><span class="fc-kind">Answer</span><span class="fc-text">${escapeHtml(c.back)}</span>${c.extra ? `<span class="fc-extra">${escapeHtml(c.extra)}</span>` : ''}</span>
      </span>
    </button>
    <div class="fc-actions">
      <button type="button" class="again" id="fcAgain" disabled>↺ Again <kbd>1</kbd></button>
      <button type="button" class="gotit" id="fcGot" disabled>✓ Got it <kbd>2</kbd></button>
    </div>`;
  $('fcCard').addEventListener('click', flipCard);
  $('fcAgain').addEventListener('click', () => answerCard(false));
  $('fcGot').addEventListener('click', () => answerCard(true));
}

function flipCard() {
  const card = $('fcCard');
  if (!card) return;
  fc.flipped = !fc.flipped;
  card.classList.toggle('flipped', fc.flipped);
  if (fc.flipped) { $('fcAgain').disabled = false; $('fcGot').disabled = false; }
}

function answerCard(gotIt) {
  if (!fc.flipped || !fc.queue.length) return;
  ({ queue: fc.queue, progress: fc.progress } = reviewCard(fc.queue, fc.progress, gotIt));
  fc.round[gotIt ? 'got' : 'again']++;
  saveProgress();
  renderCard();
  $('fcCard')?.focus();
}

document.addEventListener('keydown', (e) => {
  if (els.cardsView.classList.contains('hidden') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' || e.key === 'Enter') {
    if (document.activeElement?.id === 'fcCard' || document.activeElement === document.body) { e.preventDefault(); flipCard(); }
  } else if (e.key === '1' || e.key === 'ArrowLeft') answerCard(false);
  else if (e.key === '2' || e.key === 'ArrowRight') answerCard(true);
});

els.cardsBtn.addEventListener('click', openCards);
els.fcBack.addEventListener('click', () => showView('notesView'));
els.fcReset.addEventListener('click', () => {
  if (!confirm('Reset flashcard progress for these notes?')) return;
  fc.progress = {};
  store.remove(fc.key);
  fc.queue = startQueue(fc.deck, fc.progress);
  fc.round = { got: 0, again: 0 };
  renderCard();
});

// ---------- history ----------
function loadHistory() {
  try {
    const list = JSON.parse(store.get(HISTORY_STORE) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function saveHistory(notes) {
  currentHistoryAt = new Date().toISOString();
  const list = [{ title: notes.title, at: currentHistoryAt, notes }, ...loadHistory()].slice(0, 5);
  store.set(HISTORY_STORE, JSON.stringify(list));
}
function updateHistory(notes) {
  if (!currentHistoryAt) return;
  const list = loadHistory().map((h) => (h.at === currentHistoryAt ? { ...h, notes } : h));
  store.set(HISTORY_STORE, JSON.stringify(list));
}
els.historyBtn.addEventListener('click', () => {
  const list = loadHistory();
  els.historyList.innerHTML = list.length
    ? list.map((h, i) => `<li><button class="secondary" data-i="${i}">${escapeHtml(h.title)} <span class="small muted">${escapeHtml(new Date(h.at).toLocaleString())}</span></button></li>`).join('')
    : '<li class="muted">Nothing yet. Your last 5 notes appear here.</li>';
  els.historyList.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', async () => {
      els.historyDialog.close();
      try {
        const h = list[+b.dataset.i];
        currentHistoryAt = h.at;
        await showNotes(normalizeNotes(h.notes));
      } catch (err) {
        setStatus(err.message || 'Could not open those notes.', true);
      }
    }));
  els.historyDialog.showModal();
});
