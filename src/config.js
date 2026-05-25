import { readFile } from "node:fs/promises";

let loaded = false;

export async function loadEnv() {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await readFile(".env", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (!process.env[key]) {
        process.env[key] = valueParts.join("=").trim();
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function getConfig() {
  return {
    port: Number(process.env.PORT) || 3000,
    takealot: {
      apiKey: process.env.TAKEALOT_API_KEY || "",
      baseUrl: process.env.TAKEALOT_API_BASE_URL || "https://seller-api.takealot.com/v2",
      syncStartDate: process.env.TAKEALOT_SYNC_START_DATE || "2018-01-01"
    },
    amazon: {
      refreshToken: process.env.AMAZON_SP_API_REFRESH_TOKEN || "",
      clientId: process.env.AMAZON_SP_API_CLIENT_ID || "",
      clientSecret: process.env.AMAZON_SP_API_CLIENT_SECRET || "",
      marketplaceId: process.env.AMAZON_SP_API_MARKETPLACE_ID || "",
      region: process.env.AMAZON_SP_API_REGION || "eu",
      baseUrl: process.env.AMAZON_SP_API_BASE_URL || "https://sellingpartnerapi-eu.amazon.com",
      tokenUrl: process.env.AMAZON_LWA_TOKEN_URL || "https://api.amazon.com/auth/o2/token",
      awsAccessKeyId: process.env.AMAZON_AWS_ACCESS_KEY_ID || "",
      awsSecretAccessKey: process.env.AMAZON_AWS_SECRET_ACCESS_KEY || ""
    }
  };
}
