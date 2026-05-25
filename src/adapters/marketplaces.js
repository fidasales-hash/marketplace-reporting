export const marketplaces = [
  {
    id: "amazon",
    name: "Amazon",
    identifiers: ["ASIN", "Seller SKU", "FNSKU"],
    productSources: ["SP-API Catalog Items", "SP-API Listings Items", "CSV export"],
    feeSources: ["SP-API Finances", "Reports API payment/FBA reports", "CSV settlement export"],
    status: "connector-ready"
  },
  {
    id: "bob-shop",
    name: "Bob Shop",
    identifiers: ["Listing ID", "SKU", "Product code"],
    productSources: ["Seller export", "API connector when credentials are available"],
    feeSources: ["Seller fee export", "Monthly invoice import"],
    status: "import-ready"
  },
  {
    id: "takealot",
    name: "Takealot",
    identifiers: ["TSIN", "Offer ID", "SKU"],
    productSources: ["Seller portal export", "API connector when credentials are available"],
    feeSources: ["Seller finance export", "Commission/fulfilment fee import"],
    status: "import-ready"
  }
];

export function getMarketplace(id) {
  return marketplaces.find((marketplace) => marketplace.id === id);
}
