# GCSE PDF Question Player (No‑AI)

A static web prototype that lets you:

- Upload a PDF similar to Edexcel/PMT-style practice packs.
- Split **Questions** vs **Mark Scheme** by detecting the first “Mark Scheme” heading.
- Split into individual **Q1..Qn** via “Q\d+.” headings.
- Render **one question at a time** with all original images/tables (via PDF.js canvas).
- Overlay **interactive inputs**:
  - Text boxes (type over the lines)
  - Checkbox group (for A/B/C/D)
  - Match anchors: click two anchors to draw a connecting line
- **Mark** a question without AI:
  - Multiple choice: compares selected option to a parsed “Correct answer: D” in the mark scheme (if present).
  - Text answers: naive keyword matching based on mark-scheme bullet lines (if present).
  - Manual override included.

> No AI models are used. All logic is deterministic heuristics plus your manual overrides.

## How to run

1. Serve these files with any static server (e.g., `python -m http.server`), or just open `index.html` directly in a modern browser.
2. Click **Load PDF**, choose your exam PDF.
3. Use the **Questions** list or **Prev/Next** to navigate.
4. Use **Tools** to place text/checkbox/match anchors.
5. Click **Mark This Question** to see auto-marks and override manually.

## Notes & Limitations

- Works best on *text-based* PDFs. For scanned PDFs, apply OCR first.
- Heuristics assume questions are headed by `Q1.`, `Q2.` etc, and that “Mark Scheme” appears once.
- If the mark scheme pages are images, auto-parsed bullets won’t appear (use manual marks).
- The coordinate mapping from text-extraction to canvas is approximate. It’s sufficient to define page ranges per question and render pages accurately; the “yellow highlight” is a visual hint only.
- Matching (“connect the pair”) is a visual assist; correctness still needs a mapping from the mark scheme (not auto-parsed here).

## Extend

- Add tolerance-based numeric marking by parsing numbers like “0.63 s (±0.01)”. 
- Extract A/B/C/D blocks from the question pages (instead of relying on mark scheme) by scanning page text near the question heading.
- Persist answers per user using localStorage/IndexedDB or a lightweight backend.
- Improve question boundary detection using “Total for question = N marks” as end marker.
