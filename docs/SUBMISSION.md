# NoteSketch: submission text (copy-paste)

Use the same project page for **SLAY HACKS** (AI focus), **Arbiter Hacks** (General track) and **AI OpenBuild**.

**Built Nov 11–12, 2026** (features added Nov 13, 2026). Solo project.

- Live demo: https://nethra-r368.github.io/h/
- Code: https://github.com/Nethra-R368/h
- AI used: **Google Gemini** (`gemini-3.8-flash`, JSON mode), called from the browser

## Tagline
Lectures in. Examples, tables and diagrams out, in your own language.

## Inspiration
I struggle to read long notes. What makes a topic click for me is a worked example, a table showing what happens step by step, or a diagram. Lecture slides rarely give you that, and making it yourself takes hours the night before an exam. Many of my classmates also think in Tamil, Hindi, Telugu or Malayalam, but the exam is in English, so they need notes that explain in their language and keep the English terms.

## What it does
- Upload a lecture PDF or paste text.
- NoteSketch rewrites it as **visual study notes**: every concept gets a one-line idea, a **worked example with real values**, a **table** (timelines, comparisons) and/or a **diagram**, plus "remember" chips for exam traps.
- **Notes in 5 languages**: English, Tamil, Hindi, Telugu, Malayalam. Technical terms stay in English in brackets, e.g. *பரிவர்த்தனை (Transaction)*, so the notes still match the English exam paper.
- **Ask a doubt** under any section: the AI gets that section and your question, and replies in under 50 words with a tiny worked example, in your chosen language. The answer stays on the card and in the export.
- **Flashcards** made from key terms and quiz questions: flip, then "Got it" or "Again". "Again" cards come back three cards later; a card is mastered after three "Got it"s (Leitner boxes). Progress is saved on your device.
- Key terms, a **clickable quiz**, export to **Markdown** (diagrams included) or **PDF**.
- Dark mode, mobile layout, a loading skeleton with live progress and Cancel.
- No account and no server: a free Gemini key is used straight from your browser. A built-in example works with no key.

## How I built it
- Plain HTML, CSS and JavaScript: no framework, no build step, hosted on GitHub Pages.
- **pdf.js** extracts text from PDFs in the browser.
- **Google Gemini** in JSON mode with strict prompts: example-first, at most 25 words per field, tables for anything that changes over time, Mermaid for flows, and a language rule that keeps technical terms in English.
- A **repair layer** (`normalizeNotes`, `normalizeDoubt`) fixes whatever the AI returns: missing fields, broken tables, code fences, invalid diagrams, out-of-range quiz answers. Bad diagrams fall back to a readable outline.
- All logic that can be pure lives in `js/core.js` (prompts, JSON repair, languages, flashcard scheduling, Markdown export) and is covered by **15 unit tests** (`node --test`).
- Robust API calls: one retry when Gemini is overloaded (5xx), automatic fallback to other current Flash models when one is busy or retired, and clear messages for a bad key, used-up quota, blocked or cut-off replies.

## How AI is used (meaningful use)
Gemini does the core work: it reads an unstructured lecture and produces structured teaching material (examples with real values, tables, diagrams, quiz) in the student's language. It is also an on-demand tutor for doubts, grounded in the section the student is reading. The app never shows raw AI text: everything goes through a typed JSON shape and a repair layer first.

## Built during the event vs. before
Everything in this repository was built Nov 11–12, 2026, with the language, Ask-a-doubt, flashcards and polish features added Nov 13, 2026. No pre-existing code. Libraries used: pdf.js and Mermaid (from a CDN), Google Gemini API.

## One failure case and how I tested
**Failure case: very long lectures.** A 60+ page PDF is cut to the first 60,000 characters, and on "Deep dive" the reply can hit Gemini's output limit and come back cut off mid-JSON. Before, this showed a raw `SyntaxError`. Now NoteSketch detects it and tells the student to choose "Quick revision" or upload a shorter part, and shows a notice when the lecture was truncated. It does not yet split long lectures into chunks (planned).

Other known limits: scanned PDFs (photos of pages) have no text layer, so they are rejected with a clear message (OCR is planned). The AI can still make mistakes; the footer reminds students to check against the lecture.

**How I tested**
- 15 unit tests (`node --test test/core.test.mjs`): prompt in all 5 languages, JSON extraction from fenced/noisy/broken replies, repair of malformed notes and doubts, flashcard deck building, Leitner scheduling ("Again" re-queues 3 cards later, mastered cards leave the queue), corrupted localStorage.
- In the browser: PDF upload (generated test PDF → text), the built-in example (all 3 Mermaid diagrams render), Ask a doubt and full generation in Tamil with Gemini mocked (checked the language rule reaches the prompt and Tamil Mermaid labels render), error paths (model 404 → fallback model, 429 quota message, Cancel), flashcard progress surviving a page reload, dark mode switching (diagrams re-render dark), and a 375px phone layout with no horizontal scroll.
- A real lecture end-to-end with my own Gemini key.

## Challenges
- Getting the AI to stop writing paragraphs: hard word limits plus a fixed JSON shape.
- AI-generated Mermaid sometimes breaks, so I added label-quoting rules and a graceful fallback.
- Regional languages without losing exam vocabulary: the "English term in brackets" rule.
- Keeping it private and free: no backend at all.

## Accomplishments
- One click turns a 20-page lecture into notes you can revise from in 10 minutes, in your own language.
- Doubts are answered with an example, not another paragraph.
- Anyone can try it instantly with the built-in example.

## What I learned
Prompting for structured output, defending against messy AI output, multilingual prompting, spaced repetition, and rendering diagrams from text.

## What's next
- Split long lectures into chunks and merge the notes.
- OCR for scanned PDFs.
- Share notes with classmates by link.
- Voice read-out of notes in regional languages.

## Built with
javascript, html, css, gemini, google-ai-studio, pdf.js, mermaid, github-pages
