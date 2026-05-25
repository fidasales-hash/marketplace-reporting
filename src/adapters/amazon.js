import crypto from "node:crypto";
import zlib from "node:zlib";
import { makeId } from "../store.js";

const AMAZON_ORDER_REPORT_TYPE = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";

export function isAmazonConfigured(config) {
  return Boolean(
    config.amazon.refreshToken &&
    config.amazon.clientId &&
    config.amazon.clientSecret &&
    config.amazon.marketplaceId
  );
}

export async function testAmazonConnection(config) {
  if (!isAmazonConfigured(config)) return missingConfigResult();

  const tokenResult = await requestAccessToken(config);
  if (!tokenResult.ok) return tokenResult;

  if (!isAmazonSigningConfigured(config)) {
    return {
      ok: true,
      status: 200,
      marketplaceId: config.amazon.marketplaceId,
      message: `Amazon LWA token succeeded. Full SP-API calls still need AWS signing credentials. Token expires in ${tokenResult.expiresIn || "unknown"} seconds.`
    };
  }

  const response = await amazonRequest(config, "/sellers/v1/marketplaceParticipations", tokenResult.accessToken);
  const payload = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    marketplaceId: config.amazon.marketplaceId,
    marketplaces: extractMarketplaceIds(payload),
    message: response.ok
      ? "Amazon SP-API connection succeeded."
      : payload.message || payload.errors?.[0]?.message || "Amazon SP-API connection failed."
  };
}

function extractMarketplaceIds(payload) {
  const participations = payload.payload || [];
  if (!Array.isArray(participations)) return [];
  return participations
    .map((item) => item.marketplace?.id || item.marketplace?.marketplaceId || item.marketplace?.MarketplaceId)
    .filter(Boolean);
}

export async function syncAmazonApiData(config, data, options = {}) {
  if (!isAmazonConfigured(config)) return missingConfigResult();
  if (!isAmazonSigningConfigured(config)) {
    return {
      ok: false,
      status: 400,
      message: "Amazon AWS signing credentials are not configured."
    };
  }

  const tokenResult = await requestAccessToken(config);
  if (!tokenResult.ok) return tokenResult;

  const dateRange = resolveSyncDateRange(options);
  const ranges = splitDateRangeByMonth(dateRange.from, dateRange.to);
  const orders = [];
  for (const range of ranges) {
    orders.push(...await fetchOrders(config, tokenResult.accessToken, range.from, range.to));
    await wait(1200);
  }
  const orderItems = [];
  for (const order of orders) {
    await wait(2200);
    const items = await fetchOrderItems(config, tokenResult.accessToken, order.AmazonOrderId);
    for (const item of items) orderItems.push({ order, item });
  }
  const sales = importAmazonOrderItems(data, orderItems);

  return {
    ok: true,
    status: 200,
    message: `Synced ${orders.length} Amazon orders and ${orderItems.length} order items.`,
    salesDateRange: dateRange,
    orders: {
      fetched: orders.length
    },
    sales
  };
}

export async function syncAmazonReportsData(config, data, options = {}) {
  if (!isAmazonConfigured(config)) return missingConfigResult();
  if (!isAmazonSigningConfigured(config)) {
    return {
      ok: false,
      status: 400,
      message: "Amazon AWS signing credentials are not configured."
    };
  }

  const tokenResult = await requestAccessToken(config);
  if (!tokenResult.ok) return tokenResult;

  const dateRange = resolveSyncDateRange(options);
  const ranges = splitDateRangeByMonth(dateRange.from, dateRange.to);
  let reportCount = 0;
  let rowCount = 0;
  const sales = { imported: 0, updated: 0 };

  for (const range of ranges) {
    const report = await createOrderReport(config, tokenResult.accessToken, range.from, range.to);
    const completeReport = await waitForReport(config, tokenResult.accessToken, report.reportId);
    const rows = await downloadReportRows(config, tokenResult.accessToken, completeReport.reportDocumentId);
    const result = importAmazonReportRows(data, rows);
    reportCount += 1;
    rowCount += rows.length;
    sales.imported += result.imported;
    sales.updated += result.updated;
    await wait(2500);
  }

  return {
    ok: true,
    status: 200,
    message: `Backfilled ${rowCount} Amazon report rows from ${reportCount} report(s).`,
    salesDateRange: dateRange,
    reports: {
      fetched: reportCount,
      rows: rowCount
    },
    sales
  };
}

export async function syncAmazonFinanceData(config, data, options = {}) {
  if (!isAmazonConfigured(config)) return missingConfigResult();
  if (!isAmazonSigningConfigured(config)) {
    return {
      ok: false,
      status: 400,
      message: "Amazon AWS signing credentials are not configured."
    };
  }

  const tokenResult = await requestAccessToken(config);
  if (!tokenResult.ok) return tokenResult;

  const dateRange = resolveSyncDateRange(options);
  const financeEvents = await fetchFinancialEvents(config, tokenResult.accessToken, dateRange.from, dateRange.to);
  const fees = importAmazonFinanceEvents(data, financeEvents);

  return {
    ok: true,
    status: 200,
    message: `Synced ${financeEvents.eventCount} Amazon financial event(s).`,
    salesDateRange: dateRange,
    financeEvents: {
      fetched: financeEvents.eventCount,
      shipmentEvents: financeEvents.ShipmentEventList.length,
      refundEvents: financeEvents.RefundEventList.length
    },
    fees
  };
}

function isAmazonSigningConfigured(config) {
  return Boolean(config.amazon.awsAccessKeyId && config.amazon.awsSecretAccessKey);
}

async function requestAccessToken(config) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.amazon.refreshToken,
    client_id: config.amazon.clientId,
    client_secret: config.amazon.clientSecret
  });

  const response = await fetch(config.amazon.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: payload.error_description || payload.error || "Amazon LWA token request failed."
    };
  }

  return {
    ok: true,
    status: response.status,
    accessToken: payload.access_token,
    expiresIn: payload.expires_in
  };
}

async function amazonRequest(config, pathname, accessToken, options = {}) {
  const base = config.amazon.baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}${pathname}`);
  const method = options.method || "GET";
  const payload = options.body || "";
  const headers = signAmazonRequest(config, {
    method,
    url,
    accessToken,
    payload,
    contentType: options.contentType
  });
  return fetch(url, { method, headers, body: payload || undefined });
}

async function createOrderReport(config, accessToken, fromDate, toDate) {
  const body = JSON.stringify({
    reportType: AMAZON_ORDER_REPORT_TYPE,
    marketplaceIds: [config.amazon.marketplaceId],
    dataStartTime: startOfDayIso(fromDate),
    dataEndTime: safeEndIso(toDate)
  });
  const response = await amazonRequest(config, "/reports/2021-06-30/reports", accessToken, {
    method: "POST",
    body,
    contentType: "application/json; charset=utf-8"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(amazonErrorMessage(payload, `Amazon report create failed with status ${response.status}`));
  return payload;
}

async function waitForReport(config, accessToken, reportId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(attempt === 0 ? 5000 : 15000);
    const response = await amazonRequest(config, `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, accessToken);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(amazonErrorMessage(payload, `Amazon report status failed with status ${response.status}`));
    if (payload.processingStatus === "DONE") return payload;
    if (["CANCELLED", "FATAL"].includes(payload.processingStatus)) {
      throw new Error(`Amazon report ${reportId} ended with status ${payload.processingStatus}.`);
    }
  }
  throw new Error(`Amazon report ${reportId} was not ready before the polling timeout.`);
}

async function downloadReportRows(config, accessToken, reportDocumentId) {
  const response = await amazonRequest(config, `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`, accessToken);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(amazonErrorMessage(payload, `Amazon report document failed with status ${response.status}`));

  const documentResponse = await fetch(payload.url);
  if (!documentResponse.ok) throw new Error(`Amazon report download failed with status ${documentResponse.status}`);
  const buffer = Buffer.from(await documentResponse.arrayBuffer());
  const text = payload.compressionAlgorithm === "GZIP"
    ? zlib.gunzipSync(buffer).toString("utf8")
    : buffer.toString("utf8");
  return parseDelimitedReport(text);
}

async function fetchFinancialEvents(config, accessToken, fromDate, toDate) {
  const financialEvents = {
    ShipmentEventList: [],
    RefundEventList: []
  };
  let nextToken = "";

  do {
    const params = new URLSearchParams();
    if (nextToken) {
      params.set("NextToken", nextToken);
    } else {
      params.set("PostedAfter", startOfDayIso(fromDate));
      params.set("PostedBefore", safeEndIso(toDate));
      params.set("MaxResultsPerPage", "100");
    }

    const response = await amazonRequest(config, `/finances/v0/financialEvents?${params}`, accessToken);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(amazonErrorMessage(payload, `Amazon finances API failed with status ${response.status}`));

    const events = payload.payload?.FinancialEvents || payload.FinancialEvents || {};
    financialEvents.ShipmentEventList.push(...(events.ShipmentEventList || []));
    financialEvents.RefundEventList.push(...(events.RefundEventList || []));
    nextToken = payload.payload?.NextToken || payload.NextToken || "";
    if (nextToken) await wait(2200);
  } while (nextToken);

  return {
    ...financialEvents,
    eventCount: financialEvents.ShipmentEventList.length + financialEvents.RefundEventList.length
  };
}

function parseDelimitedReport(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitReportLine(lines[0], delimiter).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitReportLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function splitReportLine(line, delimiter) {
  if (delimiter === "\t") return line.split("\t");
  const values = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function fetchOrders(config, accessToken, fromDate, toDate) {
  const orders = [];
  let nextToken = "";

  do {
    const params = new URLSearchParams();
    if (nextToken) {
      params.set("NextToken", nextToken);
    } else {
      params.set("CreatedAfter", startOfDayIso(fromDate));
      params.set("CreatedBefore", safeEndIso(toDate));
      params.set("MarketplaceIds", config.amazon.marketplaceId);
      params.set("MaxResultsPerPage", "100");
    }

    const response = await amazonRequest(config, `/orders/v0/orders?${params}`, accessToken);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.errors?.[0]?.message || `Amazon orders API failed with status ${response.status}`);

    orders.push(...(payload.payload?.Orders || []));
    nextToken = payload.payload?.NextToken || "";
  } while (nextToken);

  return orders;
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOrderItems(config, accessToken, orderId) {
  const items = [];
  let nextToken = "";

  do {
    const params = new URLSearchParams();
    if (nextToken) params.set("NextToken", nextToken);
    const query = params.toString() ? `?${params}` : "";
    const response = await amazonRequest(config, `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems${query}`, accessToken);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.errors?.[0]?.message || `Amazon order items API failed with status ${response.status}`);

    items.push(...(payload.payload?.OrderItems || []));
    nextToken = payload.payload?.NextToken || "";
  } while (nextToken);

  return items;
}

function importAmazonOrderItems(data, orderItems) {
  let imported = 0;
  let updated = 0;

  for (const { order, item } of orderItems) {
    const normalized = normalizeOrderItem(order, item);
    if (!normalized.transactionKey || !normalized.identifier) continue;

    let listing = findAmazonListing(data, normalized.identifier, normalized.sku);
    if (!listing) {
      const product = buildProduct(normalized);
      listing = buildListing(product.id, normalized);
      data.products.push(product);
      data.listings.push(listing);
    } else {
      const product = data.products.find((candidate) => candidate.id === listing.productId);
      if (product) applyProductFields(product, normalized);
      applyListingFields(listing, normalized);
    }

    const transactionFields = buildTransaction(listing.id, normalized);
    const existing = findExistingAmazonTransaction(data, transactionFields);
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

function importAmazonReportRows(data, rows) {
  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const normalized = normalizeReportRow(row);
    if (!normalized.transactionKey || !normalized.identifier) continue;

    let listing = findAmazonListing(data, normalized.identifier, normalized.sku);
    if (!listing) {
      const product = buildProduct(normalized);
      listing = buildListing(product.id, normalized);
      data.products.push(product);
      data.listings.push(listing);
    } else {
      const product = data.products.find((candidate) => candidate.id === listing.productId);
      if (product) applyProductFields(product, normalized);
      applyListingFields(listing, normalized);
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

function importAmazonFinanceEvents(data, financeEvents) {
  const result = {
    updated: 0,
    unmatched: 0,
    totalFees: 0
  };

  for (const shipment of financeEvents.ShipmentEventList || []) {
    for (const item of shipment.ShipmentItemList || []) {
      const feeAmount = amazonFeeAmount(item.ItemFeeList);
      if (!feeAmount) continue;
      const transaction = findAmazonTransactionForFinanceItem(data, shipment.AmazonOrderId, item);
      if (!transaction) {
        result.unmatched += 1;
        continue;
      }
      transaction.marketplaceFees = feeAmount;
      transaction.apiData = {
        ...(transaction.apiData || {}),
        amazonFees: feeMetadata(item.ItemFeeList),
        amazonFeesSource: "finances-v0",
        amazonFeesPostedDate: shipment.PostedDate || ""
      };
      result.updated += 1;
      result.totalFees += feeAmount;
    }
  }

  for (const refund of financeEvents.RefundEventList || []) {
    for (const item of refund.ShipmentItemAdjustmentList || []) {
      const feeAmount = amazonFeeAmount(item.ItemFeeAdjustmentList);
      if (!feeAmount) continue;
      const transaction = findAmazonTransactionForFinanceItem(data, refund.AmazonOrderId, item);
      if (!transaction) {
        result.unmatched += 1;
        continue;
      }
      transaction.apiData = {
        ...(transaction.apiData || {}),
        amazonRefundFees: feeMetadata(item.ItemFeeAdjustmentList),
        amazonRefundFeesSource: "finances-v0",
        amazonRefundFeesPostedDate: refund.PostedDate || ""
      };
    }
  }

  result.totalFees = Number(result.totalFees.toFixed(2));
  return result;
}

function findAmazonTransactionForFinanceItem(data, orderId, item) {
  const orderItemId = String(item.OrderItemId || "");
  const sellerSku = String(item.SellerSKU || item.SellerSku || "");
  return data.transactions.find((transaction) => (
    transaction.source === "amazon-api" &&
    (
      (orderItemId && transaction.externalId === `amazon:${orderItemId}`) ||
      (
        String(transaction.apiData?.orderId || "") === String(orderId || "") &&
        (!sellerSku || String(transaction.apiData?.sellerSku || "") === sellerSku)
      )
    )
  ));
}

function amazonFeeAmount(feeList = []) {
  const total = feeList.reduce((sum, fee) => sum + numberValue(fee.FeeAmount?.CurrencyAmount), 0);
  return Number(Math.abs(total).toFixed(2));
}

function feeMetadata(feeList = []) {
  return feeList.map((fee) => ({
    type: fee.FeeType || "",
    amount: numberValue(fee.FeeAmount?.CurrencyAmount),
    currency: fee.FeeAmount?.CurrencyCode || ""
  }));
}

function normalizeReportRow(row) {
  const orderId = String(row["amazon-order-id"] || row["order-id"] || "");
  const sku = String(row.sku || row["seller-sku"] || "");
  const identifier = String(row.asin || "");
  const quantity = Number(row.quantity) || 0;
  const itemPrice = numberValue(row["item-price"]);
  const shippingPrice = numberValue(row["shipping-price"]);
  const giftWrapPrice = numberValue(row["gift-wrap-price"]);
  const itemPromotion = numberValue(row["item-promotion-discount"]);
  const shipPromotion = numberValue(row["ship-promotion-discount"]);
  const grossSales = itemPrice + shippingPrice + giftWrapPrice - itemPromotion - shipPromotion;
  const date = toDateInput(new Date(row["purchase-date"] || row["payments-date"] || Date.now()));
  const status = String(row["order-status"] || row["item-status"] || "");
  return {
    transactionKey: orderId && (sku || identifier) ? `amazon-report:${orderId}:${sku}:${identifier}` : "",
    orderId,
    orderStatus: status,
    date,
    identifier,
    sku: sku || identifier,
    title: String(row["product-name"] || identifier || sku),
    quantity,
    grossSales,
    currency: String(row.currency || row["currency-code"] || "ZAR"),
    raw: {
      item: row
    }
  };
}

function findExistingAmazonTransaction(data, transactionFields) {
  return data.transactions.find((transaction) => (
    transaction.externalId === transactionFields.externalId ||
    (
      transaction.source === "amazon-api" &&
      transaction.listingId === transactionFields.listingId &&
      transaction.date === transactionFields.date &&
      String(transaction.apiData?.orderId || "") === String(transactionFields.apiData?.orderId || "") &&
      Number(transaction.grossSales || 0) === Number(transactionFields.grossSales || 0) &&
      Number(transaction.quantity || 0) === Number(transactionFields.quantity || 0)
    )
  ));
}

function numberValue(value) {
  return Number(String(value || "0").replace(/,/g, "")) || 0;
}

function normalizeOrderItem(order, item) {
  const identifier = String(item.ASIN || "");
  const sku = String(item.SellerSKU || identifier);
  const grossSales = Number(item.ItemPrice?.Amount) || 0;
  const quantity = Number(item.QuantityOrdered) || Number(item.QuantityShipped) || 0;
  return {
    transactionKey: item.OrderItemId ? `amazon:${item.OrderItemId}` : "",
    orderId: String(order.AmazonOrderId || ""),
    orderStatus: String(order.OrderStatus || ""),
    date: toDateInput(new Date(order.PurchaseDate || Date.now())),
    identifier,
    sku,
    title: String(item.Title || identifier || sku),
    quantity,
    grossSales,
    currency: item.ItemPrice?.CurrencyCode || order.OrderTotal?.CurrencyCode || "ZAR",
    raw: {
      order,
      item
    }
  };
}

function findAmazonListing(data, identifier, sku) {
  return data.listings.find((listing) => (
    listing.marketplaceId === "amazon" &&
    (String(listing.marketplaceIdentifier) === String(identifier) || (sku && String(listing.marketplaceSku) === String(sku)))
  ));
}

function buildProduct(normalized) {
  return {
    id: makeId("prd"),
    name: normalized.title,
    sku: normalized.sku || normalized.identifier,
    supplierId: null,
    cost: 0,
    currency: normalized.currency,
    source: "amazon-api"
  };
}

function buildListing(productId, normalized) {
  return {
    id: makeId("lst"),
    productId,
    marketplaceId: "amazon",
    marketplaceIdentifier: normalized.identifier,
    identifierType: "ASIN",
    marketplaceSku: normalized.sku,
    title: normalized.title,
    active: normalized.orderStatus !== "Canceled",
    source: "amazon-api",
    apiData: normalized.raw.item
  };
}

function applyProductFields(product, normalized) {
  product.name = product.name || normalized.title;
  product.sku = product.sku || normalized.sku || normalized.identifier;
  product.currency = product.currency || normalized.currency;
  product.source = product.source || "amazon-api";
}

function applyListingFields(listing, normalized) {
  listing.marketplaceIdentifier = normalized.identifier || listing.marketplaceIdentifier;
  listing.identifierType = "ASIN";
  listing.marketplaceSku = normalized.sku || listing.marketplaceSku;
  listing.title = normalized.title || listing.title;
  listing.active = normalized.orderStatus !== "Canceled";
  listing.source = listing.source || "amazon-api";
  listing.apiData = normalized.raw.item;
}

function buildTransaction(listingId, normalized) {
  return {
    externalId: normalized.transactionKey,
    listingId,
    date: normalized.date,
    quantity: normalized.quantity,
    grossSales: normalized.grossSales,
    marketplaceFees: 0,
    currency: normalized.currency,
    saleStatus: normalized.orderStatus,
    source: "amazon-api",
    apiData: {
      orderId: normalized.orderId,
      orderStatus: normalized.orderStatus,
      asin: normalized.identifier,
      sellerSku: normalized.sku,
      title: normalized.title
    }
  };
}

function resolveSyncDateRange(options = {}) {
  const today = new Date();
  today.setMinutes(today.getMinutes() - 5);
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  return {
    from: options.from || toDateInput(defaultFrom),
    to: options.to || toDateInput(today)
  };
}

function startOfDayIso(dateInput) {
  return `${dateInput}T00:00:00Z`;
}

function safeEndIso(dateInput) {
  const requestedEnd = new Date(`${dateInput}T23:59:00Z`);
  const latestAllowed = new Date(Date.now() - 5 * 60 * 1000);
  return (requestedEnd > latestAllowed ? latestAllowed : requestedEnd).toISOString();
}

function signAmazonRequest(config, request) {
  const amzDate = toAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const service = "execute-api";
  const region = amazonAwsRegion(config.amazon.region);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = request.url.pathname || "/";
  const canonicalQueryString = canonicalQuery(request.url.searchParams);
  const payloadHash = sha256Hex(request.payload || "");
  const host = request.url.host;
  const headers = {
    accept: "application/json",
    host,
    "x-amz-access-token": request.accessToken,
    "x-amz-date": amzDate
  };
  if (request.contentType) headers["content-type"] = request.contentType;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${String(headers[key]).trim()}\n`)
    .join("");
  const canonicalRequest = [
    request.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = getSignatureKey(config.amazon.awsSecretAccessKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);

  const signed = {
    Accept: headers.accept,
    Host: headers.host,
    "x-amz-access-token": headers["x-amz-access-token"],
    "x-amz-date": headers["x-amz-date"],
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.amazon.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
  if (request.contentType) signed["Content-Type"] = request.contentType;
  return signed;
}

function amazonAwsRegion(region) {
  if (region === "na") return "us-east-1";
  if (region === "fe") return "us-west-2";
  return "eu-west-1";
}

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function missingConfigResult() {
  return {
    ok: false,
    status: 400,
    message: "Amazon SP-API credentials are not fully configured."
  };
}

function amazonErrorMessage(payload, fallback) {
  const errors = payload.errors || [];
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((error) => [error.code, error.message, error.details].filter(Boolean).join(": ")).join(" | ");
  }
  return payload.message || fallback;
}
