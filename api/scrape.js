// api/scrape.js — Server-side URL fetcher (no CORS restrictions)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "URL required" });

  const attempts = [
    // Standard browser request
    () => fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      redirect: "follow",
    }),
    // Try Shopify JSON API (works for all Shopify stores)
    () => {
      const shopifyUrl = url.replace(/\/collections\/[^/]+\/products\//, "/products/") + ".json";
      return fetch(shopifyUrl, { headers: { "Accept": "application/json" } });
    },
  ];

  for (const attempt of attempts) {
    try {
      const r = await attempt();
      if (!r.ok) continue;
      const contentType = r.headers.get("content-type") || "";
      const text = await r.text();
      if (text.length < 100) continue;

      // If it's JSON (Shopify API), return product data directly
      if (contentType.includes("json")) {
        try {
          const data = JSON.parse(text);
          return res.status(200).json({ html: null, shopify: data.product || data });
        } catch {}
      }

      return res.status(200).json({ html: text.slice(0, 50000) });
    } catch (e) {
      continue;
    }
  }

  return res.status(200).json({ html: null, error: "Page could not be fetched" });
}
