import { ensureStore } from "../src/db.js";
import { handleApi, sendJson } from "../src/handler.js";

export default async function handler(req, res) {
  try {
    await ensureStore();
    const url = new URL(req.url, `https://${req.headers.host}`);
    await handleApi(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
