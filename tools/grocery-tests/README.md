# Live Grocery List tests

End-to-end frontend tests: the real SPA is loaded in headless Chromium against an in-memory
mock of the PHP API (`mock-api.js`, which mirrors GroceryRepo / TransactionRepo rules) and is
driven through the DOM.

```bash
tools/grocery-tests/run.sh      # serves the project on 127.0.0.1:8731 and runs the suite
```

Files:

- `mock-api.js` - mock server, installed before the app scripts so `fetch` is already replaced
- `runner.html` - the same script list as `index.html`, plus the mock and the tests
- `tests.js` - the core assertions (page, add, Get Item price dialogue, purchase, undo, submit,
  regression pass over every route); it also runs the suites below
- `tests-phase2.js` - saved grocery lists: saving, table, loading, reusability, deletion
- `tests-clear.js` - Clear Grocery List: confirmation, cancel, clearing both sections, and proof
  that saved lists and expenses survive
- `tests-modals.js` - shared-modal geometry pass (`?only=modals`): every kind of dialog is
  opened and checked for viewport containment, centring, scrolling, reachable buttons,
  layering, focus, Escape and backdrop close
- `tests-budget.js` - Budget save / load / delete, Clear Budget and the Saved Budget Quick
  Preview (`?only=budget`)
- `tests-preview.js` - Saved Grocery List Quick Preview: button placement, no auto-load,
  preview contents, read-only guarantees, Close / Load List
- `tests-rows.js` - Bills/Recurring action-button pass (`?only=rows`): many records with long
  names are rendered and every row action is checked for overflow, clipping and tap size
- `run.sh` - starts `python3 -m http.server`, runs the full suite at 1280x900 and the modal pass
  at 1280x900, 834x1112, 390x844 and 320x568, then the row pass at the same four sizes, prints
  every result, exits non-zero on failure

The real PHP + MySQL layer is NOT exercised by these tests (no PHP in the build environment).
The previous jsdom harness was replaced by this one: the environment has no npm access, so
jsdom cannot be installed, while Chromium is available offline.
