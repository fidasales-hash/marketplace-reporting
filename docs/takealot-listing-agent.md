# Takealot Listing Agent Gateway

The gateway is a separate, authenticated endpoint. It does not change the existing dashboard routes.

## Vercel environment variables

Keep the existing `TAKEALOT_API_KEY` configured. Add a separate high-entropy `TAKEALOT_AGENT_TOKEN` in Vercel Project Settings → Environment Variables, for Production and Preview as appropriate. Do not use the Takealot API key as this token.

## Endpoint

`POST /api/agent/takealot/offer`

Header: `Authorization: Bearer <TAKEALOT_AGENT_TOKEN>`

The request must include `approved: true`. The endpoint creates a seller offer for an **existing Takealot catalogue barcode**; it does not create a new catalogue product. Required fields: barcode, sku, sellingPrice (whole ZAR), rrp (whole ZAR), leadtimeDays, warehouseId (merchant warehouse ID from the seller account), quantity.

OpenAPI contract: `openapi/takealot-listing-agent.yaml`

## Safety

- The endpoint is protected by a separate bearer token, compared in constant time.
- It only accepts POST.
- Offer creation requires explicit `approved: true`.
- No deployment or product submission is performed by this change.
