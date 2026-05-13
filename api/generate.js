// api/generate.js — muapi.ai proxy
const BASE = "https://api.muapi.ai/api/v1";

const muapi = async (path, method = "GET", body = null) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "x-api-key": process.env.MUAPI_KEY, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  console.log(`muapi ${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { error: text, status: r.status }; }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.MUAPI_KEY) return res.status(500).json({ error: "MUAPI_KEY nicht konfiguriert" });

  const { action, endpoint, requestId, body } = req.body || {};
  try {
    if (action === "submit") {
      const data = await muapi(`/${endpoint}`, "POST", body);
      // Handle different response formats from muapi
      const reqId = data?.request_id || data?.data?.request_id || data?.id;
      if (reqId) return res.json({ ...data, request_id: reqId });
      return res.json(data);
    }
    if (action === "poll") {
      const data = await muapi(`/predictions/${requestId}/result`);
      return res.json(data);
    }
    return res.status(400).json({ error: "Invalid action" });
  } catch (e) {
    console.error("generate error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
