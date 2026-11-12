import { timingSafeEqual } from "node:crypto";
import { createTakealotOffer } from "../../../src/adapters/takealot.js";
import { getConfig, loadEnv } from "../../../src/config.js";

function authorized(req) {
  const expected = process.env.TAKEALOT_AGENT_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  await loadEnv();
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });

  try {
    const body = await readBody(req);
    if (body.approved !== true) {
      return res.status(409).json({ error: "Explicit approval is required. Set approved: true only after reviewing the listing." });
    }

    const result = await createTakealotOffer(getConfig(), body);
    return res.status(result.status || (result.ok ? 200 : 400)).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid request." });
  }
}
