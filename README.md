# MyAnki

A Bun + Astro + Tailwind frontend for browsing and editing your Anki collection through AnkiConnect.

## Features

- deck tree on the left
- nested tag tree on the left
- card grid for browsing cards
- filter bar powered by Anki browser queries
- field editing for the selected note
- tag editing
- deck moving for the selected card
- suspend / unsuspend / delete actions
- raw AnkiConnect action console for anything not covered by the UI

## Stack

- Bun
- Astro
- React inside Astro
- Tailwind CSS
- Inter font

## Getting started

1. Make sure Anki is running.
2. Install the AnkiConnect add-on in Anki.
3. Install dependencies:

```bash
bun install
```

4. Start the app:

```bash
bun run dev
```

5. Open the app in your browser. The default AnkiConnect endpoint is:

```text
http://127.0.0.1:8765
```

## Notes

- The filter bar combines your raw Anki browser query with deck, tag, note type, and state selections.
- The raw action panel lets you call any AnkiConnect action with JSON parameters.
- This app is focused on viewing and editing, not study/review.
