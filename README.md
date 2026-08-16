# Fiona CAN cook

A mobile-first, installable recipe app that starts **completely empty**. Every recipe is
added in the app, and every recipe has to earn its place: it lands in the **testing kitchen**
first, gets cooked and logged, and only moves into the **cookbook** once it is approved.

Built the same way as Omi's Cookbook — vanilla JS, no build step, no dependencies — but
blank, with a two-stage approval flow and a bright-minimal look.

## The flow

```
  Add recipe  ──▶  TESTING KITCHEN  ──▶  THE COOKBOOK
                    │      ▲                  │
                    │      └──────────────────┘
                    │        send back to testing
                    ▼
              log a cook: ★ rating + notes + photo
```

- **Add** a recipe — it starts in the testing kitchen by default (or straight to the
  cookbook if it is already a known keeper).
- **Log a cook** each time it is made: star rating, notes for next time, optional photo.
  The notes show as the card snippet, so the last verdict is visible at a glance.
- **Photos come from cooking, not from typing the recipe in.** A recipe on trial has no photo
  field — its pictures are the ones attached to each cook, and the most recent stands in as the
  cover. The approval step is where one of them is promoted to the cookbook photo.
- **Approve** when happy. The confirmation shows cooks logged, average rating and total
  time, and offers the test-log photos to pick the cookbook one from (or a fresh upload).
  The full test log carries over to the approved recipe.
- **Send back to testing** any time — nothing is lost.

## Live

**<https://tobiashk-git.github.io/fiona-can-cook/>** — repo `tobiashk-git/fiona-can-cook` (public).

Only the app shell is hosted; recipes never leave the device. To install on an iPhone: open the
link in Safari, then Share → Add to Home Screen. The service worker is network-first for the app
shell, so pushing a change makes it appear on the next reload:

```bash
git add -A && git commit -m "..." && git push
```

Pages rebuilds in about a minute.

## Running it

```bash
python "C:\Users\tobia\Fiona CAN cook\site\devserver.py"
```

Then open <http://127.0.0.1:8142>. The dev server sends no-cache headers so edits show up on
every reload. Any static host works in production.

## Cook mode & servings scaling

**Cook mode** (`#/cook/:id`, "Start cooking" on any recipe with steps) goes full screen: one step
at a time in large type, a progress bar, and the screen held awake via the Wake Lock API,
re-acquired when the app comes back to the foreground. The ingredients are one tap away in a
sheet where each line can be crossed off. Arrow keys and space work on a desktop, Escape leaves.
The last step reads **"Done — log this cook"** and drops straight into the test log, which is the
loop the whole app is built around.

**Servings scaling** is a stepper on the ingredients heading; the stored recipe is never rewritten.
Ingredients are free text, so only a quantity at the *start* of a line is touched — "Salt and
pepper" and "Rice, to serve" are left alone. It understands `2`, `1.5`, `1/2`, `1 1/2`, `½`, `1½`
and ranges like `2-3`, and rounds to what a cook would write:

| | base (serves 2) | serves 6 | serves 1 |
| --- | --- | --- | --- |
| weights round to 5s | `750g potatoes` | `2250g` | `375g` |
| counts never do | `12 anchovies` | `36` | `6` |
| original spacing kept | `200g broccoli` | `600g` | `100g` |
| fractions where they read better | `1 1/2 tsp honey` | `4½ tsp` | `¾ tsp` |
| decimals for kg and litres | `1.5kg pork` | `4.5kg` | `0.75kg` |
| ranges scale both ends | `2-3 garlic cloves` | `6–9` | `1–1½` |

The chosen serving count carries into cook mode. It is per session, not saved.

## Sharing a recipe with someone else

Two people have two separate cookbooks — browser storage never crosses a device. Suggestions
travel as a **link** instead of needing a server or an account:

- **Send this recipe** (on any recipe page) packs the recipe into the URL hash: compact JSON,
  deflated via `CompressionStream`, base64url-encoded. A full recipe with 24 ingredients and
  18 steps comes to about 550 characters, so it survives any messaging app.
- Opening the link shows a read-only preview — "Suggested by …", ingredients, method — and drops
  it into the **testing kitchen** on tap. Cooking, rating and approving then happen on that
  person's own device, which is the point: the cook decides.
- The recipe **id travels with the link**, so re-sending an updated version offers "Update my
  copy" (keeping the recipient's test log, rating and status) rather than silently duplicating.
  "Add as a separate copy" is there when a fork really is wanted.
- Photos are deliberately left out: they keep links short, and in this app photos come from
  cooking rather than from writing the recipe down.

Nothing is uploaded — the recipe lives in the URL itself, so the link works between any two
people with the app, and a mangled or truncated link fails with a plain explanation.

## Backup & restore

`#/backup` (reached from the footer link on the home screen). Everything lives in one browser's
IndexedDB, which "clear site data" wipes without warning — so:

- **Download backup** writes a single self-contained `.json` holding every recipe and every photo
  (photos embedded as base64, so the file runs ~1.37x the size of the photos themselves). It is
  assembled as an array of `Blob` chunks so the whole file is never one giant string in memory.
- **Restore** reads that file back and offers two routes: **merge** (adds what is missing, keeps
  whichever copy of a clashing recipe has the newer `updatedAt`, never deletes) or **replace**
  (wipes local data and restores the backup exactly).
- The home screen nudges when there are changes since the last backup; the date is tracked in
  `localStorage` under `fcc_lastBackup`.

It doubles as the way to move a cookbook **between devices** — browser storage never crosses an
origin or a device, so export on one and restore on the other.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Shell — one `<main id="app">`, everything else is rendered by JS |
| `app.js` | The whole app: data model, router, views, IndexedDB |
| `styles.css` | Bright minimal — white ground, near-black type, cobalt `#2340ff` accent, amber for testing |
| `sw.js` | Service worker — network-first shell, cache-first images |
| `manifest.webmanifest` | Home-screen install metadata |
| `make_icons.py` | Regenerates the app icons (cobalt tile, geometric F) |
| `devserver.py` | Local no-cache dev server |

## Data model

Everything lives in IndexedDB (`fiona-can-cook`), store `recipes`:

```js
{
  id, title,
  status: 'testing' | 'approved',
  category,            // weeknight | batch | entertain | light | sweet | drinks
  time,                // total minutes
  servings,
  story, ingredients[], method[], tags[],
  photos:   [{ src, caption }],          // src is 'idb:<id>' or a relative path
  attempts: [{ id, date, rating, notes, photo }],
  createdAt, updatedAt, approvedAt
}
```

Photo blobs go in the `photos` store and are referenced as `idb:<id>`. Tags are taken from
the ingredients automatically unless typed in by hand.

## Design notes

- **Time first.** Total minutes is the one number on every card — it is the real filter
  when there is no time to cook.
- **Top-anchored sheets.** Log-a-cook, approve, delete all slide down from the top rather
  than up from the bottom, so the panel appears where the eye already is.
- **Icons are inline SVG** with no external fonts or CDN — the app is fully offline-capable.
- **Photos are stored at a 2200px long edge** (~500KB each). The cover renders 720 CSS px wide,
  which is 1440 device px on a high-DPI screen — anything smaller gets upscaled and looks soft,
  and portrait phone photos are the worst case. Roughly 50MB per 100 photos.

## Known limits

- Data is per-device: it lives in this browser's IndexedDB, does not sync, and a browser
  data wipe clears it. Export/backup is not built yet.
- Install-to-home-screen on iPhone needs HTTPS — works from a real host, not from
  `127.0.0.1` on the phone.
