const state = {
  marketplaces: [],
  suppliers: [],
  products: [],
  listings: [],
  fees: [],
  transactions: [],
  integrations: {},
  summary: [],
  supplierSummary: [],
  marketplaceSummary: [],
  supplierMarketplaceSummary: []
};

const productSort = {
  key: "lastSale",
  direction: "desc"
};

const salesReport = {
  mode: "supplier",
  sortKey: "latestSaleDate",
  sortDirection: "desc"
};
let salesSearchQuery = "";

const defaultSalesColumns = {
  supplier: ["supplierName", "marketplaces", "latestSaleDate", "productCount", "units", "returnedUnits", "returnedValue", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"],
  marketplace: ["marketplaceId", "latestSaleDate", "productCount", "units", "returnedUnits", "returnedValue", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"],
  "supplier-marketplace": ["supplierName", "marketplaceId", "latestSaleDate", "productCount", "units", "returnedUnits", "returnedValue", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"]
};

const requiredSalesColumns = {
  supplier: ["supplierName"],
  marketplace: ["marketplaceId"],
  "supplier-marketplace": ["supplierName", "marketplaceId"]
};

const salesColumnStorageVersion = "9";
const tableColumnWidthsStorageKey = "tableColumnWidths:v2";
let salesReportColumns = loadSalesReportColumns();
let tableColumnWidths = loadTableColumnWidths();

const currency = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR"
});

const productColumns = [
  { id: "merge", label: "Merge", defaultVisible: true },
  { id: "name", label: "Product", defaultVisible: true },
  { id: "sku", label: "SKU", defaultVisible: true },
  { id: "supplier", label: "Supplier", defaultVisible: true },
  { id: "cost", label: "Cost", defaultVisible: true },
  { id: "marketplaces", label: "Marketplaces", defaultVisible: true },
  { id: "stockOnHand", label: "Stock (TK)", defaultVisible: true },
  { id: "identifiers", label: "Identifiers", defaultVisible: true },
  { id: "lastSale", label: "Last Sale", defaultVisible: true },
  { id: "units", label: "Units", defaultVisible: true },
  { id: "returnedUnits", label: "Returns", defaultVisible: true },
  { id: "returnedValue", label: "Returns Value", defaultVisible: true },
  { id: "cancelledUnits", label: "Cancelled", defaultVisible: false },
  { id: "grossSales", label: "Sales", defaultVisible: true },
  { id: "marketplaceFees", label: "Fees", defaultVisible: false },
  { id: "netSales", label: "Net Sales", defaultVisible: true },
  { id: "estimatedProfit", label: "Profit", defaultVisible: true },
  { id: "dateCreated", label: "API Created", defaultVisible: false },
  { id: "source", label: "Source", defaultVisible: false }
];

const defaultColumnWidths = {
  product: {
    merge: 58,
    name: 340,
    sku: 100,
    supplier: 150,
    cost: 76,
    marketplaces: 98,
    stockOnHand: 90,
    identifiers: 220,
    lastSale: 98,
    units: 76,
    returnedUnits: 76,
    returnedValue: 106,
    cancelledUnits: 76,
    grossSales: 106,
    marketplaceFees: 106,
    netSales: 106,
    estimatedProfit: 106,
    dateCreated: 98,
    source: 100
  },
  sales: {
    productName: 320,
    supplierName: 190,
    marketplaces: 130,
    marketplaceId: 130,
    latestSaleDate: 96,
    stockOnHand: 90,
    productCount: 74,
    units: 74,
    returnedUnits: 74,
    returnedValue: 106,
    grossSales: 106,
    marketplaceFees: 106,
    netSales: 106,
    estimatedProfit: 106
  }
};

let visibleProductColumns = loadProductColumns();
let productRowSize = loadDensity();
let productSearchQuery = "";
let productSummaryMap = new Map();

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
let activeColumnResize = null;
let activeColumnDrag = null;
let suppressNextHeaderClick = false;
const activeTableWidthTotals = { product: 0, sales: 0 };
const lockedProductColumns = ["merge", "name"];

await load();
bindNavigation();
bindForms();
await refreshReport();
setInterval(async () => { await load(); await refreshReport(); }, 5 * 60 * 1000);

async function load() {
  Object.assign(state, await api("/api/bootstrap"));
  renderStaticData();
}

async function refreshReport() {
  const params = new URLSearchParams();
  const from = qs("#from-date").value;
  const to = qs("#to-date").value;
  const marketplaceId = qs("#marketplace-filter").value;
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (marketplaceId) params.set("marketplaceId", marketplaceId);

  state.summary = await api(`/api/reports/products?${params}`);
  state.supplierSummary = await api(`/api/reports/suppliers?${params}`);
  state.marketplaceSummary = await api(`/api/reports/marketplaces?${params}`);
  state.supplierMarketplaceSummary = await api(`/api/reports/supplier-marketplaces?${params}`);
  productSummaryMap = new Map(state.summary.map((item) => [item.productId, item]));
  renderSummary();
  renderSalesReport();
  renderProducts();
}

function bindNavigation() {
  qsa(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      qsa(".nav-button").forEach((item) => item.classList.remove("active"));
      qsa(".view").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      qs(`#${button.dataset.view}`).classList.add("active");
      qs("#view-title").textContent = button.textContent;
    });
  });

  qs("#refresh-report").addEventListener("click", refreshReport);
  qs("#export-sales-csv").addEventListener("click", exportSalesCsv);
  qs("#reset-sales-columns").addEventListener("click", resetSalesColumns);
  qs("#reset-sales-widths").addEventListener("click", () => resetTableColumnWidths("sales"));
  qs("#from-date").addEventListener("change", refreshReport);
  qs("#to-date").addEventListener("change", refreshReport);
  qs("#marketplace-filter").addEventListener("change", refreshReport);
  qs("#sales-search").addEventListener("input", (event) => {
    salesSearchQuery = event.target.value.trim().toLowerCase();
    renderSalesReport();
  });
  qs("#density-control").addEventListener("change", (event) => {
    productRowSize = event.target.value;
    saveDensity();
    applyProductTableDisplay();
  });
  qs("#sales-report-mode").addEventListener("change", (event) => {
    salesReport.mode = event.target.value;
    salesReport.sortKey = "latestSaleDate";
    salesReport.sortDirection = "desc";
    ensureSalesColumnsForMode(salesReportConfig());
    renderSalesReport();
  });
  qs("#sales-column-list").addEventListener("change", (event) => {
    if (!event.target.matches("[data-sales-column]")) return;
    salesReport.mode = qs("#sales-report-mode").value;
    const config = salesReportConfig();
    ensureSalesColumnsForMode(config);
    const columns = salesReportColumns[salesReport.mode];
    const columnId = event.target.dataset.salesColumn;
    salesReportColumns[salesReport.mode] = event.target.checked
      ? [...new Set([...columns, columnId])]
      : columns.filter((id) => id !== columnId);
    saveSalesReportColumns();
    renderSalesReport();
  });
  qs("#sales-report-head").addEventListener("pointerdown", startColumnResize);
  qs("#sales-report-head").addEventListener("pointerdown", startColumnDrag);
  qs("#sales-report-head").addEventListener("click", (event) => {
    if (event.target.closest("[data-column-resize]") || suppressNextHeaderClick) {
      suppressNextHeaderClick = false;
      return;
    }
    const button = event.target.closest("[data-sales-sort]");
    if (!button) return;
    const key = button.dataset.salesSort;
    if (salesReport.sortKey === key) {
      salesReport.sortDirection = salesReport.sortDirection === "asc" ? "desc" : "asc";
    } else {
      salesReport.sortKey = key;
      salesReport.sortDirection = ["productName", "supplierName", "marketplaceId", "marketplaces", "group"].includes(key) ? "asc" : "desc";
    }
    renderSalesReport();
  });
  qs("#test-takealot").addEventListener("click", testTakealot);
  qs("#sync-takealot").addEventListener("click", syncTakealot);
  qs("#test-amazon").addEventListener("click", testAmazon);
  qs("#sync-amazon").addEventListener("click", syncAmazon);
  qs("#sync-amazon-fees").addEventListener("click", syncAmazonFees);
  qs("#backfill-amazon").addEventListener("click", backfillAmazon);
  qs("#import-csv").addEventListener("click", importCsv);
  qs("#merge-products").addEventListener("click", mergeSelectedProducts);
  qs("#reset-product-columns").addEventListener("click", resetProductColumns);
  qs("#reset-product-widths").addEventListener("click", () => resetTableColumnWidths("product"));
  qs("#product-column-list").addEventListener("change", (event) => {
    if (!event.target.matches("[data-product-column]")) return;
    const columnId = event.target.dataset.productColumn;
    visibleProductColumns = event.target.checked
      ? [...new Set([...visibleProductColumns, columnId])]
      : visibleProductColumns.filter((id) => id !== columnId);
    saveProductColumns();
    renderProducts();
  });
  qs("#product-table-head").addEventListener("pointerdown", startColumnResize);
  qs("#product-table-head").addEventListener("pointerdown", startColumnDrag);
  qs("#product-search").addEventListener("input", (event) => {
    productSearchQuery = event.target.value.trim().toLowerCase();
    renderProducts();
  });
  qs("#product-row-size").addEventListener("change", (event) => {
    productRowSize = event.target.value;
    saveProductRowSize();
    qs("#density-control").value = productRowSize;
    applyProductTableDisplay();
  });
  qs("#product-table-head").addEventListener("click", (event) => {
    if (event.target.closest("[data-column-resize]") || suppressNextHeaderClick) {
      suppressNextHeaderClick = false;
      return;
    }
    const button = event.target.closest("[data-product-sort]");
    if (!button) return;
    const key = button.dataset.productSort;
    if (productSort.key === key) {
      productSort.direction = productSort.direction === "asc" ? "desc" : "asc";
    } else {
      productSort.key = key;
      productSort.direction = ["name", "sku", "supplier", "marketplaces", "identifiers", "source"].includes(key) ? "asc" : "desc";
    }
    renderProducts();
  });
}

function bindForms() {
  bindPostForm("#supplier-form", "/api/suppliers");
  bindPostForm("#listing-form", "/api/listings");

  qs("#product-list").addEventListener("change", async (event) => {
    if (!event.target.matches("[data-product-supplier]")) return;
    await assignProductSupplier(event.target.dataset.productSupplier, event.target.value);
  });

  qs("#supplier-list").addEventListener("submit", async (event) => {
    if (!event.target.matches("[data-supplier-form]")) return;
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    await renameSupplier(form.dataset.supplierForm, payload.name);
  });

  qs("#supplier-list").addEventListener("click", async (event) => {
    if (!event.target.matches("[data-delete-supplier]")) return;
    await deleteSupplier(event.target.dataset.deleteSupplier);
  });
}

function bindPostForm(selector, endpoint) {
  qs(selector).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    await load();
    await refreshReport();
  });
}

function renderStaticData() {
  fillMarketplaceSelects();
  fillSupplierSelects();
  fillProductSelects();
  fillListingSelects();
  renderProductColumnPicker();
  applyProductTableDisplay();
  renderSuppliers();
  renderProducts();
  renderListings();
  renderIntegrationStatus();
}

function renderIntegrationStatus(message = "") {
  const takealot = state.integrations.takealot;
  const configured = takealot?.configured;
  const baseText = configured
    ? `Configured against ${takealot.baseUrl}`
    : "Missing TAKEALOT_API_KEY in .env";
  qs("#takealot-status").textContent = message || baseText;
  renderStatusPill("#takealot-pill", configured ? "Connected" : "Missing", configured);
  qs("#sync-takealot").disabled = !configured;
  qs("#test-takealot").disabled = !configured;
  const takealotSynced = qs("#takealot-synced");
  if (takealotSynced) takealotSynced.textContent = takealot?.lastSynced ? `Last synced ${timeAgo(takealot.lastSynced)}` : "";

  const amazon = state.integrations.amazon;
  if (amazon) {
    const missing = [
      ["refresh token", amazon.hasRefreshToken],
      ["client id", amazon.hasClientId],
      ["client secret", amazon.hasClientSecret],
      ["marketplace id", amazon.hasMarketplaceId]
    ].filter((item) => !item[1]).map((item) => item[0]);
    qs("#amazon-status").textContent = amazon.configured
      ? `Configured against ${amazon.baseUrl}`
      : `Missing Amazon ${missing.join(", ")} in .env`;
    renderStatusPill("#amazon-pill", amazon.configured ? "Ready" : "Missing", amazon.configured);
    qs("#test-amazon").disabled = !amazon.configured;
    qs("#sync-amazon").disabled = !amazon.configured;
    qs("#sync-amazon-fees").disabled = !amazon.configured;
    qs("#backfill-amazon").disabled = !amazon.configured;
    const amazonSynced = qs("#amazon-synced");
    if (amazonSynced) amazonSynced.textContent = amazon.lastSynced ? `Last synced ${timeAgo(amazon.lastSynced)}` : "";
  }

  const nextSync = qs("#next-sync-time");
  if (nextSync) nextSync.textContent = nextSyncTime();
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function nextSyncTime() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

function renderStatusPill(selector, label, good) {
  const pill = qs(selector);
  pill.textContent = label;
  pill.classList.toggle("ok", Boolean(good));
  pill.classList.toggle("warn", !good);
}

async function testTakealot() {
  renderIntegrationStatus("Testing Takealot connection...");
  try {
    const result = await api("/api/integrations/takealot/test");
    renderIntegrationStatus(result.message);
  } catch (error) {
    renderIntegrationStatus(error.message);
  }
}

async function syncTakealot() {
  renderIntegrationStatus("Syncing Takealot API data...");
  try {
    const params = new URLSearchParams();
    const from = qs("#from-date").value;
    const to = qs("#to-date").value;
    if (from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    const result = await api(`/api/integrations/takealot/sync?${params}`, { method: "POST" });
    const range = result.salesDateRange?.from && result.salesDateRange?.to
      ? ` for ${result.salesDateRange.from} to ${result.salesDateRange.to}`
      : "";
    renderIntegrationStatus(`${result.message}${range}. Offers imported ${result.offers.imported}, offers updated ${result.offers.updated}, sales imported ${result.sales.imported}, sales updated ${result.sales.updated}.`);
    await load();
    await refreshReport();
  } catch (error) {
    renderIntegrationStatus(error.message);
  }
}

async function testAmazon() {
  qs("#amazon-status").textContent = "Testing Amazon SP-API connection...";
  try {
    const result = await api("/api/integrations/amazon/test");
    qs("#amazon-status").textContent = result.message;
  } catch (error) {
    qs("#amazon-status").textContent = error.message;
  }
}

async function syncAmazon() {
  qs("#amazon-status").textContent = "Syncing Amazon API data...";
  try {
    const params = new URLSearchParams();
    const from = qs("#from-date").value;
    const to = qs("#to-date").value;
    if (from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    const result = await api(`/api/integrations/amazon/sync?${params}`, { method: "POST" });
    const range = result.salesDateRange?.from && result.salesDateRange?.to
      ? ` for ${result.salesDateRange.from} to ${result.salesDateRange.to}`
      : "";
    qs("#amazon-status").textContent = `${result.message}${range}. Sales imported ${result.sales.imported}, sales updated ${result.sales.updated}.`;
    await load();
    await refreshReport();
  } catch (error) {
    qs("#amazon-status").textContent = error.message;
  }
}

async function syncAmazonFees() {
  qs("#amazon-status").textContent = "Syncing Amazon fee data...";
  try {
    const params = new URLSearchParams();
    const from = qs("#from-date").value;
    const to = qs("#to-date").value;
    if (from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    const result = await api(`/api/integrations/amazon/fees?${params}`, { method: "POST" });
    const range = result.salesDateRange?.from && result.salesDateRange?.to
      ? ` for ${result.salesDateRange.from} to ${result.salesDateRange.to}`
      : "";
    qs("#amazon-status").textContent = `${result.message}${range}. Fees updated ${result.fees.updated}, unmatched ${result.fees.unmatched}, total ${currency.format(result.fees.totalFees || 0)}.`;
    await load();
    await refreshReport();
  } catch (error) {
    qs("#amazon-status").textContent = error.message;
  }
}

async function backfillAmazon() {
  qs("#amazon-status").textContent = "Backfilling Amazon report data...";
  try {
    const params = new URLSearchParams();
    const from = qs("#from-date").value;
    const to = qs("#to-date").value;
    if (from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    const result = await api(`/api/integrations/amazon/backfill?${params}`, { method: "POST" });
    const range = result.salesDateRange?.from && result.salesDateRange?.to
      ? ` for ${result.salesDateRange.from} to ${result.salesDateRange.to}`
      : "";
    qs("#amazon-status").textContent = `${result.message}${range}. Sales imported ${result.sales.imported}, sales updated ${result.sales.updated}.`;
    await load();
    await refreshReport();
  } catch (error) {
    qs("#amazon-status").textContent = error.message;
  }
}

async function importCsv() {
  const input = qs("#csv-file");
  const file = input.files?.[0];
  if (!file) {
    qs("#csv-status").textContent = "Choose a CSV file first.";
    return;
  }

  qs("#csv-status").textContent = `Reading ${file.name}...`;
  try {
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      qs("#csv-status").textContent = "CSV contains no data rows.";
      return;
    }
    qs("#csv-status").textContent = `Importing ${rows.length} CSV rows...`;
    const result = await api("/api/import/csv", {
      method: "POST",
      body: JSON.stringify({ rows, source: file.name })
    });
    const feeNote = result.fees?.rowsMissingFees > 0
      ? ` Fees missing on ${result.fees.rowsMissingFees} imported row(s).`
      : "";
    qs("#csv-status").textContent = `CSV imported. Suppliers ${result.suppliers?.imported ?? 0}, products ${result.products.imported}, listings ${result.listings.imported}, sales imported ${result.transactions.imported}, updated ${result.transactions.updated}, skipped ${result.skipped}.${feeNote}`;
    input.value = "";
    await load();
    await refreshReport();
  } catch (error) {
    qs("#csv-status").textContent = error.message;
  }
}

function exportSalesCsv() {
  salesReport.mode = qs("#sales-report-mode").value;
  const config = salesReportConfig();
  const columns = visibleSalesColumns(config);
  const rows = getSortedSalesRows(getFilteredSalesRows(config.rows));
  const csv = [
    columns.map((column) => csvValue(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(exportSalesValue(row, column.key))).join(","))
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${salesReport.mode}-sales-${formatLocalDate(new Date())}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportSalesValue(item, key) {
  if (["returnedValue", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"].includes(key)) return Number(item[key] || 0).toFixed(2);
  if (key === "marketplaces") return (item.marketplaces || []).join(" | ");
  return item[key] ?? "";
}

function fillMarketplaceSelects() {
  const options = state.marketplaces.map((marketplace) => option(marketplace.id, marketplace.name)).join("");
  qsa('select[name="marketplaceId"]').forEach((select) => {
    select.innerHTML = options;
  });
  qs("#marketplace-filter").innerHTML = `<option value="">All marketplaces</option>${options}`;
}

function fillSupplierSelects() {
  qsa('select[name="supplierId"]').forEach((select) => {
    select.innerHTML = state.suppliers.map((supplier) => option(supplier.id, supplier.name)).join("");
  });
}

function fillProductSelects() {
  qsa('select[name="productId"]').forEach((select) => {
    select.innerHTML = state.products.map((product) => option(product.id, `${product.name} (${product.sku})`)).join("");
  });
  qs("#merge-target").innerHTML = state.products.map((product) => option(product.id, `${product.name} (${product.sku})`)).join("");
}

function fillListingSelects() {
  qsa('select[name="listingId"]').forEach((select) => {
    select.innerHTML = state.listings.map((listing) => {
      const product = state.products.find((item) => item.id === listing.productId);
      const marketplace = state.marketplaces.find((item) => item.id === listing.marketplaceId);
      return option(listing.id, `${marketplace?.name ?? listing.marketplaceId} - ${product?.name ?? "Unknown"} - ${listing.marketplaceIdentifier}`);
    }).join("");
  });
}

function renderProducts() {
  renderProductTableHead();
  applyTableWidth("product", visibleProductColumns, qs(".product-table"));
  const products = getSortedProducts();
  qs("#product-list").innerHTML = products.map((product) => {
    const mappings = state.listings.filter((listing) => listing.productId === product.id);
    const summary = productSummaryMap.get(product.id) || {};
    const stock = productStockOnHand(mappings);
    const marketplaceNames = [...new Set(mappings.map((listing) => listing.marketplaceId))].join(", ");
    const identifiers = mappings.map((listing) => `${listing.marketplaceId} ${listing.identifierType}: ${listing.marketplaceIdentifier}`).join(" | ");
    const cells = {
      merge: productCell("merge", `<input type="checkbox" data-merge-source="${escapeHtml(product.id)}" aria-label="Merge ${escapeHtml(product.name)}">`),
      name: productCell("name", `<strong>${escapeHtml(product.name)}</strong>`),
      sku: productCell("sku", escapeHtml(product.sku)),
      supplier: productCell("supplier", `
        <select data-product-supplier="${escapeHtml(product.id)}">
          <option value="">Unassigned</option>
          ${state.suppliers.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === product.supplierId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select>
      `),
      cost: productCell("cost", currency.format(product.cost)),
      marketplaces: productCell("marketplaces", escapeHtml(marketplaceNames || "None")),
      stockOnHand: productCell("stockOnHand", formatStockCell(stock)),
      identifiers: productCell("identifiers", escapeHtml(identifiers || "No marketplace identifiers"), "compact-cell"),
      lastSale: productCell("lastSale", escapeHtml(summary.latestSaleDate || "")),
      units: productCell("units", summary.units ?? 0),
      returnedUnits: productCell("returnedUnits", summary.returnedUnits ?? 0),
      returnedValue: productCell("returnedValue", currency.format(summary.returnedValue ?? 0)),
      cancelledUnits: productCell("cancelledUnits", summary.cancelledUnits ?? 0),
      grossSales: productCell("grossSales", currency.format(summary.grossSales ?? 0)),
      marketplaceFees: productCell("marketplaceFees", currency.format(summary.marketplaceFees ?? 0)),
      netSales: productCell("netSales", currency.format(summary.netSales ?? 0)),
      estimatedProfit: productCell("estimatedProfit", currency.format(summary.estimatedProfit ?? 0)),
      dateCreated: productCell("dateCreated", escapeHtml(getProductDateCreated(product, mappings) || "")),
      source: productCell("source", escapeHtml(product.source || "local"))
    };
    return `<tr>${visibleProductColumns.map((columnId) => cells[columnId]).join("")}</tr>`;
  }).join("") || `<tr><td class="empty-cell" colspan="${visibleProductColumns.length}">No products match this search.</td></tr>`;
}

function renderProductTableHead() {
  qs("#product-table-head").innerHTML = visibleProductColumns
    .map((columnId) => {
      const column = productColumns.find((item) => item.id === columnId);
      const label = column?.label ?? columnId;
      const sortable = columnId !== "merge";
      return `<th class="${columnClass("product", columnId)}" data-column-scope="product" data-column-id="${escapeHtml(columnId)}" ${columnWidthStyle("product", columnId)}>${sortable ? `<button class="sort-header" data-product-sort="${escapeHtml(columnId)}">${formatSortLabel(label, productSort.key === columnId ? productSort.direction : "")}</button>` : escapeHtml(label)}${columnResizeHandle("product", columnId)}</th>`;
    })
    .join("");
}

function productCell(columnId, content, extraClass = "") {
  return `<td class="${[columnClass("product", columnId), extraClass].filter(Boolean).join(" ")}" ${columnWidthStyle("product", columnId)}>${content}</td>`;
}

function renderProductColumnPicker() {
  qs("#density-control").value = productRowSize;
  qs("#product-row-size").value = productRowSize;
  qs("#product-column-list").innerHTML = productColumns.map((column) => `
    <label class="check-option">
      <input type="checkbox" data-product-column="${escapeHtml(column.id)}" ${visibleProductColumns.includes(column.id) ? "checked" : ""}>
      ${escapeHtml(column.label)}
    </label>
  `).join("");
}

function loadProductColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem("productColumns") || "[]");
    const validIds = productColumns.map((column) => column.id);
    const visible = saved.filter((id) => validIds.includes(id));
    if (visible.length > 0) return ensureRequiredProductColumns(visible);
  } catch {
    // Ignore invalid saved preferences.
  }
  return productColumns.filter((column) => column.defaultVisible).map((column) => column.id);
}

function ensureRequiredProductColumns(columns) {
  let next = insertColumnAfter(insertColumnAfter(columns, "returnedUnits", "units"), "returnedValue", "returnedUnits");
  return insertColumnAfter(next, "netSales", "marketplaceFees");
}

function saveProductColumns() {
  localStorage.setItem("productColumns", JSON.stringify(visibleProductColumns));
}

function resetProductColumns() {
  visibleProductColumns = productColumns.filter((column) => column.defaultVisible).map((column) => column.id);
  saveProductColumns();
  renderProducts();
}

function loadProductRowSize() {
  return loadDensity();
}

function loadDensity() {
  const saved = localStorage.getItem("tableDensity") || localStorage.getItem("productRowSize");
  return ["compact", "default", "roomy"].includes(saved) ? saved : "compact";
}

function saveProductRowSize() {
  saveDensity();
}

function saveDensity() {
  localStorage.setItem("tableDensity", productRowSize);
  localStorage.setItem("productRowSize", productRowSize);
}

function applyProductTableDisplay() {
  const table = qs(".product-table");
  applyTableWidth("product", visibleProductColumns, table);
  document.body.classList.toggle("density-compact", productRowSize === "compact");
  document.body.classList.toggle("density-roomy", productRowSize === "roomy");
  table.classList.toggle("row-compact", productRowSize === "compact");
  table.classList.toggle("row-roomy", productRowSize === "roomy");
}

function getSortedProducts() {
  const direction = productSort.direction === "asc" ? 1 : -1;
  return getFilteredProducts().sort((a, b) => {
    const left = productValue(a, productSort.key);
    const right = productValue(b, productSort.key);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return String(a.name).localeCompare(String(b.name));
  });
}

function getFilteredProducts() {
  if (!productSearchQuery) return [...state.products];
  return state.products.filter((product) => productSearchText(product).includes(productSearchQuery));
}

function productSearchText(product) {
  const mappings = state.listings.filter((listing) => listing.productId === product.id);
  const supplier = state.suppliers.find((item) => item.id === product.supplierId);
  return [
    product.name,
    product.sku,
    supplier?.name,
    product.source,
    ...mappings.flatMap((listing) => [
      listing.marketplaceId,
      listing.identifierType,
      listing.marketplaceIdentifier,
      listing.marketplaceSku,
      listing.title
    ])
  ].filter(Boolean).join(" ").toLowerCase();
}

function productValue(product, key) {
  const mappings = state.listings.filter((listing) => listing.productId === product.id);
  const supplier = state.suppliers.find((item) => item.id === product.supplierId);
  const summary = productSummaryMap.get(product.id) || {};
  if (key === "supplier") return String(supplier?.name ?? "").toLowerCase();
  if (key === "cost") return Number(product.cost) || 0;
  if (key === "marketplaces") return [...new Set(mappings.map((listing) => listing.marketplaceId))].join(", ").toLowerCase();
  if (key === "identifiers") return mappings.map((listing) => listing.marketplaceIdentifier).join(" | ").toLowerCase();
  if (key === "dateCreated") return getProductDateCreated(product, mappings);
  if (key === "stockOnHand") return productStockOnHand(mappings).total ?? -1;
  if (key === "lastSale") return summary.latestSaleDate || "";
  if (["units", "returnedUnits", "returnedValue", "cancelledUnits", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"].includes(key)) {
    return Number(summary[key]) || 0;
  }
  return String(product[key] ?? "").toLowerCase();
}


function isReturnedTransaction(transaction) {
  return String(transaction.saleStatus || transaction.apiData?.saleStatus || "").toLowerCase().includes("return");
}

function isCancelledTransaction(transaction) {
  return String(transaction.saleStatus || transaction.apiData?.saleStatus || "").toLowerCase().includes("cancel");
}

function getProductDateCreated(product, mappings = []) {
  const dates = mappings
    .map((listing) => listing.apiData?.dateCreated)
    .filter(Boolean)
    .sort();
  return dates[0] || product.createdAt || "";
}

function productStockOnHand(mappings) {
  let total = null;
  const dcMap = new Map();
  let onWay = null;
  for (const listing of mappings) {
    if (listing.marketplaceId !== "takealot") continue;
    const apiData = listing.apiData || {};
    const stock = apiData.stockAtTakealotTotal;
    if (stock !== null && stock !== undefined) {
      total = (total ?? 0) + Number(stock);
    }
    for (const dc of (apiData.stockAtTakealot || [])) {
      const name = dc.warehouse?.name ?? dc.dc ?? "Unknown";
      const qty = Number(dc.quantity_available ?? 0);
      dcMap.set(name, (dcMap.get(name) ?? 0) + qty);
    }
    const ow = apiData.totalStockOnWay;
    if (ow !== null && ow !== undefined) {
      onWay = (onWay ?? 0) + Number(ow);
    }
  }
  return { total, dcBreakdown: [...dcMap.entries()], onWay };
}

function formatStockCell(stock) {
  if (stock.total === null) return "—";
  const lines = [];
  for (const [dc, qty] of stock.dcBreakdown) {
    lines.push(`${dc}: ${qty}`);
  }
  if (stock.onWay !== null && stock.onWay > 0) {
    lines.push(`On Way: ${stock.onWay}`);
  }
  const tooltip = lines.length > 0 ? ` title="${escapeHtml(lines.join("\n"))}"` : "";
  return `<span${tooltip}>${escapeHtml(String(stock.total))}</span>`;
}

function renderSuppliers() {
  qs("#supplier-list").innerHTML = state.suppliers.map((supplier) => {
    const assignedCount = state.products.filter((product) => product.supplierId === supplier.id).length;
    return `
      <article class="list-item">
        <form data-supplier-form="${escapeHtml(supplier.id)}" class="inline-edit">
          <label>
            Supplier name
            <input name="name" value="${escapeHtml(supplier.name)}" required>
          </label>
          <button type="submit">Save</button>
          <button type="button" class="danger" data-delete-supplier="${escapeHtml(supplier.id)}">Delete</button>
        </form>
        <span class="meta">${assignedCount} assigned products</span>
      </article>
    `;
  }).join("") || '<article class="list-item"><span class="meta">No suppliers yet.</span></article>';
}

async function renameSupplier(supplierId, name) {
  await api(`/api/suppliers/${encodeURIComponent(supplierId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
  });
  await load();
  await refreshReport();
}

async function deleteSupplier(supplierId) {
  const supplier = state.suppliers.find((item) => item.id === supplierId);
  const assignedCount = state.products.filter((product) => product.supplierId === supplierId).length;
  const confirmed = confirm(`Delete supplier "${supplier?.name ?? "supplier"}"? ${assignedCount} assigned products will become unassigned.`);
  if (!confirmed) return;

  await api(`/api/suppliers/${encodeURIComponent(supplierId)}`, { method: "DELETE" });
  await load();
  await refreshReport();
}

async function mergeSelectedProducts() {
  const targetProductId = qs("#merge-target").value;
  const sourceProductIds = qsa("[data-merge-source]:checked")
    .map((input) => input.dataset.mergeSource)
    .filter((productId) => productId !== targetProductId);

  if (!targetProductId || sourceProductIds.length === 0) {
    alert("Choose a master product and tick at least one different product to merge into it.");
    return;
  }

  const target = state.products.find((product) => product.id === targetProductId);
  const confirmed = confirm(`Merge ${sourceProductIds.length} product(s) into "${target?.name ?? "selected product"}"? Listings and sales will move to the master product.`);
  if (!confirmed) return;

  await api("/api/products/merge", {
    method: "POST",
    body: JSON.stringify({ targetProductId, sourceProductIds })
  });
  await load();
  await refreshReport();
}

async function assignProductSupplier(productId, supplierId) {
  const product = state.products.find((item) => item.id === productId);
  if (product) product.supplierId = supplierId || null;
  renderProductTableHead();

  const updatedProduct = await api(`/api/products/${encodeURIComponent(productId)}/supplier`, {
    method: "PATCH",
    body: JSON.stringify({ supplierId })
  });
  if (product) product.supplierId = updatedProduct.supplierId;
  fillProductSelects();
  await refreshReport();
}

function renderListings() {
  qs("#listing-list").innerHTML = state.listings.map((listing) => {
    const product = state.products.find((item) => item.id === listing.productId);
    const marketplace = state.marketplaces.find((item) => item.id === listing.marketplaceId);
    return `
      <article class="list-item">
        <strong>${escapeHtml(product?.name ?? "Unknown product")}</strong>
        <span class="meta">${escapeHtml(marketplace?.name ?? listing.marketplaceId)} · ${escapeHtml(listing.identifierType)} ${escapeHtml(listing.marketplaceIdentifier)} · SKU ${escapeHtml(listing.marketplaceSku || "n/a")}</span>
        <span>${escapeHtml(listing.title || "No marketplace title")}</span>
      </article>
    `;
  }).join("");
}

function renderSummary() {
  const totals = state.summary.reduce((acc, item) => {
    acc.units += item.units;
    acc.returnedUnits += item.returnedUnits || 0;
    acc.grossSales += item.grossSales;
    acc.marketplaceFees += item.marketplaceFees;
    acc.estimatedProfit += item.estimatedProfit;
    return acc;
  }, { units: 0, returnedUnits: 0, grossSales: 0, marketplaceFees: 0, estimatedProfit: 0 });

  qs("#metric-sales").textContent = currency.format(totals.grossSales);
  qs("#metric-fees").textContent = currency.format(totals.marketplaceFees);
  qs("#metric-profit").textContent = currency.format(totals.estimatedProfit);
  qs("#metric-units").textContent = totals.units;
  qs("#fee-status").textContent = totals.marketplaceFees > 0
    ? "Fees shown are imported from connected marketplace data."
    : "No fee/commission source is connected yet. Takealot sales API does not provide seller fee amounts in the synced sales data.";

  renderMarketplaceMetrics();
  renderTopProducts();
}

function renderMarketplaceMetrics() {
  const container = qs("#marketplace-metrics");
  if (!container) return;
  const rows = state.marketplaceSummary || [];
  container.innerHTML = rows.map((item) => {
    const mp = (state.marketplaces || []).find((m) => m.id === item.marketplaceId);
    return `
      <article>
        <span>${escapeHtml(mp?.name ?? item.marketplaceId)}</span>
        <strong>${currency.format(item.grossSales)}</strong>
        <small>${item.units} units &middot; ${currency.format(item.estimatedProfit)} profit</small>
      </article>`;
  }).join("") || "";
}

function renderTopProducts() {
  const container = qs("#top-products-list");
  if (!container) return;
  const top = [...(state.summary || [])].sort((a, b) => b.grossSales - a.grossSales).slice(0, 10);
  container.innerHTML = top.map((item, i) => `
    <tr>
      <td>${i + 1}. ${escapeHtml(item.productName)}</td>
      <td>${escapeHtml(item.supplierName || "—")}</td>
      <td style="text-align:right">${item.units}</td>
      <td style="text-align:right">${currency.format(item.grossSales)}</td>
      <td style="text-align:right">${currency.format(item.estimatedProfit)}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="empty-cell">No sales data yet.</td></tr>`;
}

function renderSalesReport() {
  try {
    salesReport.mode = qs("#sales-report-mode").value;
    const config = salesReportConfig();
    ensureSalesColumnsForMode(config);
    qs("#sales-report-title").textContent = config.title;
    const visibleColumns = visibleSalesColumns(config);
    applyTableWidth("sales", visibleColumns.map((column) => column.key), qs(".sales-table"));
    renderSalesColumnPicker(config);
    qs("#sales-report-head").innerHTML = visibleColumns.map((column) => (
      `<th class="${columnClass("sales", column.key)}" data-column-scope="sales" data-column-id="${escapeHtml(column.key)}" ${columnWidthStyle("sales", column.key)}><button class="sort-header" data-sales-sort="${escapeHtml(column.key)}">${formatSortLabel(column.label, salesReport.sortKey === column.key ? salesReport.sortDirection : "")}</button>${columnResizeHandle("sales", column.key)}</th>`
    )).join("");
    qs("#sales-report-table").innerHTML = getSortedSalesRows(getFilteredSalesRows(config.rows)).map((item) => (
      `<tr>${visibleColumns.map((column) => `<td class="${columnClass("sales", column.key)}" ${columnWidthStyle("sales", column.key)}>${formatSalesCell(item, column.key)}</td>`).join("")}</tr>`
    )).join("") || `<tr><td class="empty-cell" colspan="${visibleColumns.length}">No sales match this report filter.</td></tr>`;
  } catch (error) {
    qs("#sales-report-title").textContent = "Sales Report Error";
    qs("#sales-report-head").innerHTML = "";
    qs("#sales-report-table").innerHTML = `<tr><td class="empty-cell">Could not render ${escapeHtml(salesReport.mode)} report: ${escapeHtml(error.message)}</td></tr>`;
    throw error;
  }
}

function salesReportConfig() {
  const common = [
    { key: "latestSaleDate", label: "Latest Sale" },
    { key: "productCount", label: "Products" },
    { key: "units", label: "Units" },
    { key: "returnedUnits", label: "Returns" },
    { key: "returnedValue", label: "Returns Value" },
    { key: "grossSales", label: "Gross" },
    { key: "marketplaceFees", label: "Imported Fees" },
    { key: "netSales", label: "Net Sales" },
    { key: "estimatedProfit", label: "Profit" }
  ];
  if (salesReport.mode === "marketplace") {
    return {
      title: "Sales By Marketplace",
      rows: state.marketplaceSummary,
      columns: [{ key: "marketplaceId", label: "Marketplace" }, ...common]
    };
  }
  if (salesReport.mode === "supplier-marketplace") {
    return {
      title: "Sales By Supplier + Marketplace",
      rows: state.supplierMarketplaceSummary,
      columns: [
        { key: "supplierName", label: "Supplier" },
        { key: "marketplaceId", label: "Marketplace" },
        ...common
      ]
    };
  }
  return {
    title: "Sales By Supplier",
    rows: state.supplierSummary,
    columns: [
      { key: "supplierName", label: "Supplier" },
      { key: "marketplaces", label: "Marketplaces" },
      ...common
    ]
  };
}

function visibleSalesColumns(config) {
  ensureSalesColumnsForMode(config);
  const saved = salesReportColumns[salesReport.mode];
  const columnsByKey = new Map(config.columns.map((column) => [column.key, column]));
  return saved.map((key) => columnsByKey.get(key)).filter(Boolean);
}

function ensureSalesColumnsForMode(config) {
  const validKeys = config.columns.map((column) => column.key);
  const saved = salesReportColumns[salesReport.mode];
  if (!Array.isArray(saved)) {
    salesReportColumns[salesReport.mode] = defaultSalesColumns[salesReport.mode] ?? validKeys;
    return;
  }
  const visibleKeys = saved.filter((key) => validKeys.includes(key));
  const fallbackKeys = (defaultSalesColumns[salesReport.mode] ?? validKeys).filter((key) => validKeys.includes(key));
  salesReportColumns[salesReport.mode] = ensureRequiredSalesColumns(visibleKeys.length > 0 ? visibleKeys : fallbackKeys, validKeys);
}

function ensureRequiredSalesColumns(columns, validKeys) {
  let nextColumns = [...columns];
  const required = requiredSalesColumns[salesReport.mode] ?? [];
  for (const columnId of [...required].reverse()) {
    if (validKeys.includes(columnId) && !nextColumns.includes(columnId)) {
      nextColumns.unshift(columnId);
    }
  }
  if (!validKeys.includes("returnedUnits")) return nextColumns;
  nextColumns = insertColumnAfter(nextColumns, "returnedUnits", "units");
  return insertColumnAfter(nextColumns, "returnedValue", "returnedUnits");
}

function insertColumnAfter(columns, columnId, afterColumnId) {
  if (columns.includes(columnId)) return columns;
  const nextColumns = [...columns];
  const afterIndex = nextColumns.indexOf(afterColumnId);
  nextColumns.splice(afterIndex >= 0 ? afterIndex + 1 : nextColumns.length, 0, columnId);
  return nextColumns;
}

function renderSalesColumnPicker(config) {
  const visibleKeys = visibleSalesColumns(config).map((column) => column.key);
  qs("#sales-column-list").innerHTML = config.columns.map((column) => `
    <label class="check-option">
      <input type="checkbox" data-sales-column="${escapeHtml(column.key)}" ${visibleKeys.includes(column.key) ? "checked" : ""}>
      ${escapeHtml(column.label)}
    </label>
  `).join("");
}

function loadSalesReportColumns() {
  try {
    if (localStorage.getItem("salesReportColumnsVersion") !== salesColumnStorageVersion) {
      localStorage.setItem("salesReportColumnsVersion", salesColumnStorageVersion);
      localStorage.removeItem("salesReportColumns");
      return {};
    }
    const saved = JSON.parse(localStorage.getItem("salesReportColumns") || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveSalesReportColumns() {
  localStorage.setItem("salesReportColumns", JSON.stringify(salesReportColumns));
}

function resetSalesColumns() {
  const config = salesReportConfig();
  salesReportColumns[salesReport.mode] = [...(defaultSalesColumns[salesReport.mode] ?? config.columns.map((column) => column.key))];
  ensureSalesColumnsForMode(config);
  saveSalesReportColumns();
  renderSalesReport();
}

function columnResizeHandle(scope, columnId) {
  return `<span class="column-resize-handle" data-column-resize data-column-scope="${escapeHtml(scope)}" data-column-id="${escapeHtml(columnId)}" title="Drag to resize"></span>`;
}

function startColumnResize(event) {
  const handle = event.target.closest("[data-column-resize]");
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  activeColumnResize = {
    scope: handle.dataset.columnScope,
    columnId: handle.dataset.columnId,
    startX: event.clientX,
    startWidth: getColumnWidth(handle.dataset.columnScope, handle.dataset.columnId)
  };
  document.body.classList.add("column-resizing");
  window.addEventListener("pointermove", moveColumnResize);
  window.addEventListener("pointerup", endColumnResize, { once: true });
}

function moveColumnResize(event) {
  if (!activeColumnResize) return;
  const nextWidth = activeColumnResize.startWidth + event.clientX - activeColumnResize.startX;
  setColumnWidth(activeColumnResize.scope, activeColumnResize.columnId, nextWidth);
  rerenderColumnWidthTable(activeColumnResize.scope);
}

function endColumnResize() {
  activeColumnResize = null;
  document.body.classList.remove("column-resizing");
  window.removeEventListener("pointermove", moveColumnResize);
}

function startColumnDrag(event) {
  if (event.button !== 0 || event.target.closest("[data-column-resize]")) return;
  const header = event.target.closest("th[data-column-id]");
  if (!header) return;
  const scope = header.dataset.columnScope;
  const columnId = header.dataset.columnId;
  if (scope === "product" && lockedProductColumns.includes(columnId)) return;

  activeColumnDrag = {
    scope,
    columnId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    sourceHeader: header
  };
  window.addEventListener("pointermove", moveColumnDrag);
  window.addEventListener("pointerup", endColumnDrag, { once: true });
}

function moveColumnDrag(event) {
  if (!activeColumnDrag) return;
  const distance = Math.abs(event.clientX - activeColumnDrag.startX) + Math.abs(event.clientY - activeColumnDrag.startY);
  if (distance < 8) return;

  activeColumnDrag.moved = true;
  suppressNextHeaderClick = true;
  document.body.classList.add("column-dragging");
  activeColumnDrag.sourceHeader.classList.add("column-drag-source");

  qsa("th.column-drag-target").forEach((header) => header.classList.remove("column-drag-target"));
  const targetHeader = document.elementFromPoint(event.clientX, event.clientY)?.closest("th[data-column-id]");
  if (!targetHeader || targetHeader.dataset.columnScope !== activeColumnDrag.scope) return;
  if (activeColumnDrag.scope === "product" && lockedProductColumns.includes(targetHeader.dataset.columnId)) return;
  if (targetHeader.dataset.columnId !== activeColumnDrag.columnId) targetHeader.classList.add("column-drag-target");
}

function endColumnDrag(event) {
  if (!activeColumnDrag) return;
  const drag = activeColumnDrag;
  const targetHeader = document.elementFromPoint(event.clientX, event.clientY)?.closest("th[data-column-id]");
  activeColumnDrag = null;
  document.body.classList.remove("column-dragging");
  qsa(".column-drag-source, .column-drag-target").forEach((header) => header.classList.remove("column-drag-source", "column-drag-target"));
  window.removeEventListener("pointermove", moveColumnDrag);

  if (!drag.moved || !targetHeader || targetHeader.dataset.columnScope !== drag.scope) return;
  const targetColumnId = targetHeader.dataset.columnId;
  if (!targetColumnId || targetColumnId === drag.columnId) return;
  if (drag.scope === "product" && lockedProductColumns.includes(targetColumnId)) return;
  const targetRect = targetHeader.getBoundingClientRect();
  const insertAfter = event.clientX > targetRect.left + targetRect.width / 2;
  reorderColumn(drag.scope, drag.columnId, targetColumnId, insertAfter);
}

function reorderColumn(scope, sourceColumnId, targetColumnId, insertAfter = false) {
  if (scope === "sales") {
    const columns = moveColumn(salesReportColumns[salesReport.mode], sourceColumnId, targetColumnId, insertAfter);
    salesReportColumns[salesReport.mode] = columns;
    saveSalesReportColumns();
    renderSalesReport();
    return;
  }

  const unlocked = visibleProductColumns.filter((columnId) => !lockedProductColumns.includes(columnId));
  const reordered = moveColumn(unlocked, sourceColumnId, targetColumnId, insertAfter);
  visibleProductColumns = [
    ...lockedProductColumns.filter((columnId) => visibleProductColumns.includes(columnId)),
    ...reordered
  ];
  saveProductColumns();
  renderProducts();
}

function moveColumn(columns, sourceColumnId, targetColumnId, insertAfter = false) {
  const nextColumns = columns.filter((columnId) => columnId !== sourceColumnId);
  const targetIndex = nextColumns.indexOf(targetColumnId);
  if (targetIndex === -1) return columns;
  nextColumns.splice(targetIndex + (insertAfter ? 1 : 0), 0, sourceColumnId);
  return nextColumns;
}

function rerenderColumnWidthTable(scope) {
  if (scope === "sales") {
    renderSalesReport();
    return;
  }
  renderProducts();
}

function widthStorageKey(scope, columnId) {
  const tableKey = scope === "sales" ? `sales:${salesReport.mode}` : "products";
  return `${tableKey}:${columnId}`;
}

function getColumnWidth(scope, columnId) {
  const key = widthStorageKey(scope, columnId);
  return tableColumnWidths[key] || defaultColumnWidths[scope]?.[columnId] || 100;
}

function setColumnWidth(scope, columnId, value) {
  const width = Math.max(50, Math.min(900, Number(value) || getColumnWidth(scope, columnId)));
  tableColumnWidths[widthStorageKey(scope, columnId)] = width;
  saveTableColumnWidths();
}

function resetColumnWidth(scope, columnId) {
  delete tableColumnWidths[widthStorageKey(scope, columnId)];
  saveTableColumnWidths();
}

function resetTableColumnWidths(scope) {
  const prefix = scope === "sales" ? `sales:${salesReport.mode}:` : "products:";
  Object.keys(tableColumnWidths)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => delete tableColumnWidths[key]);
  saveTableColumnWidths();
  rerenderColumnWidthTable(scope);
}

function columnWidthStyle(scope, columnId) {
  const width = getColumnWidth(scope, columnId);
  const totalWidth = activeTableWidthTotals[scope] || width;
  const percentage = totalWidth > 0 ? (width / totalWidth) * 100 : 0;
  return `style="width: ${percentage.toFixed(4)}%;"`;
}

function applyTableWidth(scope, columnIds, table) {
  if (!table) return;
  activeTableWidthTotals[scope] = columnIds.reduce((sum, columnId) => sum + getColumnWidth(scope, columnId), 0);
  table.style.width = "100%";
  table.style.minWidth = "0";
  table.style.maxWidth = "100%";
}

function loadTableColumnWidths() {
  try {
    localStorage.removeItem("tableColumnWidths");
    return JSON.parse(localStorage.getItem(tableColumnWidthsStorageKey) || "{}");
  } catch {
    return {};
  }
}

function saveTableColumnWidths() {
  localStorage.setItem(tableColumnWidthsStorageKey, JSON.stringify(tableColumnWidths));
}

function getSortedSalesRows(rows) {
  const direction = salesReport.sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = salesValue(a, salesReport.sortKey);
    const right = salesValue(b, salesReport.sortKey);
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return String(a.group || a.productName || a.supplierName || a.marketplaceId).localeCompare(String(b.group || b.productName || b.supplierName || b.marketplaceId));
  });
}

function getFilteredSalesRows(rows) {
  if (!salesSearchQuery) return rows;
  return rows.filter((item) => salesSearchText(item).includes(salesSearchQuery));
}

function salesSearchText(item) {
  return [
    item.group,
    item.productName,
    item.supplierName,
    item.marketplaceId,
    ...(item.marketplaces || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function salesValue(item, key) {
  if (key === "marketplaces") return (item.marketplaces || []).join(", ").toLowerCase();
  if (["productCount", "units", "returnedUnits", "returnedValue", "cancelledUnits", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"].includes(key)) return Number(item[key]) || 0;
  return String(item[key] ?? "").toLowerCase();
}

function formatSalesCell(item, key) {
  if (["returnedValue", "grossSales", "marketplaceFees", "netSales", "estimatedProfit"].includes(key)) return currency.format(item[key] || 0);
  if (key === "marketplaces") return escapeHtml((item.marketplaces || []).join(", "));
  return escapeHtml(item[key] ?? "");
}

function formatSortLabel(label, direction) {
  const arrow = direction === "asc" ? "&larr;" : direction === "desc" ? "&rarr;" : "";
  return `${arrow ? `<span class="sort-arrow">${arrow}</span> ` : ""}${escapeHtml(label)}`;
}

function columnClass(scope, key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `col-${scope}-${normalized}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function option(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function parseCsv(text) {
  const delimiter = detectDelimitedTextSeparator(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  const header = rows.shift()?.map(normalizeCsvHeader) ?? [];
  return rows
    .filter((item) => item.some((value) => String(value).trim()))
    .map((item) => Object.fromEntries(header.map((key, index) => [key, item[index] ?? ""])));
}

function detectDelimitedTextSeparator(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  const separators = [",", "\t", ";"];
  return separators
    .map((separator) => ({ separator, count: countUnquotedSeparator(firstLine, separator) }))
    .sort((a, b) => b.count - a.count)[0]?.separator || ",";
}

function countUnquotedSeparator(line, separator) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === separator) count += 1;
  }
  return count;
}

function normalizeCsvHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
