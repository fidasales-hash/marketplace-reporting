export function buildProductSummary(data, filters = {}) {
  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;
  const productById = new Map(data.products.map((product) => [product.id, product]));
  const supplierById = new Map(data.suppliers.map((supplier) => [supplier.id, supplier]));
  const listingById = new Map(data.listings.map((listing) => [listing.id, listing]));

  const summaries = new Map();

  for (const transaction of data.transactions) {
    const txDate = new Date(transaction.date);
    if (from && txDate < from) continue;
    if (to && txDate > to) continue;

    const listing = listingById.get(transaction.listingId);
    if (!listing) continue;
    if (filters.marketplaceId && listing.marketplaceId !== filters.marketplaceId) continue;

    const product = productById.get(listing.productId);
    if (!product) continue;

    const current = summaries.get(product.id) ?? {
      productId: product.id,
      productName: product.name,
      localSku: product.sku,
      supplierName: supplierById.get(product.supplierId)?.name ?? "Unassigned",
      marketplaces: new Set(),
      identifiers: [],
      units: 0,
      returnedUnits: 0,
      returnedValue: 0,
      cancelledUnits: 0,
      grossSales: 0,
      marketplaceFees: 0,
      productCost: 0,
      netSales: 0,
      estimatedProfit: 0,
      firstSaleDate: transaction.date,
      latestSaleDate: transaction.date
    };

    current.marketplaces.add(listing.marketplaceId);
    current.identifiers.push({
      marketplaceId: listing.marketplaceId,
      type: listing.identifierType,
      value: listing.marketplaceIdentifier
    });
    const tx = summarizeTransaction(transaction);
    current.units += tx.units;
    current.returnedUnits += tx.returnedUnits;
    current.returnedValue += tx.returnedValue;
    current.cancelledUnits += tx.cancelledUnits;
    current.grossSales += tx.grossSales;
    current.marketplaceFees += tx.marketplaceFees;
    current.productCost += (Number(product.cost) || 0) * tx.units;
    current.netSales = current.grossSales - current.returnedValue - current.marketplaceFees;
    current.estimatedProfit = current.netSales - current.productCost;
    if (transaction.date < current.firstSaleDate) current.firstSaleDate = transaction.date;
    if (transaction.date > current.latestSaleDate) current.latestSaleDate = transaction.date;

    summaries.set(product.id, current);
  }

  return Array.from(summaries.values()).map((summary) => ({
    ...summary,
    marketplaces: Array.from(summary.marketplaces),
    identifiers: uniqueIdentifiers(summary.identifiers)
  }));
}

export function buildSupplierSummary(data, filters = {}) {
  const productSummary = buildProductSummary(data, filters);
  const supplierMap = new Map();

  for (const item of productSummary) {
    const supplierName = item.supplierName || "Unassigned";
    const current = supplierMap.get(supplierName) ?? {
      supplierName,
      productCount: 0,
      marketplaces: new Set(),
      units: 0,
      returnedUnits: 0,
      returnedValue: 0,
      cancelledUnits: 0,
      grossSales: 0,
      marketplaceFees: 0,
      productCost: 0,
      netSales: 0,
      estimatedProfit: 0,
      firstSaleDate: item.firstSaleDate,
      latestSaleDate: item.latestSaleDate
    };

    current.productCount += 1;
    for (const marketplace of item.marketplaces) current.marketplaces.add(marketplace);
    current.units += item.units;
    current.returnedUnits += item.returnedUnits || 0;
    current.returnedValue += item.returnedValue || 0;
    current.cancelledUnits += item.cancelledUnits || 0;
    current.grossSales += item.grossSales;
    current.marketplaceFees += item.marketplaceFees;
    current.productCost += item.productCost;
    current.netSales += item.netSales;
    current.estimatedProfit += item.estimatedProfit;
    if (item.firstSaleDate && (!current.firstSaleDate || item.firstSaleDate < current.firstSaleDate)) {
      current.firstSaleDate = item.firstSaleDate;
    }
    if (item.latestSaleDate && (!current.latestSaleDate || item.latestSaleDate > current.latestSaleDate)) {
      current.latestSaleDate = item.latestSaleDate;
    }

    supplierMap.set(supplierName, current);
  }

  return Array.from(supplierMap.values()).map((item) => ({
    ...item,
    marketplaces: Array.from(item.marketplaces)
  }));
}

export function buildMarketplaceSummary(data, filters = {}) {
  return summarizeBy(data, filters, (context) => ({
    key: context.listing.marketplaceId,
    label: context.listing.marketplaceId,
    supplierName: null,
    marketplaceId: context.listing.marketplaceId
  }));
}

export function buildSupplierMarketplaceSummary(data, filters = {}) {
  const supplierById = new Map(data.suppliers.map((supplier) => [supplier.id, supplier]));
  return summarizeBy(data, filters, ({ product, listing }) => {
      const supplierName = supplierById.get(product.supplierId)?.name ?? "Unassigned";
    return {
      key: `${supplierName}::${listing.marketplaceId}`,
      label: `${supplierName} / ${listing.marketplaceId}`,
      supplierName,
      marketplaceId: listing.marketplaceId
    };
  });
}

function summarizeBy(data, filters, groupFor) {
  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;
  const productById = new Map(data.products.map((product) => [product.id, product]));
  const listingById = new Map(data.listings.map((listing) => [listing.id, listing]));
  const groups = new Map();

  for (const transaction of data.transactions) {
    const txDate = new Date(transaction.date);
    if (from && txDate < from) continue;
    if (to && txDate > to) continue;

    const listing = listingById.get(transaction.listingId);
    if (!listing) continue;
    if (filters.marketplaceId && listing.marketplaceId !== filters.marketplaceId) continue;

    const product = productById.get(listing.productId);
    if (!product) continue;

    const group = groupFor({ product, listing, transaction });
    const current = groups.get(group.key) ?? {
      group: group.label,
      supplierName: group.supplierName,
      marketplaceId: group.marketplaceId,
      productIds: new Set(),
      units: 0,
      returnedUnits: 0,
      returnedValue: 0,
      cancelledUnits: 0,
      grossSales: 0,
      marketplaceFees: 0,
      productCost: 0,
      netSales: 0,
      estimatedProfit: 0,
      firstSaleDate: transaction.date,
      latestSaleDate: transaction.date
    };

    current.productIds.add(product.id);
    const tx = summarizeTransaction(transaction);
    current.units += tx.units;
    current.returnedUnits += tx.returnedUnits;
    current.returnedValue += tx.returnedValue;
    current.cancelledUnits += tx.cancelledUnits;
    current.grossSales += tx.grossSales;
    current.marketplaceFees += tx.marketplaceFees;
    current.productCost += (Number(product.cost) || 0) * tx.units;
    current.netSales = current.grossSales - current.returnedValue - current.marketplaceFees;
    current.estimatedProfit = current.netSales - current.productCost;
    if (transaction.date < current.firstSaleDate) current.firstSaleDate = transaction.date;
    if (transaction.date > current.latestSaleDate) current.latestSaleDate = transaction.date;

    groups.set(group.key, current);
  }

  return Array.from(groups.values()).map((item) => ({
    ...item,
    productCount: item.productIds.size,
    productIds: undefined
  }));
}

function uniqueIdentifiers(identifiers) {
  const seen = new Set();
  return identifiers.filter((identifier) => {
    const key = `${identifier.marketplaceId}:${identifier.type}:${identifier.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeTransaction(transaction) {
  const quantity = Number(transaction.quantity) || 0;
  const returned = isReturned(transaction);
  const cancelled = isCancelled(transaction);
  return {
    units: returned || cancelled ? 0 : quantity,
    returnedUnits: returned ? quantity : 0,
    returnedValue: returned ? Number(transaction.grossSales) || 0 : 0,
    cancelledUnits: cancelled ? quantity : 0,
    grossSales: returned || cancelled ? 0 : Number(transaction.grossSales) || 0,
    marketplaceFees: returned || cancelled ? 0 : Number(transaction.marketplaceFees) || 0
  };
}

function isReturned(transaction) {
  const status = String(transaction.saleStatus || transaction.apiData?.saleStatus || "").toLowerCase();
  return status.includes("return");
}

function isCancelled(transaction) {
  const status = String(transaction.saleStatus || transaction.apiData?.saleStatus || "").toLowerCase();
  return status.includes("cancel");
}
