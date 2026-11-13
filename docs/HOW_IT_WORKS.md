# How NoteSketch works (for judge questions)

## Flow of one "Make my notes" click

| Step | Function (file) | Input → Output |
|---|---|---|
| 1 | `readPdf` (app.js) | PDF file → plain text (pdf.js, page by page) |
| 2 | `trimInput` (core.js) | messy text → cleaned, cut at 60,000 chars |
| 3 | `buildPrompt` + `languageRule` (core.js) | text + options (detail, focus, language) → prompt with rules + JSON shape |
| 4 | `askGemini` (app.js) | prompt → reply text (JSON mode; retries a busy model once, then tries other current Flash models; same on 404) |
| 5 | `extractJson` (core.js) | reply → JS object (strips ``` fences) |
| 6 | `normalizeNotes` (core.js) | any object → safe shape (drops/repairs bad parts) |
| 7 | `showNotes` (app.js) | notes → HTML cards |
| 8 | `drawDiagrams` (app.js) | Mermaid code → SVG (or text fallback) |

## Ask a doubt

| Step | Function | Input → Output |
|---|---|---|
| 1 | `buildDoubtPrompt` (core.js) | section JSON (without old doubts) + question (≤300 chars) + language → prompt |
| 2 | `askGemini` (app.js) | → `{"answer", "example": {"setup", "steps"}}` |
| 3 | `normalizeDoubt` (core.js) | drops empty answers, trims steps to 5 |
| 4 | `wireDoubts` (app.js) | shows it under the card, saves it into the notes (history + Markdown export) |

## Flashcards (Leitner boxes)

| Function (core.js) | What it does |
|---|---|
| `buildDeck` | key terms (term → meaning) + quiz (question → correct option + why); stable ids via `hashId` |
| `startQueue` | cards not yet mastered, weakest box first |
| `reviewCard` | Got it → box + 1 and leaves this round; Again → box 0 and comes back 3 cards later |
| `deckStats` | mastered (box 3) / learning / new |
| `parseProgress` | reads saved progress safely (junk in localStorage → empty) |

Progress is stored per lecture in localStorage under `notesketch.cards.<hash of title + headings>`; every storage call is in try/catch.

## What `normalizeNotes` repairs (example)

| AI returned | NoteSketch does |
|---|---|
| section without heading | drops it |
| table row too short `["1"]` for 2 columns | pads → `["1", ""]` |
| table row too long | cuts extra cells |
| diagram wrapped in ```mermaid | strips fences |
| diagram that isn't Mermaid | removes the diagram |
| quiz answer index 7 with 2 options | resets to 0 |
| 4+ "remember" lines | keeps 3 |

## Likely questions

| Q | A |
|---|---|
| Where does my lecture go? | Browser → Google Gemini API only. No NoteSketch server. |
| Why JSON instead of free text? | So layout is consistent: every section has idea → example → table/diagram → remember. |
| What if a diagram is wrong? | Mermaid render is in try/catch; it shows the outline text instead. |
| Hallucinations? | Prompt says "only facts from the lecture"; footer warns to check. |
| Why no framework? | Static site loads fast, deploys free on GitHub Pages, nothing to build. |
| How do regional languages work? | One prompt rule: write in the chosen language, keep technical terms in English in brackets, keep JSON keys and Mermaid keywords in English. Unit-tested for all 5 languages. |
| Why keep English terms? | The exam paper and textbook are in English, so students need to recognise the English word. |
| Is the doubt answer grounded? | It gets only the section the student is reading as JSON, and is told to say when it's unsure. |
| Why Leitner and not SM-2? | Simple to explain, works within one session and across visits, and is easy to test as a pure function. |
