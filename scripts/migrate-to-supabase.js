#!/usr/bin/env node
// Run this once to upload your local data/db.json to Supabase.
// Usage: node scripts/migrate-to-supabase.js
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

// Force-load .env, overriding any existing system env vars
try {
  const raw = await readFile(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    process.env[key] = rest.join("=").trim();
  }
} catch { /* no .env file */ }

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

let raw;
try {
  raw = await readFile("data/db.json", "utf8");
} catch {
  console.error("data/db.json not found — nothing to migrate.");
  process.exit(1);
}

const data = JSON.parse(raw);

const { error } = await supabase.from("store").upsert({ id: 1, data });
if (error) {
  console.error("Migration failed:", error.message);
  process.exit(1);
}

console.log("Migration complete!");
console.log(`  Suppliers:    ${data.suppliers?.length ?? 0}`);
console.log(`  Products:     ${data.products?.length ?? 0}`);
console.log(`  Listings:     ${data.listings?.length ?? 0}`);
console.log(`  Transactions: ${data.transactions?.length ?? 0}`);
