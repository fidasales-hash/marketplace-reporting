import { syncAmazonApiData, syncAmazonFinanceData, syncAmazonReportsData, testAmazonConnection } from "./adapters/amazon.js";
import { marketplaces } from "./adapters/marketplaces.js";
import { testTakealotConnection, syncTakealotApiData, syncTakealotOffers, updateTakealotOfferStock, isTakealotConfigured } from "./adapters/takealot.js";
import { getConfig, loadEnv } from "./config.js";
import { buildMarketplaceSummary, buildProductSummary, buildSupplierMarketplaceSummary, buildSupplierSummary } from "./reporting.js";
import { makeId, readStore, writeStore } from "./db.js";

await loadEnv();
const config = getConfig();

export async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const data = await readStore();
    sendJson(res, 200, {
      marketplaces,
      integrations: {
        takealot: {
          configured: Boolean(config.takealot.apiKey),
          baseUrl: config.takealot.baseUrl,
          lastSynced: data.syncedAt?.takealot ?? null
        },
        amazon: {
          configured: Boolean(config.amazon.refreshToken && config.amazon.clientId && config.amazon.clientSecret && config.amazon.marketplaceId),
          hasRefreshToken: Boolean(config.amazon.refreshToken),
          hasClientId: Boolean(config.amazon.clientId),
          hasClientSecret: Boolean(config.amazon.clientSecret),
          hasMarketplaceId: Boolean(config.amazon.marketplaceId),
          baseUrl: config.amazon.baseUrl,
          region: config.amazon.region,
          lastSynced: data.syncedAt?.amazon ?? null
        }
      },
      ...data
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/takealot/test") {
    sendJson(res, 200, await testTakealotConnection(config));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integrations/amazon/test") {
    const result = await testAmazonConnection(config);
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/amazon/sync") {
    const data = await readStore();
    const result = await syncAmazonApiData(config, data, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to")
    });
    if (result.ok) {
      data.syncedAt = { ...data.syncedAt, amazon: new Date().toISOString() };
      await writeStore(data);
    }
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/amazon/backfill") {
    const data = await readStore();
    const result = await syncAmazonReportsData(config, data, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to")
    });
    if (result.ok) await writeStore(data);
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/amazon/fees") {
    const data = await readStore();
    const result = await syncAmazonFinanceData(config, data, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to")
    });
    if (result.ok) await writeStore(data);
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/takealot/sync-offers") {
    const data = await readStore();
    const result = await syncTakealotOffers(config, data);
    if (result.ok) await writeStore(data);
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/integrations/takealot/sync") {
    const data = await readStore();
    const result = await syncTakealotApiData(config, data, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to")
    });
    if (result.ok) {
      data.syncedAt = { ...data.syncedAt, takealot: new Date().toISOString() };
      await writeStore(data);
    }
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stock/takealot") {
    const body = await readJson(req);
    const listingId = String(body.listingId ?? "");
    const quantity = Number(body.quantity);
    if (!listingId || isNaN(quantity) || quantity < 0) {
      sendJson(res, 400, { error: "listingId and a non-negative quantity are required." });
      return;
    }
    const data = await readStore();
    const listing = data.listings.find((item) => item.id === listingId);
    if (!listing) {
      sendJson(res, 404, { error: "Listing not found." });
      return;
    }
    const offerId = listing.apiData?.offerId;
    if (!offerId) {
      sendJson(res, 400, { error: "No Takealot offer ID for this listing. Sync offers first." });
      return;
    }
    const result = await updateTakealotOfferStock(config, offerId, quantity);
    if (result.ok) {
      listing.apiData = { ...listing.apiData, stockAtTakealotTotal: quantity };
      await writeStore(data);
    }
    sendJson(res, result.status, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports/products") {
    const data = await readStore();
    const filters = Object.fromEntries(url.searchParams.entries());
    sendJson(res, 200, buildProductSummary(data, filters));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports/suppliers") {
    const data = await readStore();
    const filters = Object.fromEntries(url.searchParams.entries());
    sendJson(res, 200, buildSupplierSummary(data, filters));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports/marketplaces") {
    const data = await readStore();
    const filters = Object.fromEntries(url.searchParams.entries());
    sendJson(res, 200, buildMarketplaceSummary(data, filters));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports/supplier-marketplaces") {
    const data = await readStore();
    const filters = Object.fromEntries(url.searchParams.entries());
    sendJson(res, 200, buildSupplierMarketplaceSummary(data, filters));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/suppliers") {
    const body = await readJson(req);
    const name = String(body.name ?? "").trim();
    if (!name) {
      sendJson(res, 400, { error: "Supplier name is required." });
      return;
    }
    const data = await readStore();
    const supplier = { id: makeId("sup"), name, contact: "" };
    data.suppliers.push(supplier);
    await writeStore(data);
    sendJson(res, 201, supplier);
    return;
  }

  const supplierMatch = url.pathname.match(/^\/api\/suppliers\/([^/]+)$/);
  if (supplierMatch && req.method === "PATCH") {
    const body = await readJson(req);
    const name = String(body.name ?? "").trim();
    if (!name) {
      sendJson(res, 400, { error: "Supplier name is required." });
      return;
    }

    const data = await readStore();
    const supplier = data.suppliers.find((item) => item.id === supplierMatch[1]);
    if (!supplier) {
      sendJson(res, 404, { error: "Supplier not found." });
      return;
    }

    supplier.name = name;
    supplier.contact = "";
    await writeStore(data);
    sendJson(res, 200, supplier);
    return;
  }

  if (supplierMatch && req.method === "DELETE") {
    const data = await readStore();
    const supplierIndex = data.suppliers.findIndex((item) => item.id === supplierMatch[1]);
    if (supplierIndex === -1) {
      sendJson(res, 404, { error: "Supplier not found." });
      return;
    }

    data.suppliers.splice(supplierIndex, 1);
    for (const product of data.products) {
      if (product.supplierId === supplierMatch[1]) product.supplierId = null;
    }
    await writeStore(data);
    sendJson(res, 200, { deleted: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/products") {
    const body = await readJson(req);
    const data = await readStore();
    const product = {
      id: makeId("prd"),
      name: body.name,
      sku: body.sku,
      supplierId: body.supplierId || null,
      cost: Number(body.cost) || 0,
      currency: body.currency || "ZAR"
    };
    data.products.push(product);
    await writeStore(data);
    sendJson(res, 201, product);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/products/merge") {
    const body = await readJson(req);
    const targetProductId = String(body.targetProductId ?? "");
    const sourceProductIds = Array.isArray(body.sourceProductIds)
      ? body.sourceProductIds.map(String).filter(Boolean)
      : [];

    if (!targetProductId || sourceProductIds.length === 0) {
      sendJson(res, 400, { error: "Choose a master product and at least one product to merge." });
      return;
    }

    if (sourceProductIds.includes(targetProductId)) {
      sendJson(res, 400, { error: "The master product cannot also be merged into itself." });
      return;
    }

    const data = await readStore();
    const targetProduct = data.products.find((product) => product.id === targetProductId);
    if (!targetProduct) {
      sendJson(res, 404, { error: "Master product not found." });
      return;
    }

    const sourceSet = new Set(sourceProductIds);
    const existingSourceCount = data.products.filter((product) => sourceSet.has(product.id)).length;
    if (existingSourceCount !== sourceSet.size) {
      sendJson(res, 404, { error: "One or more products to merge were not found." });
      return;
    }

    let movedListings = 0;
    for (const listing of data.listings) {
      if (sourceSet.has(listing.productId)) {
        listing.productId = targetProductId;
        movedListings += 1;
      }
    }

    data.products = data.products.filter((product) => !sourceSet.has(product.id));
    await writeStore(data);
    sendJson(res, 200, {
      product: targetProduct,
      mergedProductCount: sourceSet.size,
      movedListings
    });
    return;
  }

  const productStockMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/stock$/);
  if (req.method === "PATCH" && productStockMatch) {
    const body = await readJson(req);
    const warehouseStock = body.warehouseStock === null ? null : Number(body.warehouseStock);
    if (warehouseStock !== null && (isNaN(warehouseStock) || warehouseStock < 0)) {
      sendJson(res, 400, { error: "warehouseStock must be a non-negative number or null." });
      return;
    }
    const data = await readStore();
    const product = data.products.find((item) => item.id === productStockMatch[1]);
    if (!product) {
      sendJson(res, 404, { error: "Product not found." });
      return;
    }
    product.warehouseStock = warehouseStock;
    await writeStore(data);
    sendJson(res, 200, product);
    return;
  }

  const productSupplierMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/supplier$/);
  if (req.method === "PATCH" && productSupplierMatch) {
    const body = await readJson(req);
    const data = await readStore();
    const product = data.products.find((item) => item.id === productSupplierMatch[1]);
    if (!product) {
      sendJson(res, 404, { error: "Product not found." });
      return;
    }

    const supplierId = body.supplierId || null;
    if (supplierId && !data.suppliers.some((supplier) => supplier.id === supplierId)) {
      sendJson(res, 400, { error: "Supplier not found." });
      return;
    }

    product.supplierId = supplierId;
    await writeStore(data);
    sendJson(res, 200, product);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/listings") {
    const body = await readJson(req);
    const data = await readStore();
    const listing = {
      id: makeId("lst"),
      productId: body.productId,
      marketplaceId: body.marketplaceId,
      marketplaceIdentifier: body.marketplaceIdentifier,
      identifierType: body.identifierType,
      marketplaceSku: body.marketplaceSku ?? "",
      title: body.title ?? "",
      active: body.active !== false
    };
    data.listings.push(listing);
    await writeStore(data);
    sendJson(res, 201, listing);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/fees") {
    const body = await readJson(req);
    const data = await readStore();
    const fee = {
      id: makeId("fee"),
      marketplaceId: body.marketplaceId,
      name: body.name,
      feeType: body.feeType,
      value: Number(body.value) || 0,
      appliesTo: body.appliesTo || "sale"
    };
    data.fees.push(fee);
    await writeStore(data);
    sendJson(res, 201, fee);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/transactions") {
    const body = await readJson(req);
    const data = await readStore();
    const transaction = {
      id: makeId("txn"),
      listingId: body.listingId,
      date: body.date,
      quantity: Number(body.quantity) || 0,
      grossSales: Number(body.grossSales) || 0,
      marketplaceFees: Number(body.marketplaceFees) || 0,
      currency: body.currency || "ZAR"
    };
    data.transactions.push(transaction);
    await writeStore(data);
    sendJson(res, 201, transaction);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/csv") {
    const body = await readJson(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const data = await readStore();
    const result = importCsvRows(data, rows, String(body.source || "csv"));
    await writeStore(data);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cron/sync") {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    const data = await readStore();
    const results = {};
    let dirty = false;
    if (isTakealotConfigured(config)) {
      try {
        const r = await syncTakealotApiData(config, data);
        if (r.ok) { data.syncedAt = { ...data.syncedAt, takealot: new Date().toISOString() }; dirty = true; }
        results.takealot = r.message;
      } catch (err) {
        results.takealot = `Error: ${err.message}`;
      }
    }
    const amazonConfigured = Boolean(config.amazon.refreshToken && config.amazon.clientId && config.amazon.clientSecret && config.amazon.marketplaceId);
    if (amazonConfigured) {
      try {
        const r = await syncAmazonApiData(config, data);
        if (r.ok) { data.syncedAt = { ...data.syncedAt, amazon: new Date().toISOString() }; dirty = true; }
        results.amazon = r.message;
      } catch (err) {
        results.amazon = `Error: ${err.message}`;
      }
    }
    if (dirty) await writeStore(data);
    sendJson(res, 200, { ok: true, timestamp: new Date().toISOString(), results });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function importCsvRows(data, rows, source) {
  const result = {
    suppliers: { imported: 0, updated: 0 },
    products: { imported: 0, updated: 0 },
    listings: { imported: 0, updated: 0 },
    transactions: { imported: 0, updated: 0 },
    fees: { rowsWithFees: 0, rowsMissingFees: 0 },
    skipped: 0
  };

  for (const row of rows) {
    const normalized = normalizeCsvSale(row, source);
    if (!normalized.date || !normalized.marketplaceId || !normalized.quantity && !normalized.grossSales) {
      result.skipped += 1;
      continue;
    }
    if (normalized.hasMarketplaceFees) {
      result.fees.rowsWithFees += 1;
    } else {
      result.fees.rowsMissingFees += 1;
    }

    const listing = findOrCreateCsvListing(data, normalized, result);
    const transactionFields = {
      listingId: listing.id,
      externalId: normalized.transactionKey,
      date: normalized.date,
      quantity: normalized.quantity,
      grossSales: normalized.grossSales,
      marketplaceFees: normalized.marketplaceFees,
      saleStatus: normalized.saleStatus,
      currency: normalized.currency,
      source: "csv",
      apiData: csvImportMetadata(normalized, source)
    };

    const existing = data.transactions.find((transaction) => transaction.externalId === normalized.transactionKey);
    if (existing) {
      Object.assign(existing, transactionFields);
      result.transactions.updated += 1;
    } else {
      data.transactions.push({ id: makeId("txn"), ...transactionFields });
      result.transactions.imported += 1;
    }
  }

  return result;
}

function csvImportMetadata(normalized, source) {
  return {
    source,
    marketplaceId: normalized.marketplaceId,
    sku: normalized.sku,
    identifier: normalized.identifier,
    identifierType: normalized.identifierType,
    productName: normalized.productName
  };
}

function findOrCreateCsvListing(data, normalized, result) {
  const listing = findCsvListing(data, normalized);
  if (listing) {
    listing.marketplaceSku ||= normalized.sku;
    listing.title ||= normalized.productName;
    const product = data.products.find((item) => item.id === listing.productId);
    if (product) assignCsvSupplier(data, product, normalized, result);
    result.listings.updated += 1;
    return listing;
  }

  let product = findCsvProduct(data, normalized);
  if (!product) {
    product = {
      id: makeId("prd"),
      name: normalized.productName || normalized.sku || normalized.identifier || "CSV Product",
      sku: normalized.sku || normalized.identifier || makeId("csv-sku"),
      supplierId: null,
      cost: 0,
      currency: normalized.currency,
      source: "csv"
    };
    data.products.push(product);
    result.products.imported += 1;
  }
  assignCsvSupplier(data, product, normalized, result);

  const nextListing = {
    id: makeId("lst"),
    productId: product.id,
    marketplaceId: normalized.marketplaceId,
    marketplaceIdentifier: normalized.identifier || normalized.sku || product.sku,
    identifierType: normalized.identifierType || "SKU",
    marketplaceSku: normalized.sku || "",
    title: normalized.productName || product.name,
    active: true,
    source: "csv"
  };
  data.listings.push(nextListing);
  result.listings.imported += 1;
  return nextListing;
}

function assignCsvSupplier(data, product, normalized, result) {
  const supplierName = String(normalized.supplierName || "").trim();
  if (!supplierName) return;

  let supplier = data.suppliers.find((item) => String(item.name || "").trim().toLowerCase() === supplierName.toLowerCase());
  if (!supplier) {
    supplier = { id: makeId("sup"), name: supplierName, contact: "" };
    data.suppliers.push(supplier);
    result.suppliers.imported += 1;
  }

  if (product.supplierId !== supplier.id) {
    product.supplierId = supplier.id;
    result.suppliers.updated += 1;
  }
}

function findCsvListing(data, normalized) {
  const identifier = String(normalized.identifier || "").toLowerCase();
  const sku = String(normalized.sku || "").toLowerCase();
  const productName = String(normalized.productName || "").toLowerCase();
  return data.listings.find((listing) => (
    listing.marketplaceId === normalized.marketplaceId
    && (
      (identifier && String(listing.marketplaceIdentifier || "").toLowerCase() === identifier)
      || (sku && String(listing.marketplaceSku || "").toLowerCase() === sku)
      || (productName && String(listing.title || "").toLowerCase() === productName)
    )
  ));
}

function findCsvProduct(data, normalized) {
  const sku = String(normalized.sku || "").toLowerCase();
  if (sku) {
    const bySku = data.products.find((product) => String(product.sku || "").toLowerCase() === sku);
    if (bySku) return bySku;
  }

  const listing = findCsvListing(data, normalized);
  if (listing) return data.products.find((product) => product.id === listing.productId);
  const productName = String(normalized.productName || "").toLowerCase();
  if (productName) {
    return data.products.find((product) => String(product.name || "").toLowerCase() === productName) || null;
  }
  return null;
}

function normalizeCsvSale(row, source) {
  const normalizedRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeImportKey(key), value]));
  const get = (...keys) => {
    for (const key of keys) {
      const value = normalizedRow[normalizeImportKey(key)];
      if (value !== undefined && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };
  const marketplaceId = normalizeMarketplaceId(get("marketplace", "marketplaces", "marketplace_id", "channel", "platform") || source);
  const sku = get("sku", "seller_sku", "seller_sku_id", "merchant_sku", "local_sku", "product_sku", "product_code");
  const asin = get("asin");
  const tsin = get("tsin");
  const identifier = asin || tsin || get("identifier", "marketplace_identifier", "listing_id", "offer_id", "product_id", "item_id", "id") || sku;
  const identifierType = asin ? "ASIN" : tsin ? "TSIN" : get("identifier_type", "id_type") || "SKU";
  const date = normalizeDate(get("date", "latest_sale", "last_sale", "sale_date", "order_date", "purchase_date", "transaction_date", "order_time", "item_won_or_bought_time"));
  const quantity = parseNumber(get("quantity", "qty", "units", "units_sold", "unit_count"));
  const grossSales = parseNumber(get("gross_sales", "gross", "sales", "amount", "item_price", "total", "sales_value", "total_item_amount", "total_order_amount", "amount_paid_online"));
  const marketplaceFeeText = get("fees", "fee", "marketplace_fees", "commission", "commission_fee", "seller_fee", "success_fee", "imported_fees", "imported_fee");
  const marketplaceFees = parseNumber(marketplaceFeeText);
  const saleStatus = get("status", "sale_status", "order_status", "checkout_status", "type");
  const external = get("external_id", "transaction_id", "order_item_id", "order_id", "sale_id");
  const productName = get("product_name", "product", "title", "item_title", "item_name", "name");
  const supplierName = get("supplier", "supplier_name", "vendor", "vendor_name");

  return {
    marketplaceId,
    sku,
    identifier,
    identifierType,
    productName,
    supplierName,
    date,
    quantity,
    grossSales,
    marketplaceFees,
    hasMarketplaceFees: marketplaceFeeText !== "",
    saleStatus,
    currency: get("currency") || "ZAR",
    transactionKey: external || `csv:${source}:${marketplaceId}:${date}:${identifier || sku || productName}:${quantity}:${grossSales}:${saleStatus}`
  };
}

function normalizeImportKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeMarketplaceId(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("takealot") || normalized.includes("tklt")) return "takealot";
  if (normalized.includes("amazon") || normalized.includes("amzn")) return "amazon";
  if (normalized.includes("bob")) return "bobshop";
  return normalized;
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const [, day, month, year] = match;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseNumber(value) {
  let text = String(value || "").trim().replace(/[^0-9,.\-]/g, "");
  if (!text) return 0;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    text = lastComma > lastDot
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    const [, decimals = ""] = text.split(",").slice(-2);
    text = decimals.length === 2 ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  }

  return Number(text) || 0;
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
