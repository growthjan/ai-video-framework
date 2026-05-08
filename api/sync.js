// api/sync.js — receives brand/project data from the Claude artifact and writes to Supabase

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = process.env.VITE_SUPABASE_ANON_KEY;

const sb = async (path, method, body) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, body: text };
};

export default async function handler(req, res) {
  // CORS — allow requests from Claude.ai artifact
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "Supabase not configured on server" });
  }

  const { brand, project } = req.body || {};
  const results = {};

  try {
    if (brand) {
      const r = await sb("brands", "POST", {
        id:         brand.id,
        name:       brand.name,
        color:      brand.color,
        foundation: brand.foundation,
        created_at: brand.createdAt || new Date().toISOString(),
      });
      results.brand = { ok: r.ok, status: r.status };
      if (!r.ok) return res.status(500).json({ error: `Brand sync failed: ${r.body}` });
    }

    if (project) {
      // Strip base64 image before storing
      const data = { ...project };
      if (data.productData) data.productData = { ...data.productData, imageB64: null };

      const r = await sb("projects", "POST", {
        id:           project.id,
        brand_id:     project.brandId,
        name:         project.proj?.name || "Ohne Titel",
        content_type: project.contentType,
        step:         project.step || "project",
        steps_done:   [project.productData?.analyzed || project.proj?.product, project.scenes?.length > 0, project.keyframes?.length > 0, project.videoPrompts?.length > 0].filter(Boolean).length,
        data,
        updated_at:   new Date().toISOString(),
      });
      results.project = { ok: r.ok, status: r.status };
      if (!r.ok) return res.status(500).json({ error: `Project sync failed: ${r.body}` });
    }

    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };
