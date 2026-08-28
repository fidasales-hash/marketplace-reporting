// Bob Shop has no listing-creation API. Sellers publish in bulk via a 45-column
// CSV uploaded through My Account > Selling > "Import products (CSV)".
// Column order matches the sample template Bob Shop provides there.

export const BOBSHOP_CSV_HEADER = [
  "Listing Type [mandatory] ENGLISH_AUCTION or FIXED_PRICE",
  "TITLE [Text Title for Item - Max 100 chars]",
  "Primary Category [mandatory Number]",
  "Secondary Category [optional Number - incurs a fee]",
  "Location [optional Specify location country of the product]",
  "Traders Reference [optional Max 100 chars]",
  "Start Date/Time [mandatory Date dd/mm/yyyy HH:mm]",
  "Stop Date/Time [mandatory Date dd/mm/yyyy HH:mm]",
  "Number of Items [mandatory Number]",
  "Number of Items Per Lot [optional Number]",
  "Auction Starting Bid Amount [mandatory for auctions Currency 0.00]",
  "Auction Bid Increment  [mandatory for auctions - specify an amount in decimal format. Currency 0.00]",
  "Auction Reserve Amount [optional only for auctions Currency 0.00]",
  "Buy Now Price (Fixed Price) [mandatory field for Buy Now items Currency 0.00]",
  "Recommended Retail Price [optional Currency 0.00]",
  "Allow Offers yes or ",
  "Currency [mandatory R for ZAR] R",
  "Item Condition [mandatory] NEW or SECOND_HAND or REFURBISHED",
  "Image URLs [Optional but recommended. Separate multiple URLs with colon ':']",
  "Auto Re-list Options [optional]   RELIST_DAILY or RELIST_IMMEDIATELY or RELIST_DAILY_ALL or RELIST_IMMEDIATELY_ALL",
  "Number of Auto Relists [optional Number] The number of times to relist - if relisting is specified by the previous column",
  "Item Description [optional but recommended Max 8000 chars] Text or html description of the item for sale. html descriptions can provide attractive and sophisticated descriptions including additional images using html tags such as <img src=http://www.somedomain.com/images/item1.gif>",
  "Discreet Listing [optional] yes or ",
  "Home Page Featured Listing [NOT AVAILABLE] yes or ",
  "Category Page Featured Listing [NOT AVAILABLE] yes or ",
  "Priority Listing [NOT AVAILABLE] yes or ",
  "Highlighted Listing [NOT AVAILABLE] yes or ",
  "Bold Title Listing [NOT AVAILABLE] yes or ",
  "Promotional Listing [optional - Incurs a Fee] yes or ",
  "Premium Listings [NOT AVAILABLE]yes or ",
  "Copy Enhancements if Relisting [optional] yes or ",
  "Warranty Type [optional]  or NOT_OFFERED or REPLACEMENT or DEALER or MANUFACTURER",
  "Warranty Remarks [optional Max 300 chars]",
  "Guarantee Type [optional]  or MONEY_BACK_7_DAYS or MONEY_BACK_10_DAYS or MONEY_BACK_15_DAYS or MONEY_BACK_30_DAYS or REPLACEMENT_7_DAYS or REPLACEMENT_10_DAYS or REPLACEMENT_15_DAYS or REPLACEMENT_30_DAYS",
  "Guarantee Remarks [optional Max 300 chars]",
  "Prompts [optional]",
  "Shipping Option [optional]",
  "Automatic Extension Minutes [not available for most users blank or the number 1]",
  "Global Trade Item Number(GTIN) [optional] GTIN or ",
  "Width [optional in cm]",
  "Length [optional in cm]",
  "Height [optional in cm]",
  "Weight [optional in kg]",
  "Boost [optional - Incurs a Fee]",
  "End of Record [mandatory] set to 'End'"
];

function formatBobshopDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// listing carries the marketplace-specific fields (category, price, qty, images,
// description, condition); product supplies fallbacks so a listing only has to
// override what differs from the canonical record.
export function buildBobshopCsvRow(product, listing, { durationDays = 30, now = new Date() } = {}) {
  const start = now;
  const stop = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const images = (listing.images && listing.images.length ? listing.images : product.images) || [];

  const row = new Array(BOBSHOP_CSV_HEADER.length).fill("");
  row[0] = "FIXED_PRICE";
  row[1] = (listing.title || product.name || "").slice(0, 100);
  row[2] = listing.category || "";
  row[4] = listing.location || "South Africa";
  row[5] = `${product.id} / ${product.sku || ""}`.trim();
  row[6] = formatBobshopDate(start);
  row[7] = formatBobshopDate(stop);
  row[8] = String(listing.qty ?? 1);
  row[13] = Number(listing.price ?? product.price ?? 0).toFixed(2);
  row[14] = listing.rrp ? Number(listing.rrp).toFixed(2) : "";
  row[16] = "R";
  row[17] = (listing.condition || product.condition || "NEW").toUpperCase();
  row[18] = images.join(":");
  row[21] = listing.description || product.description || "";
  row[31] = listing.warrantyType || "";
  row[32] = listing.warrantyRemarks || "";
  row[38] = listing.gtin || "";
  row[39] = listing.widthCm || "";
  row[40] = listing.lengthCm || "";
  row[41] = listing.heightCm || "";
  row[42] = listing.weightKg || product.weightKg || "";
  row[44] = "End";
  return row;
}

function csvField(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function buildBobshopCsv(items, options = {}) {
  const lines = [BOBSHOP_CSV_HEADER.map(csvField).join(",")];
  for (const { product, listing } of items) {
    lines.push(buildBobshopCsvRow(product, listing, options).map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
