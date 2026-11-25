# Elo Ranker

Rank YouTube videos or images by picking the better of two at a time.

Live: https://faradayj.github.io/elo-ranker/

## Run

It needs a local server:

    python -m http.server

Then open http://localhost:8000.

## Test

    node --test list.test.js rating.test.js

## Files

- `index.html`: the page and its styles
- `app.js`: the app
- `list.js`: link parsing and saved lists
- `rating.js`: Elo ratings and tiers
