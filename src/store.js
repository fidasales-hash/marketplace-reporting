import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const seed = {
  suppliers: [
    { id: "sup-001", name: "Default Supplier", contact: "supplier@example.com" }
  ],
  products: [
    {
      id: "prd-001",
      name: "Sample Unified Product",
      sku: "LOCAL-SAMPLE-001",
      supplierId: "sup-001",
      cost: 125,
      currency: "ZAR"
    }
  ],
  listings: [
    {
      id: "lst-001",
      productId: "prd-001",
      marketplaceId: "amazon",
      marketplaceIdentifier: "B0SAMPLE001",
      identifierType: "ASIN",
      marketplaceSku: "AMZ-SAMPLE-001",
      title: "Sample Product on Amazon",
      active: true
    },
    {
      id: "lst-002",
      productId: "prd-001",
      marketplaceId: "takealot",
      marketplaceIdentifier: "TSIN000001",
      identifierType: "TSIN",
      marketplaceSku: "TAK-SAMPLE-001",
      title: "Sample Product on Takealot",
      active: true
    }
  ],
  fees: [
    {
      id: "fee-001",
      marketplaceId: "amazon",
      name: "Referral fee",
      feeType: "percentage",
      value: 15,
      appliesTo: "sale"
    },
    {
      id: "fee-002",
      marketplaceId: "takealot",
      name: "Fulfilment fee",
      feeType: "fixed",
      value: 35,
      appliesTo: "unit"
    }
  ],
  transactions: [
    {
      id: "txn-001",
      listingId: "lst-001",
      date: "2026-05-01",
      quantity: 2,
      grossSales: 600,
      marketplaceFees: 90,
      currency: "ZAR"
    },
    {
      id: "txn-002",
      listingId: "lst-002",
      date: "2026-05-02",
      quantity: 1,
      grossSales: 310,
      marketplaceFees: 48,
      currency: "ZAR"
    }
  ]
};

export async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeStore(seed);
  }
}

export async function readStore() {
  await ensureStore();
  const raw = await readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

export async function writeStore(data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
