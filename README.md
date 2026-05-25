# Marketplace Reporting System

Expandable reporting foundation for Amazon, Bob Shop, Takealot, and future e-commerce marketplaces.

## What It Does

- Maintains one internal canonical product record.
- Builds internal canonical product records from marketplace API/import data.
- Maps many marketplace identifiers to that product, such as Amazon ASINs, Bob Shop listing IDs, Takealot TSINs, seller SKUs, and future identifiers.
- Tracks suppliers and product costs.
- Tracks imported marketplace fee amounts when the marketplace API/report provides them.
- Imports marketplace sales transactions from connected APIs/reports.
- Produces one product summary report across marketplaces.

## Run It

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

The app stores local data in `data/db.json`. The file is created automatically on first run with sample data.

## Configure Takealot API

Create a local `.env` file from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Then set:

```text
TAKEALOT_API_KEY=your-takealot-api-key
TAKEALOT_API_BASE_URL=https://seller-api.takealot.com/v2
TAKEALOT_SYNC_START_DATE=2018-01-01
```

Restart the app after changing `.env`.

In the app, open `Integrations`, then use:

- `Test Connection` to confirm the key works.
- `Sync API Data` to import Takealot offers/listings and sales into canonical products, Takealot mappings, and report transactions. If no date range is selected, sync starts at `TAKEALOT_SYNC_START_DATE` and runs through today in yearly chunks.

## Core Data Model

- `products`: the internal product master record used for reporting, created from API/import data rather than manual entry.
- `listings`: marketplace-specific product records that point back to one internal product.
- `suppliers`: supplier records assigned to internal products.
- `fees`: reserved for imported marketplace fee records once a marketplace provides fee/settlement data.
- `transactions`: sales rows imported from a marketplace or entered manually.

This lets one product report include different identifiers from each marketplace:

```text
Internal Product
  Amazon: ASIN / Seller SKU / FNSKU
  Bob Shop: Listing ID / SKU / Product code
  Takealot: TSIN / Offer ID / SKU
```

## Integration Approach

The current version is intentionally adapter-ready. Marketplace capability metadata lives in `src/adapters/marketplaces.js`, and the API/reporting logic treats marketplace records generically. That means a new marketplace can be added by registering its identifier types and implementing import/sync code that writes into `products`, `listings`, `fees`, and `transactions`.

Suggested next connector order:

1. Takealot Seller API offer and sales sync.
2. CSV/export import for Bob Shop and Takealot finance/fee reports.
3. Amazon SP-API authentication and report downloads.
4. Automated scheduled sync jobs.
5. Database migration from JSON to PostgreSQL or SQLite once the reporting rules stabilize.

## Current Marketplace Notes

- Amazon: current official documentation points sellers to Amazon Selling Partner API (SP-API), including Reports API, Finances, Listings Items, and Catalog Items for product, payment, and reporting data.
- Takealot: the Seller API connector uses `Authorization: Key <api-key>` against `https://seller-api.takealot.com/v2`. API sync populates product/listing fields and recent sales from Takealot automatically. Supplier assignment and unit product cost remain local fields unless a supplier/cost API source is added. The current Takealot Seller API docs expose sales/order/invoice document endpoints, but not seller commission or fee amount fields in the synced sales data, so fees remain zero until a real fee/settlement API or export is connected.
- Bob Shop: this project keeps the connector pluggable because account-specific API access and seller export formats are the practical integration details to confirm before hard-coding endpoints.

References checked on 2026-05-04:

- Amazon SP-API docs: https://developer-docs.amazon.com/sp-api/
- AWS guide to SP-API report/data availability: https://docs.aws.amazon.com/prescriptive-guidance/latest/strategy-gen-ai-selling-partner-api/data-sp-api.html
- Amazon FBA Reports docs: https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba/
- Takealot Seller API docs URL: https://seller-api.takealot.com/api-docs/#/
