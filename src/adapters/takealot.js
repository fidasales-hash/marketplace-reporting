import { makeId } from "../store.js";

const PAGE_SIZE = 100;

export function isTakealotConfigured(config) {
  return Boolean(config.takealot.apiKey);
}

export async function testTakealotConnection(config) {
  const response = await takealotRequest(config, "/offers?page_size=1&page_number=1");
  const payload = await response.json();
  return {
    ok: response.ok,
    status: response.status,
    offerCount: Array.isArray(payload.offers) ? payload.offers.length : 0,
    message: response.ok ? "Takealot API connection succeeded." : payload.message ?? "Takealot API connection failed."
  };
}

export async function syncTakealotOffers(config, data) {
  if (!isTakealotConfigured(config)) return missingConfigResult();
  const offers = await fetchAllOffers(config);
  const result = importOffers(data, offers);
  return {
    ok: true,
    status: 200,
    message: `Synced ${offers.length} Takealot offers.`,
    ...result
  };
}

export async function syncTakealotApiData(config, data, options = {}) {
  if (!isTakealotConfigured(config)) return missingConfigResult();

  const offers = await fetchAllOffers(config);
  const offerResult = importOffers(data, offers);
  const dateRange = resolveSyncDateRange(config, options);
  const sales = await fetchSalesInChunks(config, dateRange.from, dateRange.to);
  const saleResult = importSales(data, sales);

  return {
    ok: true,
    status: 200,
    message: `Synced ${offers.length} offers and ${sales.length} sales from Takealot.`,
    salesDateRange: {
      from: dateRange.from,
      to: dateRange.to
    },
    offers: offerResult,
    sales: saleResult
  };
}

function importOffers(data, offers) {
  let imported = 0;
  let updated = 0;

  for (const offer of offers) {
    const normalized = normalizeOffer(offer);
    if (!normalized.identifier) continue;

    const existingListing = findTakealotListing(data, normalized.identifier, normalized.offerId, normalized.sku);
    if (existingListing) {
      const product = data.products.find((item) => item.id === existingListing.productId);
      if (product) applyApiProductFields(product, normalized);
      applyApiListingFields(existingListing, normalized);
      updated += 1;
      continue;
    }

    const existingSkuProduct = normalized.sku
      ? data.products.find((product) => product.sku === normalized.sku)
      : null;

    if (existingSkuProduct) {
      applyApiProductFields(existingSkuProduct, normalized);
      data.listings.push(buildListing(existingSkuProduct.id, normalized));
      imported += 1;
      continue;
    }

    const product = buildProduct(normalized);
    const listing = buildListing(product.id, normalized);
    data.products.push(product);
    data.listings.push(listing);
    imported += 1;
  }

  return { imported, updated };
}

function importSales(data, sales) {
  let imported = 0;
  let updated = 0;

  for (const sale of sales) {
    const normalized = normalizeSale(sale);
    if (!normalized.transactionKey) continue;

    let listing = findTakealotListing(data, normalized.identifier, normalized.offerId, normalized.sku);
    if (!listing) {
      const product = buildProduct({
        title: normalized.title || `Takealot product ${normalized.identifier || normalized.offerId}`,
        sku: normalized.sku,
        identifier: normalized.identifier || normalized.offerId,
        identifierType: normalized.identifier ? "TSIN" : "Offer ID",
        active: true,
        raw: {}
      });
      listing = buildListing(product.id, {
        title: normalized.title,
        sku: normalized.sku,
        identifier: normalized.identifier || normalized.offerId,
        identifierType: normalized.identifier ? "TSIN" : "Offer ID",
        active: true,
        raw: {}
      });
      data.products.push(product);
      data.listings.push(listing);
    }

    const transactionFields = buildTransaction(listing.id, normalized);
    const existing = data.transactions.find((transaction) => transaction.externalId === normalized.transactionKey);
    if (existing) {
      Object.assign(existing, transactionFields);
      updated += 1;
      continue;
    }

    data.transactions.push({ id: makeId("txn"), ...transactionFields });
    imported += 1;
  }

  return { imported, updated };
}

async function fetchAllOffers(config) {
  const offers = [];
  const seen = new Set();
  let page = 1;
  let keepGoing = true;

  while (keepGoing) {
    const response = await takealotRequest(config, `/offers?page_size=${PAGE_SIZE}&page_number=${page}`);
    const payload = await response.json();

    if (!response.ok) {
      if (offers.length > 0 && String(payload.message ?? "").toLowerCase().includes("page number cannot exceed")) break;
      throw new Error(payload.message ?? `Takealot API failed with status ${response.status}`);
    }

    const batch = Array.isArray(payload.offers) ? payload.offers : [];
    let newInBatch = 0;
    for (const offer of batch) {
      const key = offerIdentityKey(offer);
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push(offer);
      newInBatch += 1;
    }
    if (batch.length > 0 && newInBatch === 0) break;
    const total = Number(payload.total_results);
    keepGoing = total ? offers.length < total : batch.length === PAGE_SIZE;
    page += 1;
  }

  return offers;
}

function offerIdentityKey(offer) {
  return String(firstValue(offer, ["offer_id", "tsin_id", "sku", "product_label_number", "barcode"]));
}

async function fetchSalesInChunks(config, startDate, endDate) {
  const ranges = splitDateRangeByMonth(startDate, endDate);
  const allSales = [];
  const seen = new Set();

  for (const range of ranges) {
    const sales = await fetchSales(config, range.from, range.to);
    for (const sale of sales) {
      const key = firstValue(sale, ["order_item_id"]) || `${firstValue(sale, ["order_id"])}:${firstValue(sale, ["offer_id"])}:${firstValue(sale, ["order_date"])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allSales.push(sale);
    }
  }

  return allSales;
}

async function fetchSales(config, startDate, endDate) {
  const sales = [];
  let page = 1;
  let keepGoing = true;

  while (keepGoing) {
    const query = `page_size=${PAGE_SIZE}&page_number=${page}&filters=start_date:${startDate};end_date:${endDate}`;
    const response = await takealotRequest(config, `/sales?${query}`);
    const payload = await response.json();

    if (!response.ok) {
      if (sales.length > 0 && String(payload.message ?? "").toLowerCase().includes("page number cannot exceed")) break;
      throw new Error(payload.message ?? `Takealot sales API failed with status ${response.status}`);
    }

    const batch = Array.isArray(payload.sales) ? payload.sales : [];
    sales.push(...batch);
    const total = Number(payload.page_summary?.total);
    keepGoing = total ? sales.length < total : batch.length === PAGE_SIZE;
    page += 1;
  }

  return sales;
}

async function takealotRequest(config, pathname) {
  const base = config.takealot.baseUrl.replace(/\/$/, "");
  return fetch(`${base}${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Key ${config.takealot.apiKey}`
    }
  });
}

function normalizeOffer(offer) {
  const identifier = firstValue(offer, ["tsin_id", "tsin", "offer_id", "id"]);
  const offerId = firstValue(offer, ["offer_id"]);
  const sku = firstValue(offer, ["sku", "seller_sku", "merchant_sku", "barcode"]);
  const title = firstValue(offer, ["title", "product_title", "name", "description"]);

  return {
    identifier: identifier ? String(identifier) : "",
    offerId: offerId ? String(offerId) : "",
    identifierType: offer.tsin_id || offer.tsin ? "TSIN" : offer.offer_id ? "Offer ID" : "Takealot ID",
    sku: sku ? String(sku) : "",
    title: title ? String(title) : "",
    active: inferActive(offer),
    raw: {
      offerId: offer.offer_id ?? null,
      barcode: offer.barcode ?? "",
      productLabelNumber: offer.product_label_number ?? "",
      sellingPrice: offer.selling_price ?? null,
      rrp: offer.rrp ?? null,
      leadtimeDays: offer.leadtime_days ?? null,
      status: offer.status ?? "",
      offerUrl: offer.offer_url ?? "",
      stockAtTakealotTotal: offer.stock_at_takealot_total ?? null,
      totalStockOnWay: offer.total_stock_on_way ?? null,
      totalStockCover: offer.total_stock_cover ?? null,
      catalogueQualityScore: offer.catalogue_quality_score ?? null,
      storageFeeEligible: offer.storage_fee_eligible ?? null,
      discount: offer.discount ?? "",
      dateCreated: offer.date_created ?? "",
      stockAtTakealot: offer.stock_at_takealot ?? [],
      stockOnWay: offer.stock_on_way ?? [],
      leadtimeStock: offer.leadtime_stock ?? [],
      stockCover: offer.stock_cover ?? [],
      salesUnits: offer.sales_units ?? []
    }
  };
}

function normalizeSale(sale) {
  const identifier = firstValue(sale, ["tsin", "tsin_id"]);
  const offerId = firstValue(sale, ["offer_id"]);
  const sku = firstValue(sale, ["sku"]);
  const quantity = Number(sale.quantity) || 0;
  const sellingPrice = Number(sale.selling_price) || 0;
  const orderItemId = firstValue(sale, ["order_item_id"]);
  const orderId = firstValue(sale, ["order_id"]);

  return {
    transactionKey: orderItemId ? `takealot:${orderItemId}` : orderId && offerId ? `takealot:${orderId}:${offerId}` : "",
    identifier: identifier ? String(identifier) : "",
    offerId: offerId ? String(offerId) : "",
    sku: sku ? String(sku) : "",
    title: firstValue(sale, ["product_title", "title"]) || "",
    date: toDateInput(new Date(firstValue(sale, ["order_date"]) || Date.now())),
    quantity,
    grossSales: sellingPrice * Math.max(quantity, 1),
    marketplaceFees: Number(sale.total_fee) || 0,
    saleStatus: sale.sale_status ?? "",
    raw: {
      orderId,
      orderItemId,
      sellingPrice,
      successFee: sale.success_fee ?? 0,
      fulfillmentFee: sale.fulfillment_fee ?? 0,
      courierCollectionFee: sale.courier_collection_fee ?? 0,
      totalFee: sale.total_fee ?? 0,
      stockTransferFee: sale.stock_transfer_fee ?? 0,
      customer: sale.customer ?? "",
      saleStatus: sale.sale_status ?? null,
      promotion: sale.promotion ?? null,
      dc: sale.dc ?? "",
      customerDc: sale.customer_dc ?? "",
      stockSourceRegion: sale.stock_source_region ?? ""
    }
  };
}

function buildProduct(normalized) {
  return {
    id: makeId("prd"),
    name: normalized.title || `Takealot product ${normalized.identifier}`,
    sku: normalized.sku || `TAKEALOT-${normalized.identifier}`,
    supplierId: null,
    cost: 0,
    currency: "ZAR",
    source: "takealot-api"
  };
}

function buildListing(productId, normalized) {
  return {
    id: makeId("lst"),
    productId,
    marketplaceId: "takealot",
    marketplaceIdentifier: normalized.identifier,
    identifierType: normalized.identifierType,
    marketplaceSku: normalized.sku,
    title: normalized.title,
    active: normalized.active,
    source: "takealot-api",
    apiData: normalized.raw ?? {}
  };
}

function applyApiProductFields(product, normalized) {
  product.name = normalized.title || product.name;
  product.sku = normalized.sku || product.sku;
  product.currency = product.currency || "ZAR";
  product.source = product.source || "takealot-api";
}

function applyApiListingFields(listing, normalized) {
  listing.identifierType = normalized.identifierType;
  listing.marketplaceSku = normalized.sku;
  listing.title = normalized.title;
  listing.active = normalized.active;
  listing.source = listing.source || "takealot-api";
  listing.apiData = normalized.raw ?? {};
}

function buildTransaction(listingId, normalized) {
  return {
    listingId,
    externalId: normalized.transactionKey,
    source: "takealot-api",
    date: normalized.date,
    quantity: normalized.quantity,
    grossSales: normalized.grossSales,
    marketplaceFees: normalized.marketplaceFees,
    saleStatus: normalized.saleStatus,
    currency: "ZAR",
    apiData: normalized.raw
  };
}

function findTakealotListing(data, identifier, offerId, sku) {
  return data.listings.find((listing) => (
    listing.marketplaceId === "takealot" &&
    (
      (identifier && listing.marketplaceIdentifier === identifier) ||
      (offerId && String(listing.apiData?.offerId ?? "") === offerId) ||
      (sku && listing.marketplaceSku === sku)
    )
  ));
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return "";
}

function inferActive(offer) {
  const status = String(firstValue(offer, ["status", "offer_status", "state"])).toLowerCase();
  if (!status) return true;
  return !["inactive", "disabled", "archived", "deleted", "suspended"].includes(status);
}

function missingConfigResult() {
  return {
    ok: false,
    status: 400,
    message: "TAKEALOT_API_KEY is not configured.",
    imported: 0,
    updated: 0
  };
}

function resolveSyncDateRange(config, options = {}) {
  const today = toDateInput(new Date());
  return {
    from: options.from || config.takealot.syncStartDate || "2018-01-01",
    to: options.to || today
  };
}

function splitDateRangeByMonth(startDate, endDate) {
  const ranges = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const rangeEnd = monthEnd < end ? monthEnd : end;
    ranges.push({
      from: toDateInput(cursor),
      to: toDateInput(rangeEnd)
    });
    cursor = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth() + 1, 1));
  }

  return ranges;
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}
