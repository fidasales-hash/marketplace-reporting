// Amazon's real "Add Products via Upload" flow needs a category-specific Excel
// template (like Takealot's loadsheets), not a flat CSV - the CSV this adapter
// used to build was never a valid Amazon format. Templates can only be obtained
// by downloading them from a logged-in Seller Central account.
//
// Unlike Takealot's loadsheets, Amazon's column *order* is not stable across
// categories - only the human-readable labels in row 4 and the technical field
// keys in row 5 of the "Template" sheet are consistent in spirit (every
// category has an item_name, a product_description, a condition_type, etc.),
// so columns here are found by matching row 5's key text, never by position.
//
// Row 5 keys embed this account's marketplace id and language tag, e.g.
// `item_name[marketplace_id=AE08WJ6YKNBMC][language_tag=en_ZA]#1.value` -
// matchers below key off the stable prefix/suffix around those brackets rather
// than the full string, so the same code keeps working if a different
// category's template has embedded values.
//
// Row 6 in every downloaded template ships as Amazon's own filled-in example
// (SKU "ABC123") - if left as-is, Amazon's importer treats it as a real product.
// It's fully replaced (not appended after), so nothing survives from the
// template's own example data.
//
// Implementation note: this edits the workbook's zip contents directly
// (via fflate) instead of round-tripping through exceljs like the Takealot
// loadsheet adapter does. Amazon's real templates ship with huge hidden
// "valid values" / dropdown-list sheets (thousands of data-validation entries
// across hundreds of columns) that make exceljs's full object-model parse of
// this file take 10+ minutes (observed hanging past that during development).
// Only the one worksheet ("Template") is parsed and rewritten as text; every
// other part of the archive - styles, the hidden lookup sheets, and the
// embedded VBA macros - is carried through byte-for-byte untouched, which also
// sidesteps the "exceljs drops embedded macros" limitation noted for the
// Takealot loadsheets.
//
// Template files live in data/amazon-templates/, downloaded from Seller
// Central's "Add Products via Upload" > Inventory File screen. Add more by
// downloading that category's template and registering it below.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "..", "..", "data", "amazon-templates");

export const AMAZON_TEMPLATES = {
  shoes: {
    file: "shoes.xlsm",
    label: "Shoes",
    productType: "SHOES"
  }
};

const TEMPLATE_SHEET_NAME = "Template";
const KEY_ROW = 5;
const FIRST_DATA_ROW = 6; // row 6 ships with Amazon's own "ABC123" example - replaced, not skipped

const FULFILMENT_CHANNEL_MERCHANT = "Fulfilment by Merchant (Default)";

function otherImageMatcher(n) {
  const prefix = `other_product_image_locator_${n}[`;
  return (key) => key.startsWith(prefix) && key.endsWith(".media_location");
}

function bulletPointMatcher(n) {
  return (key) => key.startsWith("bullet_point[") && key.endsWith(`#${n}.value`);
}

// Field name -> matcher against the technical key in row 5. First matching
// column wins. A field's matcher must be specific enough not to catch a
// different field's column (e.g. Color has both a plain value column and a
// "standardized_values" column with the same prefix - the suffix check picks
// the plain one).
const FIELD_MATCHERS = {
  sku: (key) => key.startsWith("contribution_sku"),
  productType: (key) => key === "product_type#1.value",
  itemName: (key) => key.startsWith("item_name[") && key.endsWith("#1.value"),
  brand: (key) => key.startsWith("brand[") && key.endsWith("#1.value"),
  productIdType: (key) => key === "amzn1.volt.ca.product_id_type",
  productId: (key) => key === "amzn1.volt.ca.product_id_value",
  mainImage: (key) => key.startsWith("main_product_image_locator[") && key.endsWith(".media_location"),
  otherImage1: otherImageMatcher(1),
  otherImage2: otherImageMatcher(2),
  otherImage3: otherImageMatcher(3),
  otherImage4: otherImageMatcher(4),
  description: (key) => key.startsWith("product_description[") && key.endsWith("#1.value"),
  bulletPoint1: bulletPointMatcher(1),
  bulletPoint2: bulletPointMatcher(2),
  bulletPoint3: bulletPointMatcher(3),
  bulletPoint4: bulletPointMatcher(4),
  bulletPoint5: bulletPointMatcher(5),
  gender: (key) => key.startsWith("target_gender[") && key.endsWith("#1.value"),
  color: (key) => key.startsWith("color[") && key.endsWith("#1.value"),
  size: (key) => key.startsWith("size[") && key.endsWith("#1.value"),
  conditionType: (key) => key.startsWith("condition_type[") && key.endsWith("#1.value"),
  fulfillmentChannelCode: (key) => key === "fulfillment_availability#1.fulfillment_channel_code",
  quantity: (key) => key === "fulfillment_availability#1.quantity",
  handlingTime: (key) => key === "fulfillment_availability#1.lead_time_to_ship_max_days",
  priceZar: (key) => key.startsWith("purchasable_offer[") && key.includes("our_price") && key.endsWith("value_with_tax"),
  countryOfOrigin: (key) => key.startsWith("country_of_origin[") && key.endsWith("#1.value")
};

const NUMERIC_FIELDS = new Set(["quantity", "handlingTime", "priceZar"]);

function bulletPoints(text, count = 5) {
  const parts = String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, " ").trim())
    .filter(Boolean);
  while (parts.length < count) parts.push("");
  return parts.slice(0, count);
}

function buildRowValues(product, listing, entry) {
  const images = (listing.images && listing.images.length ? listing.images : product.images) || [];
  const [bullet1, bullet2, bullet3, bullet4, bullet5] = bulletPoints(listing.description || product.description);

  return {
    sku: product.sku || "",
    productType: entry.productType,
    itemName: (listing.title || product.name || "").slice(0, 200),
    brand: product.brand || "",
    productIdType: listing.gtin ? "EAN" : "",
    productId: listing.gtin || "",
    mainImage: images[0] || "",
    otherImage1: images[1] || "",
    otherImage2: images[2] || "",
    otherImage3: images[3] || "",
    otherImage4: images[4] || "",
    description: listing.description || product.description || "",
    bulletPoint1: bullet1,
    bulletPoint2: bullet2,
    bulletPoint3: bullet3,
    bulletPoint4: bullet4,
    bulletPoint5: bullet5,
    gender: listing.gender || "",
    color: listing.colorMain || "",
    size: listing.size || "",
    conditionType: (listing.condition || product.condition || "NEW").toUpperCase() === "NEW" ? "New" : "Used",
    fulfillmentChannelCode: FULFILMENT_CHANNEL_MERCHANT,
    quantity: Number(listing.qty ?? 1),
    handlingTime: Number(listing.handlingTimeDays ?? 3),
    priceZar: Number(listing.price ?? product.price ?? 0).toFixed(2),
    countryOfOrigin: listing.countryOfOrigin || product.countryOfOrigin || ""
  };
}

// --- Minimal OOXML text handling: just enough to read row 5's key names and
// rewrite the data rows of one worksheet, without pulling in a full workbook
// object model (that full parse is what makes exceljs slow on this file). ---

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function loadSharedStrings(entries) {
  const raw = entries["xl/sharedStrings.xml"];
  if (!raw) return [];
  const xml = strFromU8(raw);
  const strings = [];
  for (const siMatch of xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
    const texts = [...siMatch[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    strings.push(
      texts
        .join("")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&")
    );
  }
  return strings;
}

function findTemplateSheetPath(entries) {
  const workbookXml = strFromU8(entries["xl/workbook.xml"]);
  const sheetMatch = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)]
    .map((m) => m[0])
    .find((tag) => new RegExp(`name="${TEMPLATE_SHEET_NAME}"`).test(tag));
  if (!sheetMatch) throw new Error(`Workbook has no sheet named "${TEMPLATE_SHEET_NAME}".`);
  const ridMatch = sheetMatch.match(/r:id="([^"]+)"/);
  if (!ridMatch) throw new Error(`Sheet "${TEMPLATE_SHEET_NAME}" has no relationship id.`);

  const relsXml = strFromU8(entries["xl/_rels/workbook.xml.rels"]);
  const relMatch = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)]
    .map((m) => m[0])
    .find((tag) => tag.includes(`Id="${ridMatch[1]}"`));
  if (!relMatch) throw new Error(`No relationship found for id "${ridMatch[1]}".`);
  const targetMatch = relMatch.match(/Target="([^"]+)"/);
  return `xl/${targetMatch[1]}`;
}

function readRowCells(sheetXml, rowNumber, sharedStrings) {
  const rowRegex = new RegExp(`<row r="${rowNumber}"[^>]*>([\\s\\S]*?)</row>`);
  const rowMatch = rowRegex.exec(sheetXml);
  if (!rowMatch) return new Map();

  const cells = new Map();
  const cellRegex = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let match;
  while ((match = cellRegex.exec(rowMatch[1]))) {
    const [, colLetters, attrs, body = ""] = match;
    const isShared = /t="s"/.test(attrs);
    const isInline = /t="inlineStr"/.test(attrs);
    let value = "";
    if (isInline) {
      const tMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
      value = tMatch ? tMatch[1] : "";
    } else {
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (vMatch) value = isShared ? sharedStrings[Number(vMatch[1])] ?? "" : vMatch[1];
    }
    cells.set(colLetters, value);
  }
  return cells;
}

function findColumns(sheetXml, sharedStrings) {
  const keyCells = readRowCells(sheetXml, KEY_ROW, sharedStrings);
  const orderedCols = [...keyCells.keys()];

  const columns = {};
  for (const [field, matches] of Object.entries(FIELD_MATCHERS)) {
    const col = orderedCols.find((letters) => matches(keyCells.get(letters) || ""));
    if (!col) throw new Error(`Amazon template has no column matching field "${field}" in row ${KEY_ROW}.`);
    columns[field] = col;
  }
  return columns;
}

function buildRowXml(rowNumber, values, columns) {
  const cellsByLetters = new Map();
  for (const [field, colLetters] of Object.entries(columns)) {
    const value = values[field];
    if (value === "" || value === undefined || value === null) continue;
    cellsByLetters.set(colLetters, { value, numeric: NUMERIC_FIELDS.has(field) });
  }

  const cellsXml = [...cellsByLetters.entries()]
    .map(([colLetters, { value, numeric }]) => {
      const ref = `${colLetters}${rowNumber}`;
      if (numeric) return `<c r="${ref}"><v>${xmlEscape(value)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    })
    .join("");

  return `<row r="${rowNumber}">${cellsXml}</row>`;
}

function updateDimension(sheetXml, lastRow) {
  const dimensionMatch = sheetXml.match(/<dimension ref="([A-Z]+)\d+:([A-Z]+)\d+"\s*\/>/);
  if (!dimensionMatch) return sheetXml; // no dimension element to keep in sync - harmless to skip
  const [fullTag, startCol, endCol] = dimensionMatch;
  return sheetXml.replace(fullTag, `<dimension ref="${startCol}1:${endCol}${lastRow}" />`);
}

export async function buildAmazonListingBuffer(items, templateKey) {
  const entry = AMAZON_TEMPLATES[templateKey];
  if (!entry) throw new Error(`Unknown Amazon template "${templateKey}".`);

  const fileBuffer = await readFile(path.join(TEMPLATE_DIR, entry.file));
  const zipEntries = unzipSync(new Uint8Array(fileBuffer));

  const sheetPath = findTemplateSheetPath(zipEntries);
  const sharedStrings = loadSharedStrings(zipEntries);
  let sheetXml = strFromU8(zipEntries[sheetPath]);

  const columns = findColumns(sheetXml, sharedStrings);

  const rowsXml = items
    .map(({ product, listing }, index) => buildRowXml(FIRST_DATA_ROW + index, buildRowValues(product, listing, entry), columns))
    .join("");

  const existingRowRegex = new RegExp(`<row r="${FIRST_DATA_ROW}"[^>]*>[\\s\\S]*?</row>`);
  if (!existingRowRegex.test(sheetXml)) {
    throw new Error(`Amazon template is missing its example row ${FIRST_DATA_ROW} to replace.`);
  }
  sheetXml = sheetXml.replace(existingRowRegex, rowsXml);
  sheetXml = updateDimension(sheetXml, FIRST_DATA_ROW + items.length - 1);

  zipEntries[sheetPath] = strToU8(sheetXml);
  const outputZip = zipSync(zipEntries, { level: 6 });
  return Buffer.from(outputZip);
}
