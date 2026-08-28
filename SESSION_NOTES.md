# Session notes — multi-channel listing pipeline (2026-08-27)

Summary of work done building product intake, approval, and per-marketplace export
into the marketplace-reporting app, plus what's still open. Written as a handoff
for picking this back up later.

## Goal

Take products currently sold on Takealot and get them listed on Bob Shop and Amazon
too, without manually re-typing everything into each marketplace's own web form.
Landed on this flow: upload a product once → canonical record in the app → split
into a draft listing per marketplace → review & approve → export a file in that
marketplace's real format → upload it there.

## What's built and working

- **Approval workflow** (`src/handler.js`, `public/`): products get a canonical
  record; each marketplace gets a `listing` row with `approvalStatus`
  (`draft` → `approved` → `exported` → `live`). Nothing exports until approved.
  New "New Product" view in the UI drives intake; "Catalogue" view shows listings
  with Approve / Mark-live buttons and export links.
- **Bob Shop exporter** (`src/adapters/bobshop.js`): builds their real 45-column
  bulk-upload CSV. Verified byte-correct against their own sample template and
  category list (downloaded live from their seller portal). **Not yet confirmed
  against their real importer** — the one live Bob Shop listing created this
  session went through their manual single-item form, not this CSV path.
- **Takealot loadsheet exporter** (`src/adapters/takealot-loadsheet.js`): Takealot
  turned out to need category-specific Excel "loadsheets" (.xlsm), not a flat CSV.
  Built and unit-tested for 3 categories matching our actual product mix: Beauty
  (Wigs), Fashion: Footwear (Sneakers), Non-Perishable (food/sweets). Template
  files live in `data/takealot-loadsheets/`. Known limitation: the library used
  (`exceljs`) drops the template's embedded macros on rewrite — data is correct,
  but Excel may show a harmless format-mismatch warning on open.
- **Dependency swap**: `xlsx` had an unpatched high-severity vuln; replaced with
  `exceljs` (0 vulnerabilities after pinning a transitive `uuid` override in
  `package.json`).

## What's broken / needs redoing

- ~~**Amazon exporter** wrong format~~ — **rebuilt 2026-08-28**, see "Fixed this
  session" below.

## Fixed this session (2026-08-28)

- **Amazon exporter rebuilt** (`src/adapters/amazon-listing-csv.js`): now builds
  the real `shoes.xlsm` category template instead of a generic CSV. Columns are
  found by matching row 5's technical key text (e.g. `item_name[...]#1.value`),
  never by fixed position, since Amazon's column order shifts per category.
  Row 6 (Amazon's own `ABC123` example row) is fully replaced, not left in
  place or skipped over. New route: `GET /api/export/amazon.xlsm?template=shoes`
  (list available templates via `GET /api/amazon-templates`); approving an
  Amazon listing now requires `loadsheetKey` to name a valid template, same
  field Takealot already used for its loadsheet key. New listing fields:
  `gender`, `size`, `countryOfOrigin`, `handlingTimeDays` (no dedicated UI yet —
  set via `PATCH /api/listings/:id`, same as `gtin`/`colorMain` already were).
  Template file: `data/amazon-templates/shoes.xlsm` (gitignored like the
  Takealot loadsheets — download it again from Seller Central on a fresh
  machine).
  - **Not exceljs-based**, unlike the Takealot loadsheet adapter. exceljs's full
    workbook parse hung for 10+ minutes on this file (Amazon's real templates
    carry huge hidden dropdown/validation sheets — thousands of data-validation
    entries across hundreds of columns — that exceljs fully materializes into
    JS objects even though only the "Template" sheet's data actually changes).
    Rebuilt on `fflate` instead: unzips the `.xlsm`, rewrites only the one
    worksheet's XML as text, repacks — every other part of the archive
    (styles, hidden lookup sheets, the embedded VBA macros) passes through
    byte-for-byte untouched. Full build for one row: ~0.66s, vs. exceljs never
    finishing. Verified: generated file's other 43 zip entries are byte-identical
    to the source template; row 6 no longer contains `ABC123`; multi-row export
    correctly adds row 7+ and updates the `<dimension>` tag.
  - **Not yet done**: no real upload through Seller Central's Spreadsheet flow
    has been attempted with the generated file — verified structurally
    (correct columns, correct sheet, byte-identical macros/styles) but not
    confirmed against Amazon's actual importer. Supabase was unreachable this
    session too (same intermittent issue as last time), so this was verified
    by calling `buildAmazonListingBuffer` directly with fabricated data, not
    through a live server + database round trip, same as the original Takealot
    loadsheet verification.

## Discovered, not yet built

- **Takealot Seller API can create/update offers automatically** — but only for
  products already in Takealot's catalogue, matched by real GTIN (manufacturer
  barcode). `Create an Offer` / `Create a Batch` endpoints (batch auto-creates an
  offer for any GTIN that doesn't have one yet). No API exists for creating a
  genuinely new-to-Takealot catalog product — that stays loadsheet-only.
  Confirmed straight from Takealot's own Seller API docs (seller portal → API
  Integrations → Seller API).
- **Centralized stock sync** ("sale on Takealot updates qty everywhere"):
  discussed, not built. `products.warehouseStock` already exists as a field and
  is the natural single source of truth. Per-channel reality:
  - Takealot: fully automatable both ways (sales sync already exists, stock push
    already exists via `updateTakealotOfferStock`, and the new GTIN-based create
    endpoint above would close the loop further).
  - Amazon: buildable, not built (their API supports both sales reads and
    inventory pushes).
  - Bob Shop: hard ceiling — no API at all, so both detecting a sale and pushing
    a stock update there always need a manual step.
  - Whether this runs on a timer or via webhooks matters: polling leaves a window
    where two channels can both sell the last unit. Takealot's API section has a
    Webhooks tab that would close that gap there specifically.

## Environment note

This sandbox's network to the project's Supabase database has been intermittent
all session (worked once, failed on every retry after). The two newer adapters
(Amazon, Takealot loadsheet) were verified by calling the builder functions
directly with fabricated data, not through a live server + database round trip —
worth a real end-to-end test on a machine with reliable Supabase access before
depending on this for real listings.

## Suggested next steps

1. ~~Rebuild the Amazon adapter properly~~ — done 2026-08-28, see above.
2. Generate a corrected Amazon file for the Culture of Brave sneaker and confirm
   it uploads cleanly through Seller Central's "Spreadsheet" flow — structurally
   verified this session, but no real upload attempted yet.
3. Decide whether to extend `src/adapters/takealot.js` with the GTIN-based
   create/update-offer capability now that it's confirmed to exist.
4. Do a real end-to-end test (server + Supabase reachable) of the full
   product → draft → approve → export pipeline for all three marketplaces.
5. If centralized stock sync is worth pursuing, start with Takealot only (has
   the full API loop already) before touching Amazon or Bob Shop.
6. No UI yet for setting per-listing fields that only exist via `PATCH
   /api/listings/:id` today (`gtin`, `colorMain`, and now `gender`, `size`,
   `countryOfOrigin`, `handlingTimeDays`) — Catalogue view only has
   Approve/Mark-live buttons, not field editors.
7. Discussed but not built: duplicate-safeguard checks (reject/warn on a SKU
   already used by another product; for Takealot, warn on a GTIN reused across
   listings; exact-match warning on product creation for identical
   name+description). Amazon/Bob Shop key off SKU (yours to keep unique);
   Takealot keys off GTIN against its whole shared catalogue, not just your
   own listings.
