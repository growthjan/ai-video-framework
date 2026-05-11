import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./lib/supabase";

// ─── API helpers ──────────────────────────────────────────────────────────────
const callClaude = async (system, messages, maxTokens = 1500) => {
  const r = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.content?.[0]?.text ?? "";
};
const claudeS = (sys, user, mt) => callClaude(sys, [{ role: "user", content: user }], mt);

const muSubmit = (endpoint, body) =>
  fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", endpoint, body }) }).then(r => r.json());
const muPoll = (requestId) =>
  fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "poll", requestId }) }).then(r => r.json());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const muPollUntilDone = async (requestId, onStatus) => {
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const d = await muPoll(requestId);
    const status = d?.data?.status || d?.status;
    if (onStatus) onStatus(status);
    if (status === "completed") return d;
    if (status === "failed") throw new Error(d?.error || "Generation fehlgeschlagen");
  }
  throw new Error("Timeout nach 6 Minuten");
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const parseJ = (t) => {
  if (!t) return null;
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch {}
  const m = t.match(/\[[\s\S]*\]/) || t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
};
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (iso) => { try { return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }); } catch { return ""; } };
const stripBin = (p) => ({ ...p, productData: p.productData ? { ...p.productData, imageB64: null } : p.productData });
const cntSteps = (p) => [p.productData?.analyzed || p.proj?.product, p.scenes?.length > 0, p.keyframes?.length > 0, p.videoPrompts?.length > 0].filter(Boolean).length;

// ─── Constants ────────────────────────────────────────────────────────────────
const BRAND_COLORS = ["#7F77DD","#1D9E75","#BA7517","#D85A30","#D4537E","#378ADD","#639922","#888780"];

const CT = {
  product:     { label: "Product Ad",   icon: "◈", col: "#7F77DD", desc: "Realistischer Produktfilm" },
  ugc:         { label: "UGC Style",    icon: "◉", col: "#1D9E75", desc: "Authentisch, handheld" },
  talkinghead: { label: "Talking Head", icon: "◎", col: "#BA7517", desc: "Person spricht zur Kamera" },
  impossible:  { label: "AI Creative",  icon: "✦", col: "#D85A30", desc: "Unmögliche Shots" },
};

// muapi.ai model endpoints
const IMG_MODELS = {
  "flux-dev-image":        { name: "Flux Dev",   desc: "Schnell & günstig" },
  "flux-2-pro":            { name: "Flux Pro",   desc: "Hohe Qualität" },
  "flux-kontext-max-t2i":  { name: "Flux Kontext", desc: "Beste Qualität" },
};
const VID_MODELS = {
  "kling-v2.6-pro-i2v":       { name: "Kling 3.0 Pro",  desc: "Realistisch, stabil", i2v: true },
  "seedance-v2.0-i2v":        { name: "Seedance 2.0",   desc: "Cinematisch", i2v: true },
  "veo3.1-image-to-video":    { name: "Veo 3.1",        desc: "Beste Qualität", i2v: true },
  "wan2.5-image-to-video":    { name: "Wan 2.5",        desc: "Open Source, günstig", i2v: true },
  "kling-v2.6-pro-t2v":       { name: "Kling 3.0 (Text)", desc: "Kein Keyframe nötig", i2v: false },
  "seedance-v2.0-t2v":        { name: "Seedance (Text)", desc: "Text zu Video", i2v: false },
};

const QUICKFIRE = {
  product: [
    { id: "proximity", q: "Wie nah ist das Produkt?", opts: [{v:"extreme",l:"Extreme Nahaufnahmen"},{v:"medium",l:"Mittelnahaufnahmen"},{v:"mixed",l:"Beides abwechselnd"}] },
    { id: "setting",   q: "Setting?",                  opts: [{v:"studio",l:"Neutrales Studio"},{v:"context",l:"Im Produktkontext"},{v:"abstract",l:"Abstrakt / kreativ"}] },
    { id: "camera",    q: "Kamerabewegung?",            opts: [{v:"still",l:"Statisch"},{v:"smooth",l:"Ruhig & fließend"},{v:"organic",l:"Leicht organisch"}] },
    { id: "mood",      q: "Atmosphäre?",                opts: [{v:"dark",l:"Dunkel & Premium"},{v:"bright",l:"Hell & Clean"},{v:"warm",l:"Warm & Einladend"}] },
  ],
  ugc: [
    { id: "subject",  q: "Wer ist im Video?",   opts: [{v:"using",l:"Person benutzt Produkt"},{v:"talking",l:"Spricht zur Kamera"},{v:"mixed",l:"Gemischt"}] },
    { id: "setting",  q: "Setting?",             opts: [{v:"home",l:"Zuhause"},{v:"outdoor",l:"Outdoor"},{v:"onthego",l:"Unterwegs"}] },
    { id: "rawness",  q: "Wie authentisch?",     opts: [{v:"raw",l:"Sehr roh & ungefiltert"},{v:"mid",l:"Authentisch aber sauber"},{v:"polished",l:"Leicht poliert"}] },
    { id: "product",  q: "Produktintegration?",  opts: [{v:"hero",l:"Dominant"},{v:"natural",l:"Natürlich eingebaut"},{v:"subtle",l:"Subtil"}] },
  ],
  talkinghead: [
    { id: "bg",     q: "Hintergrund?",       opts: [{v:"minimal",l:"Clean / Minimal"},{v:"branded",l:"Branded"},{v:"lifestyle",l:"Lifestyle"}] },
    { id: "pacing", q: "Schnittrhythmus?",   opts: [{v:"slow",l:"Ruhig"},{v:"medium",l:"Standard"},{v:"fast",l:"Schnell mit B-Roll"}] },
    { id: "energy", q: "Energie?",           opts: [{v:"calm",l:"Ruhig & vertrauenswürdig"},{v:"energetic",l:"Energetisch"},{v:"friendly",l:"Freundlich & nahbar"}] },
    { id: "broll",  q: "B-Roll?",            opts: [{v:"product",l:"Produktaufnahmen"},{v:"lifestyle",l:"Lifestyle"},{v:"graphic",l:"Text / Graphics"}] },
  ],
  impossible: [
    { id: "scale",   q: "Skala?",       opts: [{v:"micro",l:"Mikrokosmos"},{v:"normal",l:"Normal"},{v:"epic",l:"Episch / Riesig"}] },
    { id: "physics", q: "Physik?",      opts: [{v:"real",l:"Hyperrealistisch"},{v:"slightly",l:"Leicht surreal"},{v:"full",l:"Surreal"}] },
    { id: "time",    q: "Zeitgefühl?",  opts: [{v:"slow",l:"Zeitlupe"},{v:"normal",l:"Normal"},{v:"lapse",l:"Zeitraffer"}] },
    { id: "mood",    q: "Stimmung?",    opts: [{v:"mystic",l:"Mysteriös"},{v:"fresh",l:"Frisch & lebendig"},{v:"magic",l:"Warm & magisch"}] },
  ],
};

const EMPTY_PROJ = (id, brandId) => ({
  id, brandId, contentType: "product", sceneCount: 5,
  imageTool: "flux-dev-image", videoTool: "kling-v2.6-pro-i2v",
  proj: { name: "", product: "", goal: "", platform: "Instagram", pacing: "" },
  productData: { imageB64: null, mediaType: null, imageUrl: "", analyzed: null, mockupPrompts: [] },
  scenes: [], keyframes: [], videoPrompts: [], generations: {}, ratings: {},
  updatedAt: new Date().toISOString(),
});

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]           = useState("brands");
  const [brands, setBrands]       = useState({});
  const [activeBrand, setActiveBrand] = useState(null);
  const [projects, setProjects]   = useState([]);
  const [proj, setProj]           = useState(null);
  const [qfEnabled, setQfEnabled] = useState(true);
  const [ready, setReady]         = useState(false);

  useEffect(() => {
    (async () => {
      const { data: brandsData } = await supabase.from("brands").select("*").order("created_at");
      const map = {};
      (brandsData || []).forEach(b => map[b.id] = b);
      setBrands(map);

      // Restore last session
      const last = JSON.parse(localStorage.getItem("fw-last") || "null");
      if (last?.brandId && map[last.brandId]) {
        const brand = map[last.brandId];
        setActiveBrand(brand);
        const { data: projs } = await supabase.from("projects")
          .select("id, name, content_type, updated_at, steps_done")
          .eq("brand_id", last.brandId).order("updated_at", { ascending: false });
        setProjects(projs || []);
        if (last.projId) {
          const { data: p } = await supabase.from("projects").select("data").eq("id", last.projId).single();
          if (p?.data) { setProj(p.data); setView("project"); setReady(true); return; }
        }
        setView("dashboard");
      }
      setReady(true);
    })();
  }, []);

  // ── Supabase helpers ─────────────────────────────────────────────────────────
  const saveBrand = async (brand) => {
    await supabase.from("brands").upsert({ id: brand.id, name: brand.name, color: brand.color, foundation: brand.foundation, created_at: brand.createdAt || new Date().toISOString() });
  };

  const saveProj = useCallback(async (p) => {
    const updated = { ...p, updatedAt: new Date().toISOString() };
    setProj(updated);
    const toSave = stripBin(updated);
    await supabase.from("projects").upsert({
      id: toSave.id, brand_id: toSave.brandId,
      name: toSave.proj?.name || "Ohne Titel",
      content_type: toSave.contentType, steps_done: cntSteps(toSave),
      data: toSave, updated_at: toSave.updatedAt,
    });
    const meta = { id: updated.id, name: updated.proj?.name || "Ohne Titel", content_type: updated.contentType, steps_done: cntSteps(updated), updated_at: updated.updatedAt };
    setProjects(prev => { const l = [...prev]; const i = l.findIndex(x => x.id === updated.id); if (i >= 0) l[i] = meta; else l.unshift(meta); return l; });
  }, []);

  const setP = useCallback((upd) => setProj(prev => {
    if (!prev) return prev;
    return { ...prev, ...upd };
  }), []);

  // ── Brand actions ────────────────────────────────────────────────────────────
  const createBrand = async (name, color) => {
    const brand = { id: uid(), name, color, foundation: { visualBible: "", styleTokens: "", assetNotes: "" }, createdAt: new Date().toISOString() };
    setBrands(prev => ({ ...prev, [brand.id]: brand }));
    await saveBrand(brand);
    openBrand(brand, []);
  };
  const updateFoundation = async (foundation) => {
    const updated = { ...activeBrand, foundation };
    setBrands(prev => ({ ...prev, [updated.id]: updated }));
    setActiveBrand(updated);
    await supabase.from("brands").update({ foundation }).eq("id", updated.id);
  };
  const deleteBrand = async (id) => {
    setBrands(prev => { const n = { ...prev }; delete n[id]; return n; });
    await supabase.from("brands").delete().eq("id", id);
  };
  const openBrand = (brand, projs) => {
    setActiveBrand(brand); setProjects(projs); setProj(null);
    localStorage.setItem("fw-last", JSON.stringify({ brandId: brand.id }));
    setView("dashboard");
  };
  const selectBrand = async (brand) => {
    const { data } = await supabase.from("projects").select("id,name,content_type,updated_at,steps_done").eq("brand_id", brand.id).order("updated_at", { ascending: false });
    openBrand(brand, data || []);
  };

  // ── Project actions ──────────────────────────────────────────────────────────
  const createProject = async () => {
    const p = EMPTY_PROJ(uid(), activeBrand.id);
    await saveProj(p);
    localStorage.setItem("fw-last", JSON.stringify({ brandId: activeBrand.id, projId: p.id }));
    setView("project");
  };
  const openProject = async (meta) => {
    const { data } = await supabase.from("projects").select("data").eq("id", meta.id).single();
    const p = data?.data || EMPTY_PROJ(meta.id, activeBrand.id);
    setProj(p);
    localStorage.setItem("fw-last", JSON.stringify({ brandId: activeBrand.id, projId: meta.id }));
    setView("project");
  };
  const deleteProject = async (id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    await supabase.from("projects").delete().eq("id", id);
  };

  if (!ready) return <Spin msg="Wird geladen..." />;
  if (view === "brands")    return <BrandsView brands={brands} onSelect={selectBrand} onCreate={createBrand} onDelete={deleteBrand} />;
  if (view === "dashboard") return <DashView brand={activeBrand} projects={projects} onBack={() => setView("brands")} onFoundation={updateFoundation} onNew={createProject} onOpen={openProject} onDelete={deleteProject} />;
  if (view === "project" && proj) return <ProjView proj={proj} brand={activeBrand} qfEnabled={qfEnabled} onQfToggle={v => setQfEnabled(v)} onBack={() => setView("dashboard")} onSave={saveProj} setP={setP} onNew={createProject} />;
  return <Spin msg="..." />;
}

// ─── Brands View ──────────────────────────────────────────────────────────────
function BrandsView({ brands, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(BRAND_COLORS[0]);
  const list = Object.values(brands).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const submit = () => { if (!name.trim()) return; onCreate(name.trim(), color); setCreating(false); setName(""); };
  return (
    <div style={{ fontFamily: "inherit", padding: "28px 28px", maxWidth: 680, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: ".1em", textTransform: "uppercase", color: "#9b9b99", marginBottom: 5 }}>AI Video Production</div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>Brands & Kunden</div>
      </div>
      {creating ? (
        <div style={{ border: "0.5px solid #d4d4d2", borderRadius: 11, padding: "14px 15px", marginBottom: 12, background: "#f7f7f6" }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 9 }}>Neuer Brand</div>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="Kundenname" style={{ marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 5, marginBottom: 11 }}>
            {BRAND_COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", outline: color === c ? `2px solid ${c}` : "2px solid transparent", outlineOffset: 2 }} />)}
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            <Btn2 onClick={() => setCreating(false)}>Abbrechen</Btn2>
            <Btn onClick={submit} col={color} style={{ flex: 2 }}>Anlegen →</Btn>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} style={{ width: "100%", padding: 10, borderRadius: 9, border: "1.5px dashed #d4d4d2", background: "transparent", color: "#5c5c5a", fontSize: 13, cursor: "pointer", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>+</span> Neuen Brand anlegen
        </button>
      )}
      {list.length === 0 && !creating && <div style={{ textAlign: "center", padding: "36px 0", color: "#9b9b99", fontSize: 13 }}>Noch keine Brands.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {list.map(brand => (
          <div key={brand.id} onClick={() => onSelect(brand)} style={{ border: "0.5px solid #efefed", borderRadius: 11, padding: "13px 14px", cursor: "pointer", position: "relative", transition: "border-color .15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#d4d4d2"} onMouseLeave={e => e.currentTarget.style.borderColor = "#efefed"}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: brand.color }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{brand.name}</span>
            </div>
            <div style={{ fontSize: 11, color: "#9b9b99", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {brand.foundation?.visualBible || <em>Brand Foundation noch leer</em>}
            </div>
            <button onClick={e => { e.stopPropagation(); if (confirm(`"${brand.name}" löschen?`)) onDelete(brand.id); }} style={{ position: "absolute", top: 9, right: 9, background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#9b9b99" }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────
function DashView({ brand, projects, onBack, onFoundation, onNew, onOpen, onDelete }) {
  const [foundation, setFoundation] = useState(brand.foundation || {});
  const [open, setOpen] = useState(!brand.foundation?.visualBible);
  const [saved, setSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analMsg, setAnalMsg] = useState("");
  const [pdfB64, setPdfB64] = useState(null); const [pdfName, setPdfName] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [shotB64, setShotB64] = useState(null); const [shotType, setShotType] = useState("");
  const pdfRef = useRef(); const shotRef = useRef();
  const hasSrc = pdfB64 || webUrl.trim() || shotB64;

  const save = async () => { await onFoundation(foundation); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const analyze = async () => {
    setAnalyzing(true); setAnalMsg("Analyse läuft...");
    const sys = `Brand-Stratege für AI Video Production. Leite aus Brand-Materialien konkrete Video-Richtlinien ab.
Farben→Licht. Typografie→Pacing. Bildsprache→Kamerastil. Tonalität→Schnittrhythmus.
Antworte NUR als JSON: {"visualBible":"3-4 Sätze Gesamtästhetik und filmische Referenz","styleTokens":"Konkrete Ableitungen als Fließtext. Verboten: ...","assetNotes":"Farbcodes, Logo-Richtlinien"}`;
    const content = [];
    if (pdfB64) { setAnalMsg("Brand Guide wird gelesen..."); content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } }); }
    if (shotB64) content.push({ type: "image", source: { type: "base64", media_type: shotType, data: shotB64 } });
    let webCtx = "";
    if (webUrl.trim()) {
      setAnalMsg("Website wird geladen...");
      try { const r = await Promise.race([fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(webUrl)}`).then(r => r.json()), new Promise((_, rj) => setTimeout(() => rj(), 9000))]); if (r?.contents) webCtx = r.contents.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2500); } catch {}
    }
    content.push({ type: "text", text: `Analysiere alle Brand-Materialien.${webUrl ? `\nWebsite: ${webUrl}${webCtx ? `\n${webCtx}` : ""}` : ""}` });
    setAnalMsg("Analyse läuft...");
    try {
      const res = await callClaude(sys, [{ role: "user", content }], 1200);
      const ex = parseJ(res);
      if (ex) { const m = { visualBible: ex.visualBible || foundation.visualBible, styleTokens: ex.styleTokens || foundation.styleTokens, assetNotes: ex.assetNotes || foundation.assetNotes }; setFoundation(m); await onFoundation(m); setSaved(true); setTimeout(() => setSaved(false), 2000); }
      else setAnalMsg("Kein Ergebnis — andere Quellen versuchen");
    } catch (e) { setAnalMsg(`Fehler: ${e.message}`); }
    setAnalyzing(false); setTimeout(() => setAnalMsg(""), 3000);
  };

  return (
    <div style={{ padding: "22px 26px", maxWidth: 680, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, paddingBottom: 14, borderBottom: "0.5px solid #efefed" }}>
        <button onClick={onBack} style={{ fontSize: 12, color: "#9b9b99", background: "none", border: "none", cursor: "pointer" }}>← Alle Brands</button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: brand.color }} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>{brand.name}</span>
        </div>
      </div>

      {/* Foundation */}
      <div style={{ border: "0.5px solid #efefed", borderRadius: 11, marginBottom: 14, overflow: "hidden" }}>
        <div onClick={() => setOpen(o => !o)} style={{ padding: "9px 13px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f7f7f6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: "monospace", fontSize: 8, padding: "2px 6px", borderRadius: 4, background: `${brand.color}22`, color: brand.color }}>BRAND FOUNDATION</span>
            {brand.foundation?.visualBible && <span style={{ fontSize: 10, color: "#9b9b99" }}>✓</span>}
          </div>
          <span style={{ fontSize: 9, color: "#9b9b99", transform: open ? "rotate(180deg)" : "none", display: "block", transition: "transform .15s" }}>▼</span>
        </div>
        {open && (
          <div style={{ padding: "12px 13px" }}>
            <div style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: ".07em", textTransform: "uppercase", color: "#9b9b99", marginBottom: 8 }}>Quellen für automatische Analyse</div>
            <div style={{ marginBottom: 6 }}>
              <input ref={pdfRef} type="file" accept="application/pdf" onChange={async e => { const f = e.target.files[0]; if (f) { setPdfName(f.name); setPdfB64(await fileToB64(f)); } }} style={{ display: "none" }} />
              {pdfB64
                ? <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "#f7f7f6", border: "0.5px solid #efefed", borderRadius: 7, fontSize: 11 }}>📄 <span style={{ flex: 1 }}>{pdfName}</span><button onClick={() => { setPdfB64(null); setPdfName(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#9b9b99" }}>×</button></div>
                : <button onClick={() => pdfRef.current?.click()} style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: `1px dashed ${brand.color}66`, background: `${brand.color}06`, color: brand.color, fontSize: 11, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>↑ Brand Guide PDF</button>}
            </div>
            <input value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="🌐 https://www.kundenwebsite.com" style={{ marginBottom: 6 }} />
            <div style={{ marginBottom: 10 }}>
              <input ref={shotRef} type="file" accept="image/*" onChange={async e => { const f = e.target.files[0]; if (f) { setShotType(f.type); setShotB64(await fileToB64(f)); } }} style={{ display: "none" }} />
              {shotB64
                ? <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", background: "#f7f7f6", border: "0.5px solid #efefed", borderRadius: 7, fontSize: 11 }}>🖼 Screenshot geladen <button onClick={() => setShotB64(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9b9b99" }}>×</button></div>
                : <div onClick={() => shotRef.current?.click()} style={{ padding: "6px 11px", borderRadius: 7, border: "1px dashed #d4d4d2", color: "#9b9b99", fontSize: 11, cursor: "pointer", textAlign: "center" }}>Homepage-Screenshot (optional)</div>}
            </div>
            {analyzing
              ? <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", background: "#f7f7f6", borderRadius: 7, marginBottom: 10, fontSize: 12 }}><SpinInline col={brand.color} />{analMsg}</div>
              : hasSrc
                ? <Btn onClick={analyze} col={brand.color} style={{ marginBottom: 10 }}>✦ Automatisch befüllen</Btn>
                : analMsg ? <div style={{ fontSize: 11, color: "#D85A30", marginBottom: 10 }}>{analMsg}</div> : null}
            <div style={{ height: "0.5px", background: "#efefed", margin: "0 0 10px" }} />
            <Fld label="Visual Bible" rows={3} value={foundation.visualBible || ""} onChange={v => setFoundation(f => ({ ...f, visualBible: v }))} placeholder="Gesamtästhetik, Stimmung, filmische Referenzen..." />
            <Fld label="Style Tokens" rows={2} value={foundation.styleTokens || ""} onChange={v => setFoundation(f => ({ ...f, styleTokens: v }))} placeholder="Kamerastil, Licht, Pacing, verbotene Elemente..." />
            <Fld label="Asset-Notizen" rows={2} value={foundation.assetNotes || ""} onChange={v => setFoundation(f => ({ ...f, assetNotes: v }))} placeholder="Farbcodes, Markenrichtlinien..." />
            <Btn onClick={save} col={saved ? "#1D9E75" : brand.color}>{saved ? "✓ Gespeichert" : "Speichern"}</Btn>
          </div>
        )}
      </div>

      {/* Projects */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Projekte</div>
        <Btn onClick={onNew} col={brand.color} style={{ padding: "5px 12px", fontSize: 12 }}>+ Neu</Btn>
      </div>
      {projects.length === 0
        ? <div style={{ border: "1.5px dashed #e5e5e3", borderRadius: 9, padding: 28, textAlign: "center", color: "#9b9b99", fontSize: 13 }}>Noch keine Projekte.</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[...projects].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).map(p => {
            const ct = CT[p.content_type] || CT.product;
            return (
              <div key={p.id} onClick={() => onOpen(p)} style={{ border: "0.5px solid #efefed", borderRadius: 9, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "border-color .15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#d4d4d2"} onMouseLeave={e => e.currentTarget.style.borderColor = "#efefed"}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{p.name || "Ohne Titel"}</span>
                    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 7, background: `${ct.col}18`, color: ct.col, fontFamily: "monospace" }}>{ct.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>{[0, 1, 2, 3].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: i < (p.steps_done || 0) ? brand.color : "#e5e5e3" }} />)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {p.updated_at && <span style={{ fontSize: 10, color: "#9b9b99" }}>{fmt(p.updated_at)}</span>}
                  <button onClick={e => { e.stopPropagation(); if (confirm("Projekt löschen?")) onDelete(p.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#9b9b99" }}>×</button>
                </div>
              </div>
            );
          })}
        </div>}
    </div>
  );
}

// ─── Project View — One Screen ────────────────────────────────────────────────
function ProjView({ proj, brand, qfEnabled, onQfToggle, onBack, onSave, setP, onNew }) {
  const [loading, setLoading]   = useState(false);
  const [loadMsg, setLoadMsg]   = useState("");
  const [copied, setCopied]     = useState("");
  const [showQF, setShowQF]     = useState(false);
  const [qfAns, setQfAns]       = useState({});
  const [sparIn, setSparIn]     = useState("");
  const [sparSend, setSparSend] = useState(false);
  const [genJobs, setGenJobs]   = useState({}); // { "sceneId-type": {status, error} }
  const [pdTab, setPdTab]       = useState("upload");
  const [pdUrl, setPdUrl]       = useState("");
  const fileRef = useRef();
  const sparRef = useRef();

  useEffect(() => { sparRef.current?.scrollIntoView({ behavior: "smooth" }); }, [proj.sparring]);

  const ct = CT[proj.contentType] || CT.product;
  const copy = (text, id) => { navigator.clipboard.writeText(text).catch(() => {}); setCopied(id); setTimeout(() => setCopied(""), 2000); };

  const err = async (msg) => { setLoadMsg(msg); await sleep(2500); };

  // ── Prompt generators ────────────────────────────────────────────────────────
  const analyzeProduct = async (b64, mtype, url) => {
    setLoading(true); setLoadMsg("Produkt wird analysiert...");
    let imageB64 = b64, imageMtype = mtype;
    if (!b64 && url) {
      setLoadMsg("Seite wird geladen...");
      try {
        const html = await Promise.race([fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`).then(r => r.json()).then(d => d?.contents || ""), new Promise((_, r) => setTimeout(() => r(""), 12000))]);
        if (html) {
          const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([^<]+)/i)?.[1] || "";
          const desc  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1] || "";
          const body  = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
          const imgSrc = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
          if (imgSrc) {
            try {
              const abs = imgSrc.startsWith("http") ? imgSrc : new URL(imgSrc, url).href;
              const blob = await Promise.race([fetch(`https://images.weserv.nl/?url=${encodeURIComponent(abs)}&output=jpg&w=800`).then(r => r.ok ? r.blob() : null), new Promise((_, r) => setTimeout(() => r(null), 6000))]);
              if (blob?.size > 1000) { imageMtype = "image/jpeg"; imageB64 = await fileToB64(blob); }
            } catch {}
          }
          const mc = [];
          if (imageB64) mc.push({ type: "image", source: { type: "base64", media_type: imageMtype, data: imageB64 } });
          mc.push({ type: "text", text: `URL:${url}\nTitel:${title}\nBeschreibung:${desc}\nInhalt:${body}` });
          const res = await callClaude(`Product analyst for AI video. Respond ONLY as JSON, no markdown: {"productName":"","colors":[],"usps":["","","","",""],"suggestedDescription":"1-2 sentences","mockupPrompts":[{"setting":"Studio","prompt":""},{"setting":"Lifestyle","prompt":""},{"setting":"Abstract","prompt":""}]}`, mc, 600);
          const a = parseJ(res) || { suggestedDescription: title, usps: [], colors: [], mockupPrompts: [] };
          const { mockupPrompts, ...analyzed } = a;
          await onSave({ ...proj, productData: { imageB64, mediaType: imageMtype, imageUrl: url, analyzed, mockupPrompts: mockupPrompts || [] }, proj: { ...proj.proj, product: analyzed.suggestedDescription || proj.proj?.product } });
          setLoading(false); return;
        }
      } catch { await err("Seite nicht lesbar — bitte Bild hochladen"); setLoading(false); return; }
    }
    try {
      const res = await callClaude(`Product analyst for AI video. Respond ONLY as JSON: {"productName":"","colors":[],"usps":["","","","",""],"suggestedDescription":"","mockupPrompts":[{"setting":"Studio","prompt":""},{"setting":"Lifestyle","prompt":""},{"setting":"Abstract","prompt":""}]}`,
        [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: imageMtype, data: imageB64 } }, { type: "text", text: "Analyze this product image. Be precise and concise." }] }], 600);
      const a = parseJ(res) || { suggestedDescription: res, usps: [], colors: [], mockupPrompts: [] };
      const { mockupPrompts, ...analyzed } = a;
      await onSave({ ...proj, productData: { imageB64, mediaType: imageMtype, imageUrl: "", analyzed, mockupPrompts: mockupPrompts || [] }, proj: { ...proj.proj, product: analyzed.suggestedDescription || proj.proj?.product } });
    } catch (e) { await err(`Fehler: ${e.message}`); }
    setLoading(false);
  };

  const genAll = async (answers) => {
    setShowQF(false); setLoading(true);
    const typeP = { product: "Realistic product film, cinematic.", ugc: "UGC style: authentic, handheld.", talkinghead: "Talking head, direct to camera, B-Roll.", impossible: "Impossible AI shots, surreal." };
    const ansCtx = answers && Object.keys(answers).length ? ` Direction: ${Object.entries(answers).map(([k, v]) => `${k}=${v}`).join(",")}` : "";
    const prod = proj.productData?.analyzed;
    const pCtx = prod ? `${prod.productName || ""}, ${(prod.colors || []).join(", ")}, ${prod.suggestedDescription || ""}`.trim() : proj.proj?.product || "";
    try {
      // Brief (internal)
      setLoadMsg("Brief wird erstellt...");
      const ctP = { product: "Realistic product film.", ugc: "UGC style: authentic, handheld.", talkinghead: "Talking head / offer ad.", impossible: "AI Creative: impossible shots." };
      const brief = parseJ(await claudeS(`Creative director for AI video. Type: ${ctP[proj.contentType]}\nBrand: ${JSON.stringify(brand.foundation)}\nProduct: ${JSON.stringify(prod)}\nRespond ONLY as JSON: {"coreMessage":"","emotion":"","visualDirection":"","cta":""}`,
        `Goal: ${proj.proj?.goal || "Awareness"} | Platform: ${proj.proj?.platform || "Instagram"} | Product: ${proj.proj?.product}`, 600)) || {};

      // Scenes
      setLoadMsg("Szenen werden entwickelt...");
      const scenes = parseJ(await claudeS(
        `Scene writer for AI video. Style: ${typeP[proj.contentType]}\nBrief: ${JSON.stringify(brief)}\nProduct: ${JSON.stringify(prod)}\nBrand: ${brand.foundation?.styleTokens}.${ansCtx}\nRespond ONLY as JSON array:\n[{"id":1,"duration":"~3s","setting":"","action":"","camera":"","lighting":"","mood":"","productPlacement":""}]`,
        `Create exactly ${proj.sceneCount || 5} scenes.`, 2500));
      if (!scenes?.length) throw new Error("Szenen konnten nicht erstellt werden");

      // Keyframe prompts
      setLoadMsg("Keyframe-Prompts...");
      const tool = IMG_MODELS[proj.imageTool || "flux-dev-image"];
      const sc = scenes.map(s => ({ id: s.id, setting: s.setting, action: s.action, camera: s.camera, lighting: s.lighting, mood: s.mood }));
      const keyframes = parseJ(await claudeS(
        `${tool?.name || "Flux"} image prompt specialist for AI video keyframes.\nBrand: ${brand.foundation?.styleTokens || "cinematic, premium"}. Product: ${pCtx}\nMANDATORY: Every prompt MUST include camera angle + lighting. Format: "[camera angle], [subject], [lighting], [mood]"\nEnglish. Max 35 words. Respond ONLY as JSON array:\n[{"sceneId":1,"startFrame":"[angle], [subject], [lighting], [mood]"}]`,
        `Scenes: ${JSON.stringify(sc)}`, 3000));
      if (!keyframes?.length) throw new Error("Keyframe-Prompts konnten nicht erstellt werden");

      // Video prompts
      setLoadMsg("Video-Prompts...");
      const vidModel = VID_MODELS[proj.videoTool || "kling-v2.6-pro-i2v"];
      const videoPrompts = parseJ(await claudeS(
        `${vidModel?.name || "Kling"} video prompt specialist.\nContent: ${proj.contentType}. Brand: ${brand.foundation?.styleTokens || "cinematic, premium"}.\nMANDATORY structure in one sentence: 1. Camera move + angle 2. Subject + action 3. Light + atmosphere\nEnglish. Respond ONLY as JSON array:\n[{"sceneId":1,"prompt":"[camera]. [action]. [light].","negativePrompt":"","duration":"4"}]`,
        `Scenes: ${JSON.stringify(sc)}`, 3000));
      if (!videoPrompts?.length) throw new Error("Video-Prompts konnten nicht erstellt werden");

      await onSave({ ...proj, brief, scenes, keyframes, videoPrompts, sceneAnswers: answers || null });
    } catch (e) { await err(`Fehler: ${e.message}`); }
    setLoading(false);
  };

  const regenOne = async (sceneId, type) => {
    const scene = proj.scenes?.find(s => s.id === sceneId);
    if (!scene) return;
    setLoading(true); setLoadMsg(`Szene ${sceneId} wird neu generiert...`);
    try {
      if (type === "keyframe") {
        const tool = IMG_MODELS[proj.imageTool || "flux-dev-image"];
        const res = parseJ(await claudeS(`${tool?.name} keyframe prompt. MANDATORY: camera angle + lighting. "[angle],[subject],[light],[mood]". English. Max 35 words. Respond ONLY as JSON: {"sceneId":${sceneId},"startFrame":"..."}`, `Scene: ${JSON.stringify(scene)}`, 300));
        if (res) { const updated = (proj.keyframes || []).map(k => k.sceneId === sceneId ? { ...k, ...res } : k); if (!updated.find(k => k.sceneId === sceneId)) updated.push(res); await onSave({ ...proj, keyframes: updated }); }
      } else {
        const vidModel = VID_MODELS[proj.videoTool || "kling-v2.6-pro-i2v"];
        const res = parseJ(await claudeS(`${vidModel?.name} video prompt. MANDATORY: camera+action+light in one sentence. English. Respond ONLY as JSON: {"sceneId":${sceneId},"prompt":"...","negativePrompt":"","duration":"4"}`, `Scene: ${JSON.stringify(scene)}`, 300));
        if (res) { const updated = (proj.videoPrompts || []).map(v => v.sceneId === sceneId ? { ...v, ...res } : v); if (!updated.find(v => v.sceneId === sceneId)) updated.push(res); await onSave({ ...proj, videoPrompts: updated }); }
      }
    } catch (e) { await err(`Fehler: ${e.message}`); }
    setLoading(false);
  };

  // ── Sparring ─────────────────────────────────────────────────────────────────
  const startSpar = async () => {
    setLoading(true); setLoadMsg("Konzepte werden generiert...");
    try {
      const init = "Propose 5 concrete impossible concepts. Numbered, 2-3 sentences each. Provocatively creative.";
      const res = await callClaude(`Creative sparring partner for AI video. Propose IMPOSSIBLE concepts achievable with AI. Product: ${proj.productData?.analyzed?.suggestedDescription || proj.proj?.product}.`, [{ role: "user", content: init }], 1000);
      await onSave({ ...proj, sparring: [{ role: "user", content: init }, { role: "assistant", content: res }] });
    } catch (e) { await err(`Fehler: ${e.message}`); }
    setLoading(false);
  };
  const sendSpar = async (input) => {
    if (!input.trim() || sparSend) return;
    setSparIn(""); setSparSend(true);
    try {
      const msgs = [...(proj.sparring || []), { role: "user", content: input }];
      const res = await callClaude(`Creative sparring partner. Impossible AI video shots. Product: ${proj.productData?.analyzed?.suggestedDescription || proj.proj?.product}.`, msgs, 800);
      await onSave({ ...proj, sparring: [...msgs, { role: "assistant", content: res }] });
    } catch (e) { await onSave({ ...proj, sparring: [...(proj.sparring || []), { role: "user", content: input }, { role: "assistant", content: `Fehler: ${e.message}` }] }); }
    setSparSend(false);
  };
  const sparToScenes = async () => {
    setLoading(true); setLoadMsg("Szenen werden erstellt...");
    try {
      const conv = (proj.sparring || []).map(m => `${m.role === "user" ? "User" : "Claude"}: ${m.content}`).join("\n\n");
      const scenes = parseJ(await claudeS(`Extract scenes from sparring. Respond ONLY as JSON array:\n[{"id":1,"duration":"~3s","setting":"","action":"","camera":"","lighting":"","mood":""}]`, `Sparring:\n${conv.slice(0, 3000)}\n\nCreate ${proj.sceneCount || 5} scenes.`, 2000));
      if (!scenes?.length) throw new Error("Szenen konnten nicht erstellt werden");
      const sc = scenes.map(s => ({ id: s.id, setting: s.setting, action: s.action, mood: s.mood }));
      const kf = parseJ(await claudeS(`Keyframe prompts. MANDATORY: camera+light. Respond ONLY as JSON array: [{"sceneId":1,"startFrame":"..."}]`, `Scenes: ${JSON.stringify(sc)}`, 2500));
      const vp = parseJ(await claudeS(`Video prompts. MANDATORY: camera+action+light in one sentence. Respond ONLY as JSON array: [{"sceneId":1,"prompt":"...","negativePrompt":"","duration":"4"}]`, `Scenes: ${JSON.stringify(sc)}`, 2500));
      await onSave({ ...proj, scenes, keyframes: kf || [], videoPrompts: vp || [] });
    } catch (e) { await err(`Fehler: ${e.message}`); }
    setLoading(false);
  };

  // ── Generation via muapi.ai ───────────────────────────────────────────────────
  const setJob = (key, val) => setGenJobs(prev => ({ ...prev, [key]: { ...prev[key], ...val } }));

  const generateImage = async (scene) => {
    const k = `${scene.id}-image`;
    const kf = (proj.keyframes || []).find(x => x.sceneId === scene.id);
    const prompt = kf?.startFrame || `${scene.setting}, ${scene.action}, ${scene.mood}`;
    setJob(k, { status: "Wird gesendet..." });
    try {
      const sub = await muSubmit(proj.imageTool || "flux-dev-image", { prompt, aspect_ratio: "16:9" });
      if (!sub.request_id) throw new Error(sub.message || sub.error || "Submission fehlgeschlagen");
      setJob(k, { status: "Generiert..." });
      const res = await muPollUntilDone(sub.request_id, s => setJob(k, { status: s === "processing" ? "Generiert..." : s }));
      const url = res?.data?.image_url || res?.image?.url || res?.data?.url;
      if (!url) throw new Error("Kein Bild-URL in Ergebnis");
      const generations = { ...proj.generations, [scene.id]: { ...(proj.generations?.[scene.id] || {}), image: url } };
      await onSave({ ...proj, generations });
      setJob(k, { status: "done" });
    } catch (e) { setJob(k, { status: "error", error: e.message }); }
  };

  const generateVideo = async (scene) => {
    const k = `${scene.id}-video`;
    const vp = (proj.videoPrompts || []).find(x => x.sceneId === scene.id);
    const prompt = vp?.prompt || scene.action || "";
    const imageUrl = proj.generations?.[scene.id]?.image;
    const model = proj.videoTool || "kling-v2.6-pro-i2v";
    const isI2V = VID_MODELS[model]?.i2v && imageUrl;
    const endpoint = isI2V ? model : model.replace("-i2v", "-t2v").replace("kling-v2.6-pro-i2v", "kling-v2.6-pro-t2v").replace("veo3.1-image-to-video", "veo3.1-text-to-video").replace("wan2.5-image-to-video", "wan2.5-text-to-video");
    setJob(k, { status: "Wird gesendet..." });
    try {
      const body = { prompt, duration: parseInt(vp?.duration || "4"), aspect_ratio: "16:9", ...(isI2V ? { image_url: imageUrl } : {}) };
      const sub = await muSubmit(endpoint, body);
      if (!sub.request_id) throw new Error(sub.message || sub.error || "Submission fehlgeschlagen");
      setJob(k, { status: "Generiert..." });
      const res = await muPollUntilDone(sub.request_id, s => setJob(k, { status: s === "processing" ? "Generiert..." : s }));
      const url = res?.data?.video_url || res?.video?.url || res?.data?.url;
      if (!url) throw new Error("Kein Video-URL in Ergebnis");
      const generations = { ...proj.generations, [scene.id]: { ...(proj.generations?.[scene.id] || {}), video: url } };
      await onSave({ ...proj, generations });
      setJob(k, { status: "done" });
    } catch (e) { setJob(k, { status: "error", error: e.message }); }
  };

  const generateAll = async () => {
    for (const scene of (proj.scenes || [])) {
      await generateImage(scene);
      await generateVideo(scene);
    }
  };

  const updPrompt = (type, sceneId, value) => {
    if (type === "keyframe") setP({ keyframes: (proj.keyframes || []).map(k => k.sceneId === sceneId ? { ...k, startFrame: value } : k) });
    else setP({ videoPrompts: (proj.videoPrompts || []).map(v => v.sceneId === sceneId ? { ...v, prompt: value } : v) });
  };
  const rate = (id, rating, issue = "") => {
    const ratings = { ...proj.ratings, [id]: { rating, issue, ts: new Date().toISOString() } };
    setP({ ratings }); onSave({ ...proj, ratings });
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const hasPrompts = proj.videoPrompts?.length > 0 && proj.keyframes?.length > 0;

  return (
    <div style={{ fontFamily: "inherit", background: "#fff", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", borderBottom: "0.5px solid #efefed", padding: "9px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onBack} style={{ fontSize: 12, color: "#9b9b99", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>← {brand.name}</button>
        <div style={{ width: "0.5px", height: 13, background: "#efefed" }} />
        <input value={proj.proj?.name || ""} onChange={e => setP({ proj: { ...proj.proj, name: e.target.value } })} onBlur={() => onSave(proj)} placeholder="Projektname..." style={{ flex: 1, border: "none", fontSize: 14, fontWeight: 500, background: "transparent", outline: "none", width: "auto" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {hasPrompts && <Btn onClick={generateAll} col="#1D9E75" style={{ padding: "6px 12px", fontSize: 12 }}>⚡ Alle generieren</Btn>}
          <button onClick={onNew} style={{ fontSize: 11, padding: "5px 9px", borderRadius: 7, border: "0.5px solid #d4d4d2", background: "transparent", color: "#5c5c5a", cursor: "pointer" }}>+ Neu</button>
        </div>
      </div>

      {loading && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.3)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 11, padding: "18px 26px", display: "flex", alignItems: "center", gap: 11, boxShadow: "0 8px 32px rgba(0,0,0,.12)" }}>
            <SpinInline col="#7F77DD" />
            <div style={{ fontSize: 13, fontWeight: 500 }}>{loadMsg}</div>
          </div>
        </div>
      )}

      <div style={{ padding: "16px 18px 40px", maxWidth: 760, margin: "0 auto" }}>

        {/* Product card */}
        <div style={{ border: "0.5px solid #efefed", borderRadius: 11, overflow: "hidden", marginBottom: 12 }}>
          {proj.productData?.analyzed ? (
            <div style={{ display: "flex" }}>
              {proj.productData.imageB64 && <div style={{ width: 110, flexShrink: 0, background: "#000", overflow: "hidden" }}><img src={`data:${proj.productData.mediaType || "image/jpeg"};base64,${proj.productData.imageB64}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /></div>}
              <div style={{ flex: 1, padding: "11px 13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 1 }}>{proj.productData.analyzed.productName}</div>
                    {proj.productData.analyzed.colors?.length > 0 && <div style={{ fontSize: 10, color: "#9b9b99" }}>{proj.productData.analyzed.colors.join(" · ")}</div>}
                  </div>
                  <button onClick={() => { setP({ productData: { imageB64: null, mediaType: null, imageUrl: "", analyzed: null, mockupPrompts: [] } }); onSave({ ...proj, productData: { imageB64: null, mediaType: null, imageUrl: "", analyzed: null, mockupPrompts: [] } }); }} style={{ fontSize: 10, color: "#9b9b99", background: "none", border: "none", cursor: "pointer" }}>↺ ändern</button>
                </div>
                {proj.productData.analyzed.usps?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{proj.productData.analyzed.usps.slice(0, 4).map((u, i) => <span key={i} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, background: "#f7f7f6", color: "#5c5c5a" }}>{u}</span>)}</div>}
              </div>
            </div>
          ) : (
            <div style={{ padding: "13px 15px" }}>
              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 8, color: "#5c5c5a" }}>Produkt hinzufügen</div>
              <div style={{ display: "flex", gap: 5, marginBottom: 9 }}>
                {[["upload", "↑ Hochladen"], ["url", "URL"], ["manual", "Manuell"]].map(([t, l]) => (
                  <button key={t} onClick={() => setPdTab(t)} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 6, cursor: "pointer", border: `0.5px solid ${pdTab === t ? brand.color : "#d4d4d2"}`, background: pdTab === t ? `${brand.color}18` : "transparent", color: pdTab === t ? brand.color : "#5c5c5a", fontWeight: pdTab === t ? 500 : 400 }}>{l}</button>
                ))}
              </div>
              {pdTab === "upload" && (
                <div onClick={() => fileRef.current?.click()} style={{ border: "1.5px dashed #d4d4d2", borderRadius: 9, padding: "18px", textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 20, color: "#9b9b99", marginBottom: 4 }}>⬆</div>
                  <div style={{ fontSize: 12, color: "#5c5c5a" }}>Produktbild hochladen oder ziehen</div>
                  <input ref={fileRef} type="file" accept="image/*" onChange={async e => { const f = e.target.files[0]; if (f) analyzeProduct(await fileToB64(f), f.type, null); }} style={{ display: "none" }} />
                </div>
              )}
              {pdTab === "url" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={pdUrl} onChange={e => setPdUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && analyzeProduct(null, null, pdUrl.trim())} placeholder="https://shop.example.com/produkt" />
                  <Btn onClick={() => analyzeProduct(null, null, pdUrl.trim())} col={brand.color} style={{ whiteSpace: "nowrap", padding: "0 12px", width: "auto" }}>Analysieren</Btn>
                </div>
              )}
              {pdTab === "manual" && <textarea value={proj.proj?.product || ""} onChange={e => setP({ proj: { ...proj.proj, product: e.target.value } })} onBlur={() => onSave(proj)} placeholder="Produkt beschreiben..." rows={3} />}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 220px" }}>
            <Label>Typ</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Object.entries(CT).map(([k, v]) => (
                <button key={k} onClick={() => setP({ contentType: k })} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 7, cursor: "pointer", border: `0.5px solid ${proj.contentType === k ? v.col : "#d4d4d2"}`, background: proj.contentType === k ? `${v.col}12` : "transparent", color: proj.contentType === k ? v.col : "#5c5c5a", fontWeight: proj.contentType === k ? 500 : 400 }}>
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Szenen</Label>
            <div style={{ display: "flex", gap: 3 }}>{[3, 4, 5, 6, 8, 10].map(n => (
              <button key={n} onClick={() => setP({ sceneCount: n })} style={{ width: 28, height: 26, borderRadius: 6, cursor: "pointer", fontFamily: "monospace", fontSize: 11, border: `0.5px solid ${proj.sceneCount === n ? ct.col : "#d4d4d2"}`, background: proj.sceneCount === n ? `${ct.col}12` : "transparent", color: proj.sceneCount === n ? ct.col : "#5c5c5a", fontWeight: proj.sceneCount === n ? 600 : 400 }}>{n}</button>
            ))}</div>
          </div>
          <div>
            <Label>Keyframe-Modell</Label>
            <select value={proj.imageTool || "flux-dev-image"} onChange={e => setP({ imageTool: e.target.value })} style={{ width: "auto" }}>
              {Object.entries(IMG_MODELS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Video-Modell</Label>
            <select value={proj.videoTool || "kling-v2.6-pro-i2v"} onChange={e => setP({ videoTool: e.target.value })} style={{ width: "auto" }}>
              {Object.entries(VID_MODELS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Label>Richtungs-Fragen</Label>
            <Toggle val={qfEnabled} onChange={onQfToggle} col={ct.col} />
          </div>
          <div style={{ marginLeft: "auto" }}>
            {proj.contentType === "impossible" && !proj.scenes?.length && !proj.sparring?.length
              ? <Btn onClick={startSpar} col={ct.col}>✦ Sparring starten</Btn>
              : qfEnabled && !proj.scenes?.length
                ? <Btn onClick={() => setShowQF(true)} col={ct.col}>⚡ Alles generieren</Btn>
                : <Btn onClick={() => genAll(proj.sceneAnswers || null)} col={ct.col}>{proj.scenes?.length ? "↺ Neu generieren" : "⚡ Alles generieren"}</Btn>}
          </div>
        </div>

        {/* Projekt-Felder */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <Fld label="Kampagnenziel" value={proj.proj?.goal || ""} onChange={v => setP({ proj: { ...proj.proj, goal: v } })} onBlur={() => onSave(proj)} placeholder="z.B. Produktlaunch, Awareness, Abverkauf..." />
          <Fld label="Plattform" value={proj.proj?.platform || ""} onChange={v => setP({ proj: { ...proj.proj, platform: v } })} onBlur={() => onSave(proj)} placeholder="Instagram, TikTok, YouTube..." />
        </div>

        {/* Quickfire */}
        {showQF && (
          <div style={{ border: `1px solid ${ct.col}55`, borderRadius: 11, padding: "13px 15px", marginBottom: 12, background: `${ct.col}07` }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 11 }}>Richtungs-Fragen</div>
            {(QUICKFIRE[proj.contentType] || QUICKFIRE.product).map((q, qi) => (
              <div key={q.id} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: "flex", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 8, background: "#f7f7f6", padding: "1px 5px", borderRadius: 4, color: "#9b9b99" }}>{qi + 1}</span>{q.q}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {q.opts.map(opt => (
                    <button key={opt.v} onClick={() => setQfAns(a => ({ ...a, [q.id]: opt.v }))} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: "pointer", border: `0.5px solid ${qfAns[q.id] === opt.v ? ct.col : "#d4d4d2"}`, background: qfAns[q.id] === opt.v ? `${ct.col}15` : "transparent", color: qfAns[q.id] === opt.v ? ct.col : "#5c5c5a", fontWeight: qfAns[q.id] === opt.v ? 500 : 400 }}>{opt.l}</button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
              <Btn2 onClick={() => { setShowQF(false); genAll(null); }}>Überspringen</Btn2>
              <Btn onClick={() => { const q = QUICKFIRE[proj.contentType] || QUICKFIRE.product; if (q.every(x => qfAns[x.id])) { setP({ sceneAnswers: qfAns }); genAll(qfAns); } }} col={ct.col} style={{ flex: 2, opacity: (QUICKFIRE[proj.contentType] || QUICKFIRE.product).every(q => qfAns[q.id]) ? 1 : 0.5 }}>Generieren →</Btn>
            </div>
          </div>
        )}

        {/* Sparring */}
        {proj.contentType === "impossible" && proj.sparring?.length > 0 && !proj.scenes?.length && (
          <div style={{ border: "0.5px solid rgba(216,90,48,.3)", borderRadius: 11, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ maxHeight: 260, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
              {proj.sparring.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 6, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  {m.role === "assistant" && <div style={{ width: 15, height: 15, borderRadius: "50%", background: "rgba(216,90,48,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#D85A30", flexShrink: 0, marginTop: 2 }}>✦</div>}
                  <div style={{ maxWidth: "82%", fontSize: 12, lineHeight: 1.6, padding: "6px 9px", borderRadius: 8, whiteSpace: "pre-wrap", background: m.role === "user" ? "#f7f7f6" : "rgba(216,90,48,.06)", border: m.role === "assistant" ? "0.5px solid rgba(216,90,48,.2)" : "0.5px solid #efefed" }}>{m.content}</div>
                </div>
              ))}
              {sparSend && <div style={{ display: "flex", gap: 6 }}><div style={{ width: 15, height: 15, borderRadius: "50%", background: "rgba(216,90,48,.15)", flexShrink: 0 }} /><div style={{ fontSize: 12, padding: "6px 9px", borderRadius: 8, background: "rgba(216,90,48,.06)", border: "0.5px solid rgba(216,90,48,.2)", display: "flex", gap: 3, alignItems: "center" }}><Dots /></div></div>}
              <div ref={sparRef} />
            </div>
            <div style={{ borderTop: "0.5px solid #efefed", padding: "7px 10px", display: "flex", gap: 5 }}>
              <input value={sparIn} onChange={e => setSparIn(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendSpar(sparIn))} disabled={sparSend} placeholder="Reagieren... (Enter)" style={{ flex: 1 }} />
              <Btn onClick={() => sendSpar(sparIn)} col="#D85A30" style={{ width: "auto", padding: "0 11px", opacity: sparSend ? 0.5 : 1 }}>→</Btn>
            </div>
            <div style={{ padding: "7px 10px", borderTop: "0.5px solid #efefed" }}>
              <Btn onClick={sparToScenes} col="#D85A30">Konzept → Szenen & Prompts</Btn>
            </div>
          </div>
        )}

        {/* Scenes */}
        {(proj.scenes || []).map(scene => {
          const kf = (proj.keyframes || []).find(k => k.sceneId === scene.id);
          const vp = (proj.videoPrompts || []).find(v => v.sceneId === scene.id);
          const r = proj.ratings?.[scene.id] || {};
          const iJ = genJobs[`${scene.id}-image`];
          const vJ = genJobs[`${scene.id}-video`];
          const imgResult = proj.generations?.[scene.id]?.image;
          const vidResult = proj.generations?.[scene.id]?.video;

          return (
            <div key={scene.id} style={{ border: `0.5px solid ${r.rating ? "rgba(29,158,117,.35)" : "#efefed"}`, borderRadius: 11, overflow: "hidden", marginBottom: 10 }}>
              {/* Scene header */}
              <div style={{ padding: "7px 12px", background: "#f7f7f6", borderBottom: "0.5px solid #efefed", display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontFamily: "monospace", fontSize: 8, padding: "2px 5px", borderRadius: 4, background: `${ct.col}18`, color: ct.col }}>SZENE {scene.id}</span>
                <span style={{ fontSize: 10, color: "#9b9b99" }}>{scene.duration}</span>
                <span style={{ fontSize: 11, color: "#1a1a19", flex: 1 }}>{scene.action}</span>
                <span style={{ fontSize: 10, color: "#9b9b99", fontStyle: "italic" }}>{scene.mood}</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {["✅", "⚠️", "❌"].map(rt => <button key={rt} onClick={() => rate(scene.id, rt)} style={{ padding: "2px 5px", borderRadius: 5, border: `0.5px solid ${r.rating === rt ? "#1D9E75" : "#efefed"}`, background: r.rating === rt ? "rgba(29,158,117,.1)" : "transparent", cursor: "pointer", fontSize: 11, opacity: r.rating && r.rating !== rt ? 0.3 : 1 }}>{rt}</button>)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {/* Keyframe */}
                <div style={{ padding: "9px 12px", borderRight: "0.5px solid #efefed" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontFamily: "monospace", color: "#9b9b99", textTransform: "uppercase" }}>Keyframe · {IMG_MODELS[proj.imageTool || "flux-dev-image"]?.name}</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      {kf?.startFrame && <CopyBtn onClick={() => copy(kf.startFrame, `kf-${scene.id}`)} done={copied === `kf-${scene.id}`} />}
                      <IBtn onClick={() => regenOne(scene.id, "keyframe")} title="Neu generieren">↺</IBtn>
                    </div>
                  </div>
                  {kf?.startFrame && <EPrompt value={kf.startFrame} onChange={v => updPrompt("keyframe", scene.id, v)} onBlur={() => onSave(proj)} />}
                  {!kf?.startFrame && <div style={{ fontSize: 11, color: "#9b9b99", fontStyle: "italic" }}>Noch nicht generiert</div>}
                  {/* Image generation */}
                  <div style={{ marginTop: 8 }}>
                    {imgResult
                      ? <div><img src={imgResult} alt="" style={{ width: "100%", borderRadius: 7, display: "block", marginBottom: 5 }} /><div style={{ display: "flex", gap: 4 }}><a href={imgResult} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "0.5px solid #d4d4d2", color: "#5c5c5a", textAlign: "center", textDecoration: "none" }}>↓ Download</a><IBtn onClick={() => generateImage(scene)}>↺</IBtn></div></div>
                      : <GenBtn onClick={() => generateImage(scene)} job={iJ} label="Bild generieren" col="#BA7517" />}
                  </div>
                </div>

                {/* Video prompt + generation */}
                <div style={{ padding: "9px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontFamily: "monospace", color: "#9b9b99", textTransform: "uppercase" }}>Video · {VID_MODELS[proj.videoTool || "kling-v2.6-pro-i2v"]?.name}</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      {vp?.prompt && <CopyBtn onClick={() => copy(vp.prompt, `vp-${scene.id}`)} done={copied === `vp-${scene.id}`} />}
                      <IBtn onClick={() => regenOne(scene.id, "video")}>↺</IBtn>
                    </div>
                  </div>
                  {vp?.prompt && <EPrompt value={vp.prompt} onChange={v => updPrompt("video", scene.id, v)} onBlur={() => onSave(proj)} />}
                  {!vp?.prompt && <div style={{ fontSize: 11, color: "#9b9b99", fontStyle: "italic" }}>Noch nicht generiert</div>}
                  {vp?.negativePrompt && <div style={{ fontSize: 10, fontFamily: "monospace", color: "#9b9b99", marginTop: 3, lineHeight: 1.5, opacity: .65 }}>– {vp.negativePrompt}</div>}
                  {/* Video generation */}
                  <div style={{ marginTop: 8 }}>
                    {vidResult
                      ? <div><video src={vidResult} controls style={{ width: "100%", borderRadius: 7, display: "block", marginBottom: 5 }} /><div style={{ display: "flex", gap: 4 }}><a href={vidResult} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 11, padding: "4px 7px", borderRadius: 6, border: "0.5px solid #d4d4d2", color: "#5c5c5a", textAlign: "center", textDecoration: "none" }}>↓ Download</a><IBtn onClick={() => generateVideo(scene)}>↺</IBtn></div></div>
                      : <GenBtn onClick={() => generateVideo(scene)} job={vJ} label="Video generieren" col="#7F77DD" note={!imgResult ? "Erst Keyframe generieren für beste Ergebnisse" : null} />}
                  </div>
                </div>
              </div>

              {r.rating && (r.rating === "⚠️" || r.rating === "❌") && (
                <div style={{ padding: "5px 12px", borderTop: "0.5px solid #efefed", display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {["Produkt-Form", "Produkt-Farbe", "Kamerabewegung", "Objektbewegung", "Beleuchtung", "Stil/Mood", "Sonstiges"].map(tag => (
                    <button key={tag} onClick={() => rate(scene.id, r.rating, tag)} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, cursor: "pointer", border: `0.5px solid ${r.issue === tag ? "#BA7517" : "#efefed"}`, background: r.issue === tag ? "rgba(186,117,23,.1)" : "transparent", color: r.issue === tag ? "#BA7517" : "#9b9b99" }}>{tag}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Mockup prompts */}
        {proj.productData?.mockupPrompts?.length > 0 && !proj.scenes?.length && (
          <div style={{ marginTop: 4 }}>
            <Label>Mockup-Prompt-Ideen</Label>
            {proj.productData.mockupPrompts.map((mp, i) => (
              <div key={i} style={{ background: "#f7f7f6", borderRadius: 8, padding: "6px 9px", marginBottom: 4, display: "flex", gap: 7, alignItems: "flex-start" }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: brand.color, flexShrink: 0, marginTop: 1 }}>{mp.setting}</span>
                <span style={{ fontSize: 11, color: "#5c5c5a", lineHeight: 1.5, flex: 1 }}>{mp.prompt}</span>
                <CopyBtn onClick={() => copy(mp.prompt, `mp-${i}`)} done={copied === `mp-${i}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────
function EPrompt({ value, onChange, onBlur }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <textarea value={value} onChange={e => onChange(e.target.value)} onBlur={() => { setEditing(false); onBlur(); }} autoFocus rows={4} style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.6, border: "0.5px solid #7F77DD" }} />;
  return <div onClick={() => setEditing(true)} style={{ fontFamily: "monospace", fontSize: 11, background: "#f7f7f6", borderRadius: 6, padding: "6px 8px", lineHeight: 1.6, color: "#5c5c5a", cursor: "text", wordBreak: "break-word", border: "0.5px solid transparent", transition: "border-color .15s", minHeight: 38 }}
    onMouseEnter={e => e.currentTarget.style.borderColor = "#d4d4d2"} onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}>{value}</div>;
}

function GenBtn({ onClick, job, label, col, note }) {
  const isL = job && job.status !== "done" && job.status !== "error";
  const isE = job?.status === "error";
  return <div>
    {note && !job && <div style={{ fontSize: 10, color: "#9b9b99", marginBottom: 4, fontStyle: "italic" }}>{note}</div>}
    <button onClick={onClick} disabled={isL} style={{ width: "100%", padding: "7px 11px", borderRadius: 7, border: "none", background: isE ? "#FAECE7" : isL ? "#f0f0f0" : col, color: isE ? "#D85A30" : isL ? "#9b9b99" : "#fff", fontSize: 12, fontWeight: 500, cursor: isL ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      {isL && <Dots />}
      {isE ? `Fehler: ${job.error}` : isL ? job.status : label}
    </button>
  </div>;
}

function Fld({ label, rows, value, onChange, onBlur, placeholder, hint }) {
  const T = rows ? "textarea" : "input";
  return <div style={{ marginBottom: 8 }}>
    <Label>{label}</Label>
    {hint && <div style={{ fontSize: 10, color: "#9b9b99", marginBottom: 3 }}>{hint}</div>}
    <T value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder || ""} rows={rows} />
  </div>;
}
function Label({ children }) { return <div style={{ fontSize: 10, fontWeight: 500, color: "#5c5c5a", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em", fontFamily: "monospace" }}>{children}</div>; }
function Btn({ onClick, col, children, style = {} }) { return <button onClick={onClick} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: col, color: "#fff", fontSize: 12, fontWeight: 500, cursor: "pointer", display: "block", width: "100%", transition: "background .3s", ...style }}>{children}</button>; }
function Btn2({ onClick, children }) { return <button onClick={onClick} style={{ flex: 1, padding: "7px", borderRadius: 7, border: "0.5px solid #d4d4d2", background: "transparent", color: "#5c5c5a", fontSize: 12, cursor: "pointer" }}>{children}</button>; }
function IBtn({ onClick, children, title }) { return <button onClick={onClick} title={title} style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, border: "0.5px solid #efefed", background: "transparent", cursor: "pointer", color: "#9b9b99" }}>{children}</button>; }
function CopyBtn({ onClick, done }) { return <button onClick={onClick} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, border: "0.5px solid #efefed", background: "transparent", cursor: "pointer", color: done ? "#1D9E75" : "#9b9b99" }}>{done ? "✓" : "Kopieren"}</button>; }
function Toggle({ val, onChange, col }) { return <div onClick={() => onChange(!val)} style={{ width: 28, height: 16, borderRadius: 8, background: val ? col : "#d4d4d2", cursor: "pointer", position: "relative", transition: "background .2s" }}><div style={{ position: "absolute", top: 2, left: val ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} /></div>; }
function Dots() { return <span style={{ display: "flex", gap: 3 }}><style>{"@keyframes blink{0%,100%{opacity:.3}50%{opacity:1}}"}</style>{[0, 0.3, 0.6].map((d, i) => <span key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#9b9b99", animation: `blink 1.2s ${d}s ease infinite`, display: "inline-block" }} />)}</span>; }
function SpinInline({ col = "#9b9b99" }) { return <span style={{ display: "inline-block", animation: "spin 1.2s linear infinite", fontSize: 14, color: col }}><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>◎</span>; }
function Spin({ msg }) { return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 14 }}><SpinInline col="#9b9b99" /><div style={{ fontSize: 12, color: "#9b9b99" }}>{msg}</div></div>; }
