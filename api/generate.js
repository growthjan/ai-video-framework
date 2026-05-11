// api/generate.js — muapi.ai proxy
const BASE = "https://api.muapi.ai/api/v1";
const muapi = (path, method = "GET", body = null) =>
    fetch(`${BASE}${path}`, {
          method,
          headers: { "x-api-key": process.env.MUAPI_KEY, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(r => r.json());

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!process.env.MUAPI_KEY) return res.status(500).json({ error: "MUAPI_KEY nicht konfiguriert" });
    const { action, endpoint, requestId, body } = req.body || {};
    try {
          if (action === "submit") return res.json(await muapi(`/${endpoint}`, "POST", body));
          if (action === "poll")   return res.json(await muapi(`/predictions/${requestId}/result`));
          return res.status(400).json({ error: "Invalid action" });
    } catch (e) {
          return res.status(500).json({ error: e.message });
    }
}
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
