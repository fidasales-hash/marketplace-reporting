// Takealot has no single "create listing" endpoint or flat CSV like Bob Shop -
// new products go in via category-specific Excel "loadsheets" (My Existing
// Offers > New Offers > Add to Takealot's Catalogue > Add Products in Bulk),
// uploaded through the seller portal for review. Each category group has its
// own template file with its own extra attribute columns; the first 14 columns
// (SKU, category, title, description, brand, colour, what's in the box) are
// identical across every template we've inspected, so that's what this fills.
// Category-specific attributes (materials, shoe width, coffee type, etc.) are
// left blank - optional per Takealot's own instructions.
//
// Template files live in data/takealot-loadsheets/, downloaded from the seller
// portal's "Add Products in Bulk" screen. Add more by downloading the matching
// loadsheet and registering it below with its category tree values (from that
// same file's "Category Tree Lookup" sheet).

import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOADSHEET_DIR = path.resolve(__dirname, "..", "..", "data", "takealot-loadsheets");

export const TAKEALOT_LOADSHEETS = {
  beauty: {
    file: "beauty.xlsm",
    label: "Beauty (Hair Care, Wigs, Fragrances, Makeup)"
  },
  "fashion-footwear": {
    file: "fashion-footwear.xlsm",
    label: "Fashion: Footwear"
  },
  "non-perishable": {
    file: "non-perishable.xlsm",
    label: "Consumables: Non-Perishable (food, sweets, groceries)"
  }
};

const FIRST_DATA_ROW = 7;
const COLUMN_ORDER = [
  "productVariant",
  "sku",
  "productCode",
  "topCategory",
  "category",
  "barcode",
  "title",
  "subtitle",
  "description",
  "brand",
  "whatsInTheBox",
  "colorMain",
  "colorSecondary",
  "colorName"
];

function buildRowValues(product, listing) {
  return {
    productVariant: "Product without Variants",
    sku: product.sku || "",
    productCode: "",
    topCategory: listing.topCategory || "",
    category: listing.category || "",
    barcode: listing.gtin || "",
    title: (listing.title || product.name || "").slice(0, 150),
    subtitle: "",
    description: listing.description || product.description || "",
    brand: product.brand || "",
    whatsInTheBox: listing.whatsInTheBox || "",
    colorMain: listing.colorMain || "",
    colorSecondary: "",
    colorName: ""
  };
}

export async function buildTakealotLoadsheetBuffer(items, loadsheetKey) {
  const entry = TAKEALOT_LOADSHEETS[loadsheetKey];
  if (!entry) throw new Error(`Unknown Takealot loadsheet "${loadsheetKey}".`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(LOADSHEET_DIR, entry.file));

  const sheet = workbook.getWorksheet("Loadsheet");
  if (!sheet) throw new Error(`Loadsheet template "${entry.file}" is missing its "Loadsheet" tab.`);

  items.forEach(({ product, listing }, index) => {
    const values = buildRowValues(product, listing);
    const row = sheet.getRow(FIRST_DATA_ROW + index);
    COLUMN_ORDER.forEach((key, colIndex) => {
      row.getCell(colIndex + 1).value = values[key];
    });
    row.commit();
  });

  return workbook.xlsx.writeBuffer();
}
