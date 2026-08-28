# Marketplace Reporting System

Multi-marketplace sales reporting for Takealot, Amazon, and Bob Shop.

## Stack

- Node.js (ESM, >= 20), plain Express server — not Next.js
- Local JSON data store: `data/db.json` (auto-created on first run)
- Vercel deployed
- Supabase SDK present but not yet wired as primary store

## Run

```powershell
npm run dev
```

Opens at `http://localhost:3000`. Data persists in `data/db.json`.

## Key files

- `src/server.js` — entry point
- `src/handler.js` — route handlers
- `src/db.js` — JSON data access layer
- `src/store.js` — data persistence
- `src/reporting.js` — report generation logic
- `src/adapters/marketplaces.js` — marketplace capability metadata
- `src/adapters/takealot.js` — Takealot Seller API connector
- `src/adapters/amazon.js` — Amazon SP-API stub

## Data model

```
products       internal canonical product record
listings       marketplace-specific records pointing to one product
suppliers      assigned to products
fees           imported marketplace fee records (reserved)
transactions   sales rows from marketplace or manual entry
```

Each product maps multiple marketplace identifiers:
- Amazon: ASIN / Seller SKU / FNSKU
- Bob Shop: Listing ID / SKU / Product code
- Takealot: TSIN / Offer ID / SKU

## New product intake & listing approval

`POST /api/products` accepts an optional `marketplaces: [{marketplaceId, category, price?, qty?}]`
array — when present, it creates the product and one draft `listing` per selected marketplace in
the same call. Products also carry `description`, `condition`, `price`, `images[]`, `weightKg`.

Listings carry an `approvalStatus`: `draft` (new, not yet reviewed) -> `approved` (ready to
publish) -> `exported` (file generated, awaiting manual upload confirmation) -> `live`. Nothing is
exported until a listing is explicitly approved (`POST /api/listings/:id/approve`, requires
`category` to be set). `POST /api/listings/:id/unapprove` reverts to draft;
`POST /api/listings/:id/mark-live` confirms a manual upload went live. `PATCH /api/listings/:id`
edits marketplace-specific fields (category, price, qty, description, images, etc).

Listings without `approvalStatus` (pre-existing/synced ones) are treated as already-live and are
unaffected by this workflow.

The "New Product" view in the UI drives this: fill in the canonical fields once, tick which
marketplaces to list on, add each marketplace's category, submit. Review/approve happens in the
Catalogue view's "Marketplace Mappings" list.

## Bob Shop export

Bob Shop has no listing-creation API — only a 45-column bulk CSV import (My Account > Selling >
"Import products (CSV)"). `GET /api/export/bobshop.csv` builds that file from every listing where
`marketplaceId === "bob-shop"` and `approvalStatus === "approved"`, marks them `exported`, and
streams the CSV for download. Column layout lives in `src/adapters/bobshop.js`
(`BOBSHOP_CSV_HEADER`, `buildBobshopCsv`) — it mirrors Bob Shop's own sample template exactly, so
if they change the template, update the header array and column-index mapping there. Category IDs
are Bob Shop's own numeric taxonomy (looked up per-listing on their "Categories for bulk loading"
page) — there's no lookup table in code, the category value is typed in per listing.

## Amazon export

`GET /api/export/amazon.csv` works the same way for `marketplaceId === "amazon"`, built by
`src/adapters/amazon-listing-csv.js`. **This one is best-effort** — Amazon's real "Add Products via
Upload" templates are category-specific and can only be fetched from a logged-in Seller Central
account, which this project has no credentials for. The column set here is the stable subset that
holds across most category templates (sku, price, quantity, title, description, bullet points,
condition, brand, image, category). Verify against your actual downloaded Amazon template before a
real upload, and extend the header/row mapping if categories need more fields (Amazon flat files
often want variant theme, size/color attributes, safety data, etc. per category).

## Takealot export

Takealot has no flat CSV either — new products go in via category-specific Excel "loadsheets"
(seller portal: My Existing Offers > New Offers > Add to Takealot's Catalogue > Add Products in
Bulk), uploaded as `.xlsm` for review. Each category group (Beauty, Fashion: Footwear, Consumables:
Non-Perishable, etc.) has its own template with its own extra attribute columns, but the first 14
columns are identical across every template checked so far (SKU, TopCategory, Category, barcode,
title, subtitle, description, Brand, what's in the box, colour) — that's what
`src/adapters/takealot-loadsheet.js` fills, via `exceljs`, starting at row 7 of the "Loadsheet" tab.
Category-specific attribute columns (materials, shoe width, coffee type, SPF, etc.) are left blank;
they're optional per Takealot's own instructions.

Template files live in `data/takealot-loadsheets/` (`beauty.xlsm`, `fashion-footwear.xlsm`,
`non-perishable.xlsm` — downloaded from the seller portal, registered in
`TAKEALOT_LOADSHEETS` in the adapter). `GET /api/takealot-loadsheets` lists the available keys;
`GET /api/export/takealot.xlsm?loadsheet=<key>` builds one file from approved listings whose
`loadsheetKey` matches, marks them `exported`.

Takealot listings need three extra fields beyond `category` before they can be approved:
`topCategory` (e.g. `"Hair Care (30186)"`), `category` (e.g. `"Wigs (30961)"` — get both from that
template's own "Category Tree Lookup" sheet), and `loadsheetKey` (which template file to use). The
approve endpoint rejects Takealot listings missing any of these.

**Known limitation**: `exceljs` does not preserve the template's embedded VBA macros
(`vbaProject.bin`) when it rewrites the file, so the generated `.xlsm` may prompt a
format/extension mismatch warning when opened in Excel. The data itself is unaffected — the macros
were data-entry aids (dropdowns, helpers) for manual filling, not required by Takealot's import
parser. To add a new category, download its loadsheet from the seller portal, confirm its first 14
columns match this same order, add it to `data/takealot-loadsheets/` and register it in
`TAKEALOT_LOADSHEETS` with the `topCategory`/`category` values from its own lookup sheet.

## Takealot API

Requires `.env`:

```
TAKEALOT_API_KEY=
TAKEALOT_API_BASE_URL=https://seller-api.takealot.com/v2
TAKEALOT_SYNC_START_DATE=2018-01-01
```

Auth: `Authorization: Key <api-key>`. Sync pulls offers/listings and sales in yearly chunks from `TAKEALOT_SYNC_START_DATE` through today.

## Adding a marketplace

Register identifier types in `src/adapters/marketplaces.js`, implement sync/import writing into `products`, `listings`, `fees`, and `transactions`.
