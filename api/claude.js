// api/claude.js — Anthropic API proxy
export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY nicht konfiguriert" });
    try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                            "Content-Type": "application/json",
                            "x-api-key": process.env.ANTHROPIC_API_KEY,
                            "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify(req.body),
          });
          const data = await r.json();
          return res.status(r.status).json(data);
    } catch (e) {
          return res.status(500).json({ error: e.message });
    }
}
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
