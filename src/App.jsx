import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";

// ─── API (proxied through Vercel) ─────────────────────────────────────────────
const claude = async (system, messages, maxTokens = 1500) => {
  const r = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.content?.[0]?.text ?? "";
};
const claudeS = (sys, user, maxTokens) => claude(sys, [{ role: "user", content: user }], maxTokens);
const parseJ = (t) => {
  if (!t) return null;
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch {}
  const arrMatch = t.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  const objMatch = t.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  return null;
};
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("de-DE", { day:"2-digit", month:"2-digit", year:"2-digit" }); } catch { return ""; } };

// localStorage helpers for per-user preferences
const getLocal = (k, fallback = null) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; } };
const setLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ─── Constants ────────────────────────────────────────────────────────────────
const BRAND_COLORS = ["#7F77DD","#1D9E75","#BA7517","#D85A30","#D4537E","#378ADD","#639922","#888780"];

const CONTENT_TYPES = {
  product:     { label:"Product Ad",   icon:"◈", desc:"Real-wirkende Produktfilme",             col:"#7F77DD" },
  ugc:         { label:"UGC Style",    icon:"◉", desc:"Authentisch, handheld, person-zentriert", col:"#1D9E75" },
  talkinghead: { label:"Talking Head", icon:"◎", desc:"Person spricht direkt zur Kamera",        col:"#BA7517" },
  impossible:  { label:"AI Creative",  icon:"✦", desc:"Unmögliche Shots — wo AI glänzt",         col:"#D85A30" },
};

const ENGINES = {
  kling:    { name:"Kling 3.0",    profile:"Stärken: realistische Produktbewegung. Kamera explizit benennen. Negativ: 'jittery, blurry, flickering'" },
  seedance: { name:"Seedance 2.0", profile:"Stärken: cinematische Qualität, Atmosphäre. Natürliche Sprache. Negativ: 'overexposed, washed out, shaky'" },
  veo:      { name:"Veo 3",        profile:"Stärken: Physik, Details, Naturlicht. Sehr detailliert. Kamera in []. Negativ: 'artificial, plastic, CGI'" },
  hailuo:   { name:"Hailuo",       profile:"Stärken: stabile Objekte, schnell. Kurze Prompts. Negativ: 'distorted, blurry'" },
};

const IMAGE_TOOLS = {
  midjourney: { name:"Midjourney", tip:"--ar 9:16, Style-Keywords ans Ende" },
  flux:       { name:"Flux",       tip:"Natürliche Sprache, Licht & Material explizit" },
  firefly:    { name:"Firefly",    tip:"Optimal für Produktfarben-Treue" },
  nanobanana: { name:"Nanobanana", tip:"Optimiert für Video-Keyframes" },
};

const ISSUE_TAGS = ["Produkt-Form","Produkt-Farbe","Kamerabewegung","Objektbewegung","Beleuchtung","Stil/Mood","Sonstiges"];

const QUICKFIRE = {
  product: [
    { id:"proximity", q:"Wie nah ist das Produkt?", opts:[{v:"extreme",l:"Extreme Nahaufnahmen"},{v:"medium",l:"Mittelnahaufnahmen"},{v:"mixed",l:"Beides abwechselnd"}] },
    { id:"setting",   q:"In welchem Setting?",       opts:[{v:"studio",l:"Neutrales Studio"},{v:"context",l:"Produktspezifische Umgebung"},{v:"abstract",l:"Abstrakt / kreativ"}] },
    { id:"camera",    q:"Kamerabewegung?",            opts:[{v:"still",l:"Statisch"},{v:"smooth",l:"Ruhig & kontrolliert"},{v:"organic",l:"Leicht organisch"}] },
    { id:"mood",      q:"Atmosphäre?",                opts:[{v:"dark",l:"Dunkel & Premium"},{v:"bright",l:"Hell & Clean"},{v:"warm",l:"Warm & Einladend"}] },
  ],
  ugc: [
    { id:"subject",  q:"Wer ist im Video?",    opts:[{v:"using",l:"Person benutzt Produkt"},{v:"talking",l:"Person spricht zur Kamera"},{v:"mixed",l:"Gemischt"}] },
    { id:"setting",  q:"Setting?",              opts:[{v:"home",l:"Zuhause / Alltag"},{v:"outdoor",l:"Outdoor"},{v:"onthego",l:"Unterwegs"}] },
    { id:"rawness",  q:"Wie authentisch?",      opts:[{v:"raw",l:"Sehr roh & ungefiltert"},{v:"mid",l:"Authentisch aber sauber"},{v:"polished",l:"Leicht poliert"}] },
    { id:"product",  q:"Produktintegration?",   opts:[{v:"hero",l:"Dominant im Vordergrund"},{v:"natural",l:"Natürlich eingebaut"},{v:"subtle",l:"Subtil im Hintergrund"}] },
  ],
  talkinghead: [
    { id:"bg",      q:"Hintergrund?",          opts:[{v:"minimal",l:"Clean / Minimal"},{v:"branded",l:"Branded Umgebung"},{v:"lifestyle",l:"Lifestyle / Kontext"}] },
    { id:"pacing",  q:"Schnittrhythmus?",       opts:[{v:"slow",l:"Ruhig (wenige Cuts)"},{v:"medium",l:"Standard"},{v:"fast",l:"Schnell mit B-Roll"}] },
    { id:"broll",   q:"B-Roll Stil?",           opts:[{v:"product",l:"Produktaufnahmen"},{v:"lifestyle",l:"Lifestyle-Shots"},{v:"graphic",l:"Text / Graphics"}] },
    { id:"energy",  q:"Energie der Person?",    opts:[{v:"calm",l:"Ruhig & vertrauenswürdig"},{v:"energetic",l:"Energetisch & überzeugend"},{v:"friendly",l:"Freundlich & nahbar"}] },
  ],
  impossible: [
    { id:"scale",   q:"Skala?",                opts:[{v:"micro",l:"Mikrokosmos (sehr klein)"},{v:"normal",l:"Normaler Maßstab"},{v:"epic",l:"Riesig / Episch"}] },
    { id:"physics", q:"Physik?",               opts:[{v:"real",l:"Hyperrealistisch"},{v:"slightly",l:"Leicht surreal"},{v:"full",l:"Vollständig surreal"}] },
    { id:"time",    q:"Zeitgefühl?",           opts:[{v:"slow",l:"Zeitlupe"},{v:"normal",l:"Normal"},{v:"lapse",l:"Zeitraffer"}] },
    { id:"mood",    q:"Grundstimmung?",        opts:[{v:"mystic",l:"Mysteriös & Dunkel"},{v:"fresh",l:"Frisch & Lebendig"},{v:"magic",l:"Warm & Magisch"}] },
  ],
};

const STEPS = [
  { id:"product",   label:"Produkt-Setup",  col:"#7F77DD" },
  { id:"brief",     label:"Brief & Typ",    col:"#7F77DD" },
  { id:"scenes",    label:"Szenen",         col:"#7F77DD" },
  { id:"keyframes", label:"Keyframes",      col:"#BA7517" },
  { id:"video",     label:"Video-Prompts",  col:"#BA7517" },
  { id:"review",    label:"Review & Log",   col:"#1D9E75" },
];

const EMPTY_PROJECT = () => ({
  productData: { imageB64:null, mediaType:null, imageUrl:"", analyzed:null, mockupPrompts:[] },
  contentType: "product",
  proj:        { name:"", product:"", goal:"", platform:"Instagram", pacing:"" },
  brief:null, sparring:[], scenes:[], imageTool:"midjourney",
  keyframes:[], engine:"kling", videoPrompts:[], ratings:{},
  step:"product", updatedAt: new Date().toISOString(),
});

// Strip large binary before saving to Supabase
const stripBinary = (projData) => ({
  ...projData,
  productData: projData.productData
    ? { ...projData.productData, imageB64: null }
    : projData.productData,
});

const countSteps = (p) => [
  !!p.productData?.analyzed || !!p.proj?.product,
  !!p.brief,
  p.scenes?.length > 0,
  p.keyframes?.length > 0,
  p.videoPrompts?.length > 0,
  Object.keys(p.ratings || {}).length > 0,
].filter(Boolean).length;

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]             = useState("brands");
  const [brands, setBrands]         = useState({});
  const [activeBrand, setActiveBrand] = useState(null);
  const [projects, setProjects]     = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [loadMsg, setLoadMsg]       = useState("");
  const [copied, setCopied]         = useState("");
  const [quickfireEnabled, setQuickfireEnabled] = useState(true);
  const [appLoading, setAppLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Load quickfire toggle from localStorage
      setQuickfireEnabled(getLocal("qf-enabled", true));

      // Load all brands from Supabase
      const { data: brandsData } = await supabase.from("brands").select("*").order("created_at", { ascending: false });
      const brandMap = {};
      (brandsData || []).forEach(b => brandMap[b.id] = b);
      setBrands(brandMap);

      // Restore last open state from localStorage
      const last = getLocal("fw-last");
      if (last?.brandId && brandMap[last.brandId]) {
        const brand = brandMap[last.brandId];
        setActiveBrand(brand);
        const projs = await loadProjectList(brand.id);
        setProjects(projs);
        if (last.projectId) {
          const { data: projRow } = await supabase.from("projects").select("data").eq("id", last.projectId).single();
          if (projRow?.data) {
            setActiveProject(projRow.data);
            setView("workflow");
            setAppLoading(false);
            return;
          }
        }
        setView("dashboard");
      }
      setAppLoading(false);
    })();
  }, []);

  const loadProjectList = async (brandId) => {
    const { data } = await supabase.from("projects")
      .select("id, name, content_type, step, steps_done, updated_at")
      .eq("brand_id", brandId)
      .order("updated_at", { ascending: false });
    return (data || []).map(p => ({ id:p.id, name:p.name, contentType:p.content_type, updatedAt:p.updated_at, stepsDone:p.steps_done }));
  };

  const saveBrand = async (brand) => {
    await supabase.from("brands").upsert({ id:brand.id, name:brand.name, color:brand.color, foundation:brand.foundation, created_at:brand.createdAt });
  };

  const saveProject = async (projData) => {
    const updated = { ...projData, updatedAt: new Date().toISOString() };
    const toSave = stripBinary(updated);
    setActiveProject(updated); // keep imageB64 in memory for display
    await supabase.from("projects").upsert({
      id: toSave.id,
      brand_id: toSave.brandId,
      name: toSave.proj?.name || "Ohne Titel",
      content_type: toSave.contentType,
      step: toSave.step,
      steps_done: countSteps(toSave),
      data: toSave,
      updated_at: toSave.updatedAt,
    });
    const meta = { id:updated.id, name:updated.proj?.name||"Ohne Titel", contentType:updated.contentType, updatedAt:updated.updatedAt, stepsDone:countSteps(updated) };
    setProjects(prev => { const list=[...prev]; const idx=list.findIndex(p=>p.id===updated.id); if(idx>=0) list[idx]=meta; else list.unshift(meta); return list; });
  };

  const copy = (text, id) => { navigator.clipboard.writeText(text).catch(()=>{}); setCopied(id); setTimeout(()=>setCopied(""),2000); };

  // ── Brand actions ─────────────────────────────────────────────────────────────
  const createBrand = async (name, color) => {
    const brand = { id:uid(), name, color, foundation:{ visualBible:"", styleTokens:"", assetNotes:"" }, createdAt:new Date().toISOString() };
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
    setBrands(prev => { const n={...prev}; delete n[id]; return n; });
    await supabase.from("brands").delete().eq("id", id); // cascades to projects
  };

  const openBrand = async (brand, projList) => {
    setActiveBrand(brand); setProjects(projList); setActiveProject(null);
    setLocal("fw-last", { brandId: brand.id });
    setView("dashboard");
  };

  const selectBrand = async (brand) => {
    const projs = await loadProjectList(brand.id);
    openBrand(brand, projs);
  };

  // ── Project actions ───────────────────────────────────────────────────────────
  const createProject = async () => {
    const proj = { ...EMPTY_PROJECT(), id:uid(), brandId:activeBrand.id };
    await saveProject(proj);
    setLocal("fw-last", { brandId:activeBrand.id, projectId:proj.id });
    setView("workflow");
  };

  const openProject = async (meta) => {
    const { data } = await supabase.from("projects").select("data").eq("id", meta.id).single();
    const proj = data?.data || { ...EMPTY_PROJECT(), id:meta.id, brandId:activeBrand.id };
    setActiveProject(proj);
    setLocal("fw-last", { brandId:activeBrand.id, projectId:meta.id });
    setView("workflow");
  };

  const deleteProject = async (id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    await supabase.from("projects").delete().eq("id", id);
  };

  // Instant step nav — state + background Supabase update
  const goStep = (stepId) => {
    setActiveProject(prev => {
      const updated = { ...prev, step:stepId };
      supabase.from("projects").update({ step:stepId, data:stripBinary(updated), updated_at:new Date().toISOString() }).eq("id", updated.id);
      return updated;
    });
  };

  const updateProject = async (upd) => {
    const merged = { ...activeProject, ...upd };
    await saveProject(merged);
  };

  // ── Generators ────────────────────────────────────────────────────────────────
  const analyzeProduct = async (b64, mtype, url) => {
    setLoading(true); setLoadMsg("Produkt wird analysiert...");
    let imageB64 = b64, imageMtype = mtype;

    if (!b64 && url) {
      setLoadMsg("Seite wird geladen...");
      try {
        const htmlRes = await Promise.race([
          fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`),
          new Promise((_,rej) => setTimeout(()=>rej(new Error("timeout")),12000))
        ]);
        const htmlData = await htmlRes.json();
        const html = htmlData?.contents || "";
        if (!html) throw new Error("no_html");

        const imgCandidates = [];
        const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (ogImg?.[1]) imgCandidates.push(ogImg[1]);
        const twImg = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
        if (twImg?.[1]) imgCandidates.push(twImg[1]);
        const imgTags = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
        for (const m of imgTags.slice(0,10)) { const s=m[1]; if(s&&!s.includes("logo")&&!s.includes("icon")&&s.length>20) imgCandidates.push(s); }

        const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
        const desc  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
        const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,2000);

        setLoadMsg("Produktbild wird extrahiert...");
        for (const candidate of imgCandidates.slice(0,4)) {
          try {
            const absUrl = candidate.startsWith("http") ? candidate : new URL(candidate, url).href;
            const imgRes = await Promise.race([
              fetch(`https://images.weserv.nl/?url=${encodeURIComponent(absUrl)}&output=jpg&w=800`),
              new Promise((_,rej)=>setTimeout(()=>rej(),6000))
            ]);
            if (imgRes.ok) { const blob=await imgRes.blob(); if(blob.size>1000){ imageMtype="image/jpeg"; imageB64=await new Promise((r,j)=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(",")[1]);fr.onerror=j;fr.readAsDataURL(blob);}); break; }}
          } catch { continue; }
        }

        setLoadMsg("Produkt wird analysiert...");
        const msgContent = [];
        if (imageB64) msgContent.push({ type:"image", source:{ type:"base64", media_type:imageMtype, data:imageB64 }});
        msgContent.push({ type:"text", text:`Produktseite: ${url}\nTitel: ${title}\nBeschreibung: ${desc}\nInhalt: ${bodyText}` });
        const res = await claude(
          `Produkt-Analyst für AI Video. Antworte NUR als JSON:
{"productName":"","colors":[],"usps":["USP1","USP2","USP3","USP4","USP5"],"suggestedDescription":"1-2 Sätze","mockupPrompts":[{"setting":"Studio","prompt":""},{"setting":"Lifestyle","prompt":""},{"setting":"Abstract","prompt":""}]}`,
          [{ role:"user", content:msgContent }], 600
        );
        const analyzed = parseJ(res) || { suggestedDescription:title||res, usps:[], colors:[], mockupPrompts:[] };
        const { mockupPrompts, ...productAnalysis } = analyzed;
        const pd = { imageB64, mediaType:imageMtype, imageUrl:url, analyzed:productAnalysis, mockupPrompts:mockupPrompts||[] };
        await updateProject({ productData:pd, proj:{ ...activeProject.proj, product:productAnalysis.suggestedDescription||activeProject.proj?.product } });
        setLoading(false); return;
      } catch(e) {
        setLoadMsg("Seite nicht lesbar — bitte Screenshot hochladen");
        await new Promise(r=>setTimeout(r,3000)); setLoading(false); return;
      }
    }

    try {
      const res = await claude(
        `Produkt-Analyst für AI Video. Antworte NUR als JSON, kein Markdown:
{"productName":"","colors":[],"usps":["USP1","USP2","USP3","USP4","USP5"],"suggestedDescription":"1-2 Sätze","mockupPrompts":[{"setting":"Studio","prompt":""},{"setting":"Lifestyle","prompt":""},{"setting":"Abstract","prompt":""}]}`,
        [{ role:"user", content:[
          { type:"image", source:{ type:"base64", media_type:imageMtype, data:imageB64 }},
          { type:"text", text:"Analysiere dieses Produktbild. Kurz und präzise." }
        ]}], 600
      );
      const analyzed = parseJ(res) || { suggestedDescription:res, usps:[], colors:[], mockupPrompts:[] };
      const { mockupPrompts, ...productAnalysis } = analyzed;
      await updateProject({ productData:{ imageB64, mediaType:imageMtype, imageUrl:url||"", analyzed:productAnalysis, mockupPrompts:mockupPrompts||[] }, proj:{ ...activeProject.proj, product:productAnalysis.suggestedDescription||activeProject.proj?.product } });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const genBrief = async () => {
    setLoading(true); setLoadMsg("Brief wird generiert...");
    try {
      const ctP = { product:"Realistischer Produkt-Werbefilm.", ugc:"UGC-Style: authentisch, handheld.", talkinghead:"Talking Head / Offer Ad.", impossible:"AI Creative: unmögliche Shots." };
      const res = await claudeS(
        `Creative Director für AI Video. Typ: ${ctP[activeProject.contentType]}
Brand: ${JSON.stringify(activeBrand.foundation)}. Produkt: ${JSON.stringify(activeProject.productData?.analyzed)}.
Antworte NUR als JSON, kein Markdown:
{"project":"","product":"","coreMessage":"","emotion":"","visualDirection":"","sceneCount":5,"totalDuration":"15-30s","cta":""}`,
        `Ziel: ${activeProject.proj?.goal} | Plattform: ${activeProject.proj?.platform} | Pacing: ${activeProject.proj?.pacing||"cinematic"} | Produkt: ${activeProject.proj?.product}`,
        700
      );
      await updateProject({ brief: parseJ(res) || { raw:res } });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const startSparring = async () => {
    setLoading(true); setLoadMsg("Konzepte werden generiert...");
    try {
      const sys = `Kreativer Sparrings-Partner für AI Video. Schlage UNMÖGLICHE Konzepte vor die mit AI möglich sind. Produkt: ${activeProject.productData?.analyzed?.suggestedDescription||activeProject.proj?.product}.`;
      const init = "5 konkrete, visuell starke Konzepte. Nummeriert, 2-3 Sätze. Provokant kreativ.";
      const res = await claude(sys, [{ role:"user", content:init }], 1000);
      await updateProject({ sparring:[{ role:"user", content:init },{ role:"assistant", content:res }] });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const sendSparring = async (input) => {
    if (!input.trim()) return;
    setLoading(true); setLoadMsg("Claude denkt...");
    try {
      const msgs = [...(activeProject.sparring||[]), { role:"user", content:input }];
      const res = await claude(`Sparrings-Partner AI Video. Produkt: ${activeProject.productData?.analyzed?.suggestedDescription||activeProject.proj?.product}.`, msgs, 800);
      await updateProject({ sparring:[...msgs, { role:"assistant", content:res }] });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const sparringToScenes = async () => {
    setLoading(true); setLoadMsg("Szenen werden konvertiert...");
    try {
      const conv = (activeProject.sparring||[]).map(m=>`${m.role==="user"?"Nutzer":"Claude"}: ${m.content}`).join("\n\n");
      const res = await claudeS(
        `Extrahiere Szenen. Antworte NUR als JSON-Array, kein Markdown:
[{"id":1,"duration":"~3s","setting":"","action":"","camera":"","lighting":"","mood":"","specialEffect":""}]`,
        `Sparring:\n${conv.slice(0,3000)}\n\nErstelle 5 Szenen.`, 2000
      );
      const scenes = parseJ(res);
      if (!scenes?.length) throw new Error("Szenen konnten nicht erstellt werden");
      await updateProject({ scenes });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const genScenes = async (answers) => {
    setLoading(true); setLoadMsg("Szenen werden entwickelt...");
    const typeP = { product:"Produktfilm, cinematic.", ugc:"UGC: authentisch, handheld.", talkinghead:"Talking Head: Person zur Kamera, B-Roll." };
    const ansCtx = answers && Object.keys(answers).length ? ` Richtung: ${Object.entries(answers).map(([k,v])=>`${k}=${v}`).join(",")}` : "";
    try {
      const res = await claudeS(
        `Szenenautor AI Video. Stil: ${typeP[activeProject.contentType]||typeP.product}
Brief: ${JSON.stringify(activeProject.brief)}. Produkt: ${JSON.stringify(activeProject.productData?.analyzed)}.
Brand: ${activeBrand.foundation?.styleTokens}.${ansCtx}
Antworte NUR als JSON-Array, kein Markdown:
[{"id":1,"duration":"~3s","setting":"","action":"","camera":"","lighting":"","mood":"","productPlacement":""}]`,
        "Erstelle exakt 5 Szenen.", 2500
      );
      const scenes = parseJ(res);
      if (!scenes?.length) throw new Error("JSON konnte nicht geparst werden");
      await updateProject({ scenes, sceneAnswers:answers||null });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const toggleQuickfire = (val) => { setQuickfireEnabled(val); setLocal("qf-enabled", val); };

  const genKeyframes = async () => {
    const tool = IMAGE_TOOLS[activeProject.imageTool];
    setLoading(true); setLoadMsg(`${tool?.name}-Prompts werden erstellt...`);
    try {
      const trimmedScenes = (activeProject.scenes||[]).map(s => ({ id:s.id, setting:s.setting, action:s.action, camera:s.camera, lighting:s.lighting, mood:s.mood }));
      const prod = activeProject.productData?.analyzed;
      const productCtx = prod ? `${prod.productName||""}, ${(prod.colors||[]).join(", ")}, ${prod.suggestedDescription||""}`.trim() : activeProject.proj?.product||"";
      const res = await claudeS(
        `${tool?.name} Image-Prompts für AI Video Keyframes. Tool: ${tool?.tip}
Brand: ${activeBrand.foundation?.styleTokens||"cinematic, premium"}. Produkt: ${productCtx}
PFLICHT: Jeder Prompt MUSS Kamerawinkel + Licht enthalten. Format: "[camera angle], [subject], [lighting], [mood]"
z.B. "low angle close-up, perfume bottle on marble, warm rim light, dark cinematic"
Englisch. Max 35 Wörter. Kein Markdown. Antworte NUR als JSON-Array:
[{"sceneId":1,"startFrame":"[camera angle], [subject], [lighting], [mood/style]"}]`,
        `Szenen: ${JSON.stringify(trimmedScenes)}`, 3000
      );
      const keyframes = parseJ(res);
      if (!keyframes?.length) throw new Error("JSON konnte nicht geparst werden");
      await updateProject({ keyframes });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const genVideoPrompts = async () => {
    const eng = ENGINES[activeProject.engine];
    setLoading(true); setLoadMsg(`${eng?.name}-Prompts werden erstellt...`);
    try {
      const trimmedScenes = (activeProject.scenes||[]).map(s => ({ id:s.id, setting:s.setting, action:s.action, camera:s.camera, lighting:s.lighting, mood:s.mood, specialEffect:s.specialEffect }));
      const res = await claudeS(
        `${eng?.name} Video-Prompt-Spezialist. ${eng?.profile}
Content: ${activeProject.contentType}. Brand: ${activeBrand.foundation?.styleTokens||"cinematic, premium"}.
PFLICHT: Jeder Prompt MUSS in dieser Reihenfolge: 1. Kamerabewegung + Winkel 2. Subjekt + Action 3. Licht + Atmosphäre
Englisch. Kein Markdown. Antworte NUR als JSON-Array:
[{"sceneId":1,"prompt":"[camera move + angle]. [subject + action]. [light + atmosphere].","negativePrompt":"","duration":"3"}]`,
        `Szenen: ${JSON.stringify(trimmedScenes)}`, 3000
      );
      const videoPrompts = parseJ(res);
      if (!videoPrompts?.length) throw new Error("JSON konnte nicht geparst werden");
      await updateProject({ videoPrompts });
    } catch(e) { setLoadMsg(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2000)); }
    setLoading(false);
  };

  const rate = (id, r, issue="") => {
    const ratings = { ...activeProject.ratings, [id]:{ rating:r, issue, ts:new Date().toISOString(), engine:activeProject.engine, imageTool:activeProject.imageTool } };
    const merged = { ...activeProject, ratings };
    setActiveProject(merged);
    supabase.from("projects").update({ data:stripBinary(merged), updated_at:new Date().toISOString() }).eq("id", merged.id);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  if (appLoading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", flexDirection:"column", gap:14 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontSize:22, animation:"spin 1.4s linear infinite", color:"#9b9b99" }}>◎</div>
      <div style={{ fontSize:12, color:"#9b9b99" }}>Wird geladen...</div>
    </div>
  );

  if (view === "brands") return <BrandsScreen brands={brands} onSelect={selectBrand} onCreate={createBrand} onDelete={deleteBrand} />;
  if (view === "dashboard") return <DashboardScreen brand={activeBrand} projects={projects} onBack={()=>setView("brands")} onFoundationSave={updateFoundation} onNewProject={createProject} onOpenProject={openProject} onDeleteProject={deleteProject} />;

  const p = activeProject;
  if (!p) return null;
  const step = p.step || "product";
  const ct = CONTENT_TYPES[p.contentType] || CONTENT_TYPES.product;

  return (
    <div style={{ display:"flex", fontFamily:"var(--font-sans)", minHeight:"100vh", background:"var(--color-background-primary)" }}>
      <div style={{ width:182, flexShrink:0, borderRight:"0.5px solid var(--color-border-tertiary)", display:"flex", flexDirection:"column", position:"sticky", top:0, height:"100vh" }}>
        <div style={{ padding:"11px 12px 10px", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
          <button onClick={()=>setView("dashboard")} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", padding:0, marginBottom:7, color:"var(--color-text-tertiary)", fontSize:11 }}>← <span>{activeBrand.name}</span></button>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:activeBrand.color, flexShrink:0 }} />
            <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-secondary)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.proj?.name||"Neues Projekt"}</div>
          </div>
          {p.contentType !== "product" && <div style={{ marginTop:5, display:"inline-flex", alignItems:"center", gap:4, fontSize:9, padding:"2px 6px", borderRadius:8, background:`${ct.col}18`, color:ct.col }}>{ct.icon} {ct.label}</div>}
        </div>
        <div style={{ flex:1, paddingTop:5, overflowY:"auto" }}>
          {STEPS.map(s => {
            const active = step === s.id;
            const done = (() => {
              if (s.id==="product")   return !!p.productData?.analyzed || !!p.proj?.product;
              if (s.id==="brief")     return !!p.brief;
              if (s.id==="scenes")    return p.scenes?.length>0||(p.contentType==="impossible"&&p.sparring?.length>0);
              if (s.id==="keyframes") return p.keyframes?.length>0;
              if (s.id==="video")     return p.videoPrompts?.length>0;
              return Object.keys(p.ratings||{}).length>0;
            })();
            return (
              <div key={s.id} onClick={()=>goStep(s.id)} style={{ padding:"7px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:7, borderLeft:`2px solid ${active?s.col:"transparent"}`, background:active?"var(--color-background-secondary)":"transparent", transition:"all .15s" }}>
                <span style={{ fontSize:9, color:done?s.col:"var(--color-text-tertiary)", width:12, textAlign:"center" }}>{done?"✓":"·"}</span>
                <span style={{ fontSize:12, fontWeight:active?500:400, color:active?"var(--color-text-primary)":"var(--color-text-secondary)" }}>{s.id==="scenes"&&p.contentType==="impossible"?"Sparring":s.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ padding:"10px 12px", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
          <button onClick={createProject} style={{ fontSize:11, color:"var(--color-text-tertiary)", background:"none", border:"none", cursor:"pointer", padding:0 }}>+ Neues Projekt</button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        <ProgressBar steps={STEPS} currentStep={step} brandColor={activeBrand.color} />
        <div style={{ padding:"14px 22px 18px" }}>
          {loading ? <Spinner msg={loadMsg} /> :
            step==="product"   ? <ProductStep p={p} brand={activeBrand} onAnalyze={analyzeProduct} onUpdate={upd=>setActiveProject(prev=>({...prev,...upd}))} onNext={()=>goStep("brief")} copy={copy} copied={copied} /> :
            step==="brief"     ? <BriefStep p={p} brand={activeBrand} onGen={genBrief} onUpdate={upd=>setActiveProject(prev=>({...prev,...upd}))} onNext={()=>goStep("scenes")} copy={copy} copied={copied} /> :
            step==="scenes"    ? (p.contentType==="impossible"
              ? <SparringStep p={p} onStart={startSparring} onSend={sendSparring} onFinalize={sparringToScenes} />
              : <ScenesStep p={p} brand={activeBrand} onGen={genScenes} onNext={()=>goStep("keyframes")} quickfireEnabled={quickfireEnabled} onToggleQuickfire={toggleQuickfire} />) :
            step==="keyframes" ? <KeyframesStep p={p} onGen={genKeyframes} onUpdate={upd=>updateProject(upd)} onNext={()=>goStep("video")} copy={copy} copied={copied} /> :
            step==="video"     ? <VideoStep p={p} onGen={genVideoPrompts} onUpdate={upd=>updateProject(upd)} onNext={()=>goStep("review")} copy={copy} copied={copied} /> :
            <ReviewStep p={p} onRate={rate} copy={copy} copied={copied} />
          }
        </div>
      </div>
    </div>
  );
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function BrandsScreen({ brands, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(BRAND_COLORS[0]);
  const list = Object.values(brands).sort((a,b) => new Date(b.createdAt||0)-new Date(a.createdAt||0));
  const submit = () => { if(!name.trim()) return; onCreate(name.trim(),color); setCreating(false); setName(""); };
  return (
    <div style={{ fontFamily:"var(--font-sans)", minHeight:"100vh", padding:"28px 32px", background:"var(--color-background-primary)", maxWidth:700, margin:"0 auto" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:"9px", fontFamily:"monospace", letterSpacing:".1em", textTransform:"uppercase", color:"var(--color-text-tertiary)", marginBottom:6 }}>AI Video Production</div>
        <div style={{ fontSize:22, fontWeight:600, letterSpacing:"-.02em", marginBottom:4 }}>Brands & Kunden</div>
        <div style={{ fontSize:13, color:"var(--color-text-secondary)" }}>Wähle einen bestehenden Kunden oder lege einen neuen an.</div>
      </div>
      {creating ? (
        <div style={{ border:"0.5px solid var(--color-border-secondary)", borderRadius:12, padding:"14px 16px", marginBottom:14, background:"var(--color-background-secondary)" }}>
          <div style={{ fontSize:12, fontWeight:500, marginBottom:8 }}>Neuer Brand / Kunde</div>
          <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Kundenname" style={{ width:"100%", fontFamily:"var(--font-sans)", fontSize:13, marginBottom:10 }} />
          <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginBottom:7 }}>Brand-Farbe:</div>
          <div style={{ display:"flex", gap:6, marginBottom:12 }}>
            {BRAND_COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{ width:24, height:24, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2px solid ${c}`:"2px solid transparent", outlineOffset:2 }} />)}
          </div>
          <div style={{ display:"flex", gap:7 }}>
            <button onClick={()=>setCreating(false)} style={{ flex:1, padding:"8px", borderRadius:8, border:"0.5px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-secondary)", fontSize:12, cursor:"pointer" }}>Abbrechen</button>
            <button onClick={submit} style={{ flex:2, padding:"8px", borderRadius:8, border:"none", background:color, color:"#fff", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"var(--font-sans)" }}>Brand anlegen →</button>
          </div>
        </div>
      ) : (
        <button onClick={()=>setCreating(true)} style={{ width:"100%", padding:"11px", borderRadius:10, border:"1.5px dashed var(--color-border-secondary)", background:"transparent", color:"var(--color-text-secondary)", fontSize:13, cursor:"pointer", fontFamily:"var(--font-sans)", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
          <span style={{ fontSize:16 }}>+</span> Neuen Brand anlegen
        </button>
      )}
      {list.length===0&&!creating&&<div style={{ textAlign:"center", padding:"40px 0", color:"var(--color-text-tertiary)", fontSize:13 }}>Noch keine Brands. Leg deinen ersten Kunden an.</div>}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9 }}>
        {list.map(brand=>(
          <div key={brand.id} onClick={()=>onSelect(brand)} style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"13px 14px", cursor:"pointer", background:"var(--color-background-primary)", position:"relative" }}
            onMouseEnter={e=>e.currentTarget.style.borderColor="var(--color-border-secondary)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--color-border-tertiary)"}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:brand.color }} />
              <span style={{ fontSize:14, fontWeight:600 }}>{brand.name}</span>
            </div>
            {brand.foundation?.visualBible ? <div style={{ fontSize:11, color:"var(--color-text-tertiary)", lineHeight:1.5, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{brand.foundation.visualBible}</div>
              : <div style={{ fontSize:11, color:"var(--color-text-tertiary)", fontStyle:"italic" }}>Brand Foundation noch nicht ausgefüllt</div>}
            <button onClick={e=>{e.stopPropagation();if(confirm(`"${brand.name}" löschen?`))onDelete(brand.id)}} style={{ position:"absolute", top:10, right:10, background:"none", border:"none", cursor:"pointer", fontSize:14, color:"var(--color-text-tertiary)", padding:2 }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardScreen({ brand, projects, onBack, onFoundationSave, onNewProject, onOpenProject, onDeleteProject }) {
  const [foundation, setFoundation] = useState(brand.foundation || { visualBible:"", styleTokens:"", assetNotes:"" });
  const [foundationOpen, setFoundationOpen] = useState(!brand.foundation?.visualBible);
  const [saved, setSaved]       = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState("");
  const [pdfB64, setPdfB64]     = useState(null);
  const [pdfName, setPdfName]   = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [shotB64, setShotB64]   = useState(null);
  const [shotType, setShotType] = useState("");
  const [shotName, setShotName] = useState("");
  const [shotDrag, setShotDrag] = useState(false);
  const pdfRef  = useRef();
  const shotRef = useRef();
  const hasSources = pdfB64 || websiteUrl.trim() || shotB64;

  const save = async () => { await onFoundationSave(foundation); setSaved(true); setTimeout(()=>setSaved(false),2000); };

  const analyzeAll = async () => {
    if (!hasSources) return;
    setAnalyzing(true);
    const sys = `Brand-Stratege und AI Video Production Experte. Leite aus Brand-Materialien konkrete Video-Produktionsrichtlinien ab.
• Farben → Licht-Stimmung, Color-Grading
• Typografie → Kamerastil, Pacing
• Bildsprache → Nähe, Authentizitätsgrad
• Tonalität → Schnittrhythmus
Antworte NUR als JSON:
{"visualBible":"3-4 Sätze: Gesamtästhetik, Stimmung, filmische Referenz","styleTokens":"Konkrete Ableitungen: Farbe→Licht. Font→Pacing. Verboten: ...","assetNotes":"Farbcodes, Schutzräume, Logo-Richtlinien"}`;
    const content = [];
    if (pdfB64) { setAnalyzeStep("Brand Guide wird gelesen..."); content.push({ type:"document", source:{ type:"base64", media_type:"application/pdf", data:pdfB64 }}); }
    if (shotB64) content.push({ type:"image", source:{ type:"base64", media_type:shotType, data:shotB64 }});
    let websiteContext = "";
    if (websiteUrl.trim()) {
      setAnalyzeStep("Website wird geladen...");
      try {
        const res = await Promise.race([fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(websiteUrl.trim())}`).then(r=>r.json()), new Promise((_,rej)=>setTimeout(()=>rej(),8000))]);
        if (res?.contents) websiteContext = res.contents.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,3000);
      } catch {}
    }
    const textParts = ["Analysiere alle verfügbaren Brand-Materialien."];
    if (websiteUrl.trim()) textParts.push(websiteContext ? `\n\nWebsite (${websiteUrl}):\n${websiteContext}` : `\n\nWebsite: ${websiteUrl} (nutze Trainingswissen)`);
    content.push({ type:"text", text:textParts.join("") });
    setAnalyzeStep("Analyse läuft...");
    try {
      const r = await fetch("/api/claude", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:sys, messages:[{ role:"user", content }] }) });
      const d = await r.json();
      const resultText = d.content?.find(c=>c.type==="text")?.text ?? "";
      const extracted = parseJ(resultText);
      if (extracted) {
        const merged = { visualBible:extracted.visualBible||foundation.visualBible, styleTokens:extracted.styleTokens||foundation.styleTokens, assetNotes:extracted.assetNotes||foundation.assetNotes };
        setFoundation(merged); await onFoundationSave(merged); setSaved(true); setTimeout(()=>setSaved(false),2000);
      }
    } catch(e) { setAnalyzeStep(`Fehler: ${e.message}`); await new Promise(r=>setTimeout(r,2500)); }
    setAnalyzing(false); setAnalyzeStep("");
  };

  return (
    <div style={{ fontFamily:"var(--font-sans)", minHeight:"100vh", padding:"22px 28px", background:"var(--color-background-primary)", maxWidth:700, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, paddingBottom:14, borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
        <button onClick={onBack} style={{ fontSize:12, color:"var(--color-text-tertiary)", background:"none", border:"none", cursor:"pointer", padding:0 }}>← Alle Brands</button>
        <div style={{ flex:1, display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:12, height:12, borderRadius:"50%", background:brand.color }} />
          <span style={{ fontSize:18, fontWeight:600, letterSpacing:"-.01em" }}>{brand.name}</span>
        </div>
      </div>
      <div style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, marginBottom:18, overflow:"hidden" }}>
        <div onClick={()=>setFoundationOpen(o=>!o)} style={{ padding:"11px 14px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--color-background-secondary)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontFamily:"monospace", fontSize:"8px", padding:"2px 6px", borderRadius:4, background:`${brand.color}22`, color:brand.color, letterSpacing:".07em" }}>BRAND FOUNDATION</span>
            {brand.foundation?.visualBible&&<span style={{ fontSize:10, color:"var(--color-text-tertiary)" }}>✓ Ausgefüllt</span>}
          </div>
          <span style={{ fontSize:10, color:"var(--color-text-tertiary)", display:"block", transform:foundationOpen?"rotate(180deg)":"none", transition:"transform .15s" }}>▼</span>
        </div>
        {foundationOpen && (
          <div style={{ padding:"14px 15px" }}>
            <div style={{ fontSize:"9px", fontFamily:"monospace", letterSpacing:".08em", textTransform:"uppercase", color:"var(--color-text-tertiary)", marginBottom:9 }}>Quellen für automatische Analyse</div>
            <div style={{ marginBottom:8 }}>
              <input ref={pdfRef} type="file" accept="application/pdf" onChange={async e=>{const f=e.target.files[0];if(!f)return;setPdfName(f.name);setPdfB64(await fileToB64(f));}} style={{ display:"none" }} />
              {pdfB64 ? (
                <div style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 10px", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:8 }}>
                  <span>📄</span><span style={{ fontSize:11, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{pdfName}</span>
                  <button onClick={()=>{setPdfB64(null);setPdfName("");}} style={{ fontSize:12, color:"var(--color-text-tertiary)", background:"none", border:"none", cursor:"pointer" }}>×</button>
                </div>
              ) : (
                <button onClick={()=>pdfRef.current?.click()} style={{ width:"100%", padding:"8px 12px", borderRadius:8, border:`1px dashed ${brand.color}55`, background:`${brand.color}05`, color:brand.color, fontSize:11, fontWeight:500, cursor:"pointer", fontFamily:"var(--font-sans)", display:"flex", alignItems:"center", gap:6 }}>
                  ↑ Brand Guide PDF hochladen
                </button>
              )}
            </div>
            <div style={{ marginBottom:8 }}>
              <div style={{ position:"relative" }}>
                <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", fontSize:12, color:"var(--color-text-tertiary)", pointerEvents:"none" }}>🌐</span>
                <input value={websiteUrl} onChange={e=>setWebsiteUrl(e.target.value)} placeholder="https://www.kundenwebsite.com" style={{ width:"100%", paddingLeft:30, fontFamily:"var(--font-sans)", fontSize:12, borderRadius:8 }} />
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <input ref={shotRef} type="file" accept="image/*" onChange={async e=>{const f=e.target.files[0];if(!f)return;setShotName(f.name);setShotType(f.type);setShotB64(await fileToB64(f));}} style={{ display:"none" }} />
              {shotB64 ? (
                <div style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 10px", background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:8 }}>
                  <span>🖼</span><span style={{ fontSize:11, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{shotName}</span>
                  <button onClick={()=>{setShotB64(null);setShotName("");}} style={{ fontSize:12, color:"var(--color-text-tertiary)", background:"none", border:"none", cursor:"pointer" }}>×</button>
                </div>
              ) : (
                <div onDragOver={e=>{e.preventDefault();setShotDrag(true)}} onDragLeave={()=>setShotDrag(false)}
                  onDrop={async e=>{e.preventDefault();setShotDrag(false);const f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/")){setShotName(f.name);setShotType(f.type);setShotB64(await fileToB64(f));}}}
                  onClick={()=>shotRef.current?.click()}
                  style={{ padding:"7px 12px", borderRadius:8, border:`1px dashed ${shotDrag?brand.color:"var(--color-border-secondary)"}`, color:"var(--color-text-tertiary)", fontSize:11, cursor:"pointer", textAlign:"center" }}>
                  Screenshot der Homepage (optional)
                </div>
              )}
            </div>
            {analyzing ? (
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 12px", background:"var(--color-background-secondary)", borderRadius:8, marginBottom:12 }}>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <span style={{ display:"inline-block", animation:"spin 1.2s linear infinite", fontSize:13, color:brand.color }}>◎</span>
                <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{analyzeStep}</span>
              </div>
            ) : hasSources ? (
              <button onClick={analyzeAll} style={{ width:"100%", padding:"9px 14px", borderRadius:8, border:"none", background:brand.color, color:"#fff", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"var(--font-sans)", marginBottom:12 }}>
                ✦ Foundation automatisch befüllen ({[pdfB64&&"PDF",websiteUrl&&"Website",shotB64&&"Screenshot"].filter(Boolean).join(" + ")})
              </button>
            ) : (
              <div style={{ padding:"8px 12px", borderRadius:8, background:"var(--color-background-secondary)", fontSize:11, color:"var(--color-text-tertiary)", marginBottom:12, textAlign:"center" }}>
                Mindestens eine Quelle hinzufügen
              </div>
            )}
            <div style={{ height:"0.5px", background:"var(--color-border-tertiary)", margin:"0 0 12px" }} />
            <Fld label="Visual Bible" hint="Gesamtästhetik, Stimmung, filmische Referenzen" rows={3} value={foundation.visualBible} onChange={v=>setFoundation(f=>({...f,visualBible:v}))} placeholder="z.B. Dunkel, minimalistisch, warme Goldtöne." />
            <Fld label="Style Tokens" hint="Kamerastil, Licht, Pacing, verbotene Elemente" rows={3} value={foundation.styleTokens} onChange={v=>setFoundation(f=>({...f,styleTokens:v}))} placeholder="z.B. Warme Goldtöne → Side-Light. Verboten: Handkamera." />
            <Fld label="Asset-Notizen" hint="Farbcodes, Markenrichtlinien, Produktdarstellung" rows={2} value={foundation.assetNotes} onChange={v=>setFoundation(f=>({...f,assetNotes:v}))} placeholder="z.B. #1a1a1a / #c9a96e. Schutzraum Logo 2x." />
            <button onClick={save} style={{ padding:"8px 16px", borderRadius:8, border:"none", background:saved?"#1D9E75":brand.color, color:"#fff", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"var(--font-sans)", transition:"background .3s" }}>
              {saved?"✓ Gespeichert":"Änderungen speichern"}
            </button>
          </div>
        )}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ fontSize:14, fontWeight:600 }}>Projekte</div>
        <button onClick={onNewProject} style={{ padding:"6px 14px", borderRadius:8, border:"none", background:brand.color, color:"#fff", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"var(--font-sans)" }}>+ Neues Projekt</button>
      </div>
      {projects.length===0 ? (
        <div style={{ border:"1.5px dashed var(--color-border-secondary)", borderRadius:10, padding:"32px", textAlign:"center", color:"var(--color-text-tertiary)", fontSize:13 }}>Noch kein Projekt für {brand.name}.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {projects.sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).map(proj=>{
            const ct2=CONTENT_TYPES[proj.contentType]||CONTENT_TYPES.product;
            return (
              <div key={proj.id} onClick={()=>onOpenProject(proj)} style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"11px 13px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}
                onMouseEnter={e=>e.currentTarget.style.borderColor="var(--color-border-secondary)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--color-border-tertiary)"}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:500 }}>{proj.name||"Ohne Titel"}</span>
                    <span style={{ fontSize:"9px", padding:"1px 6px", borderRadius:8, background:`${ct2.col}18`, color:ct2.col, fontFamily:"monospace" }}>{ct2.label}</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ display:"flex", gap:3 }}>{STEPS.map((s,i)=><div key={s.id} style={{ width:6, height:6, borderRadius:"50%", background:i<(proj.stepsDone||0)?s.col:"var(--color-border-secondary)" }} />)}</div>
                    <span style={{ fontSize:10, color:"var(--color-text-tertiary)" }}>{proj.stepsDone||0}/{STEPS.length}</span>
                    {proj.updatedAt&&<span style={{ fontSize:10, color:"var(--color-text-tertiary)" }}>· {fmtDate(proj.updatedAt)}</span>}
                  </div>
                </div>
                <button onClick={e=>{e.stopPropagation();if(confirm(`"${proj.name||"Projekt"}" löschen?`))onDeleteProject(proj.id)}} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15, color:"var(--color-text-tertiary)", padding:"2px 4px" }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Workflow Steps ───────────────────────────────────────────────────────────
function ProductStep({ p, brand, onAnalyze, onUpdate, onNext, copy, copied }) {
  const [tab, setTab] = useState("upload");
  const [url, setUrl] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();
  const handleFile = async (f) => { if(!f||!f.type.startsWith("image/")) return; await onAnalyze(await fileToB64(f),f.type,null); };
  return (
    <div>
      <Hdr title="Produkt-Setup" sub="Bild hochladen oder URL einfügen — Claude analysiert automatisch" badge="SCHRITT 1" col={brand.color} />
      <div style={{ display:"flex", gap:5, marginBottom:12 }}>
        {[["upload","↑ Hochladen"],["url","URL"],["manual","Manuell"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ fontSize:12, padding:"5px 11px", borderRadius:7, cursor:"pointer", fontFamily:"var(--font-sans)", border:`0.5px solid ${tab===t?brand.color:"var(--color-border-tertiary)"}`, background:tab===t?`${brand.color}18`:"transparent", color:tab===t?brand.color:"var(--color-text-secondary)", fontWeight:tab===t?500:400 }}>{l}</button>
        ))}
      </div>
      {tab==="upload"&&(
        <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>fileRef.current?.click()}
          style={{ border:`1.5px dashed ${drag?brand.color:"var(--color-border-secondary)"}`, borderRadius:12, padding:"28px 20px", textAlign:"center", cursor:"pointer", background:drag?`${brand.color}08`:"var(--color-background-secondary)", marginBottom:10 }}>
          <div style={{ fontSize:24, marginBottom:7, color:"var(--color-text-tertiary)" }}>⬆</div>
          <div style={{ fontSize:13, fontWeight:500, marginBottom:3 }}>Produktbild hierher ziehen</div>
          <div style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>Screenshot, Produktfoto — JPG, PNG, WebP</div>
          <input ref={fileRef} type="file" accept="image/*" onChange={e=>handleFile(e.target.files[0])} style={{ display:"none" }} />
        </div>
      )}
      {tab==="url"&&(
        <div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:7, lineHeight:1.6 }}>PDP-URL oder direkte Bild-URL einfügen — Claude extrahiert automatisch das Produktbild und alle relevanten Daten.</div>
          <div style={{ display:"flex", gap:6 }}>
            <input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onAnalyze(null,null,url.trim())} placeholder="https://shop.example.com/produkt" style={{ flex:1, fontFamily:"var(--font-sans)", fontSize:12 }} />
            <button onClick={()=>onAnalyze(null,null,url.trim())} style={{ padding:"0 13px", borderRadius:8, border:"none", background:brand.color, color:"#fff", fontSize:12, cursor:"pointer", fontFamily:"var(--font-sans)", whiteSpace:"nowrap" }}>Analysieren</button>
          </div>
        </div>
      )}
      {tab==="manual"&&(
        <div>
          <Fld label="Produkt-Beschreibung" hint="Aussehen, Farben, Material, USP" rows={4} value={p.proj?.product||""} onChange={v=>onUpdate({proj:{...p.proj,product:v}})} placeholder="z.B. Matte schwarze Parfumflasche, 50ml, Gold-Applikator." />
          <Btn col={brand.color} onClick={onNext}>Weiter ohne Analyse →</Btn>
        </div>
      )}
      {p.productData?.analyzed&&(
        <div style={{ marginTop:12, border:`0.5px solid ${brand.color}55`, borderRadius:10, overflow:"hidden" }}>
          <div style={{ padding:"7px 11px", background:`${brand.color}0a`, borderBottom:`0.5px solid ${brand.color}33`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:11, fontWeight:500, color:brand.color }}>✓ {p.productData.analyzed.productName}</span>
            {p.productData.analyzed.colors?.length>0&&<span style={{ fontSize:10, color:"var(--color-text-tertiary)" }}>{p.productData.analyzed.colors.join(" · ")}</span>}
          </div>
          <div style={{ padding:"9px 11px" }}>
            {p.productData.analyzed.usps?.length>0&&(
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:"9px", fontFamily:"monospace", letterSpacing:".06em", color:"var(--color-text-tertiary)", marginBottom:5 }}>TOP USPs</div>
                {p.productData.analyzed.usps.map((usp,i)=>(
                  <div key={i} style={{ display:"flex", gap:6, fontSize:11, marginBottom:3 }}><span style={{ color:brand.color, fontWeight:600 }}>{i+1}</span><span>{usp}</span></div>
                ))}
              </div>
            )}
            {p.productData.analyzed.suggestedDescription&&<div style={{ fontSize:11, color:"var(--color-text-secondary)", lineHeight:1.55, padding:"6px 8px", background:"var(--color-background-secondary)", borderRadius:6, marginBottom:8 }}>{p.productData.analyzed.suggestedDescription}</div>}
            {p.productData.mockupPrompts?.length>0&&(
              <div>
                <div style={{ fontSize:"9px", fontFamily:"monospace", letterSpacing:".06em", color:"var(--color-text-tertiary)", marginBottom:5 }}>MOCKUP-PROMPTS</div>
                {p.productData.mockupPrompts.map((mp,i)=>(
                  <div key={i} style={{ background:"var(--color-background-secondary)", borderRadius:7, padding:"5px 8px", marginBottom:4, display:"flex", gap:7 }}>
                    <span style={{ fontSize:"9px", fontFamily:"monospace", color:brand.color, flexShrink:0 }}>{mp.setting}</span>
                    <span style={{ fontSize:10, color:"var(--color-text-tertiary)", lineHeight:1.5 }}>{mp.prompt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding:"7px 11px", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
            <Btn col={brand.color} onClick={onNext} style={{ marginBottom:0 }}>Weiter zu Brief & Typ →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function BriefStep({ p, brand, onGen, onUpdate, onNext }) {
  return (
    <div>
      <Hdr title="Brief & Content-Typ" sub="Definiert den gesamten Charakter des Videos" badge="TAG 1" col={brand.color} />
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:"9px", fontFamily:"monospace", letterSpacing:".07em", color:"var(--color-text-tertiary)", marginBottom:6 }}>CONTENT-TYP</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          {Object.entries(CONTENT_TYPES).map(([k,v])=>(
            <div key={k} onClick={()=>onUpdate({contentType:k})} style={{ border:`1px solid ${p.contentType===k?v.col:"var(--color-border-tertiary)"}`, borderRadius:9, padding:"8px 10px", cursor:"pointer", background:p.contentType===k?`${v.col}0f`:"transparent" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                <span style={{ color:p.contentType===k?v.col:"var(--color-text-tertiary)", fontSize:12 }}>{v.icon}</span>
                <span style={{ fontSize:12, fontWeight:p.contentType===k?600:400, color:p.contentType===k?v.col:"var(--color-text-primary)" }}>{v.label}</span>
              </div>
              <div style={{ fontSize:10, color:"var(--color-text-tertiary)", lineHeight:1.35 }}>{v.desc}</div>
            </div>
          ))}
        </div>
      </div>
      {!p.brief ? (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:4 }}>
            <Fld label="Projektname" value={p.proj?.name||""} onChange={v=>onUpdate({proj:{...p.proj,name:v}})} placeholder="Herbst-Kampagne 2025" />
            <Fld label="Plattform" value={p.proj?.platform||""} onChange={v=>onUpdate({proj:{...p.proj,platform:v}})} placeholder="Instagram, TikTok..." />
          </div>
          {!p.productData?.analyzed&&<Fld label="Produkt" rows={2} value={p.proj?.product||""} onChange={v=>onUpdate({proj:{...p.proj,product:v}})} placeholder="Produkt beschreiben..." />}
          <Fld label="Kampagnenziel" rows={2} value={p.proj?.goal||""} onChange={v=>onUpdate({proj:{...p.proj,goal:v}})} placeholder="z.B. Produkteinführung, Awareness, Abverkauf..." />
          <Fld label="Pacing / Tonalität" value={p.proj?.pacing||""} onChange={v=>onUpdate({proj:{...p.proj,pacing:v}})} placeholder={p.contentType==="ugc"?"authentisch, roh":p.contentType==="impossible"?"surreal, spektakulär":"cinematic, ruhig"} />
          <Btn col={CONTENT_TYPES[p.contentType]?.col||brand.color} onClick={onGen}>Brief generieren →</Btn>
        </div>
      ) : (
        <div>
          <BriefTbl brief={p.brief} />
          <div style={{ display:"flex", gap:8, marginTop:9 }}>
            <BtnOut onClick={onGen}>Neu generieren</BtnOut>
            <Btn col={CONTENT_TYPES[p.contentType]?.col||brand.color} onClick={onNext} style={{ flex:2, marginBottom:0 }}>
              {p.contentType==="impossible"?"Weiter zu Sparring →":"Weiter zu Szenen →"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function SparringStep({ p, onStart, onSend, onFinalize }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef();
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[p.sparring]);
  return (
    <div>
      <Hdr title="Creative Sparring" sub="Entwickle Konzepte die real unmöglich zu filmen wären" badge="AI CREATIVE" col="#D85A30" />
      {!p.sparring?.length ? (
        <div>
          <div style={{ background:"rgba(216,90,48,.06)", border:"0.5px solid rgba(216,90,48,.2)", borderRadius:10, padding:"11px 13px", marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:500, color:"#D85A30", marginBottom:4 }}>✦ Kein Formular — echter Dialog</div>
            <div style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.65 }}>Claude schlägt 5 mutige Konzepte vor. Du reagierst, kombinierst, verwirfst. Am Ende: Szenen.</div>
          </div>
          <Btn col="#D85A30" onClick={onStart}>Sparring starten →</Btn>
        </div>
      ) : (
        <div>
          <div style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, overflow:"hidden", marginBottom:8 }}>
            <div style={{ maxHeight:300, overflowY:"auto", padding:"11px 12px", display:"flex", flexDirection:"column", gap:8 }}>
              {p.sparring.map((m,i)=>(
                <div key={i} style={{ display:"flex", gap:7, justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                  {m.role==="assistant"&&<div style={{ width:18, height:18, borderRadius:"50%", background:"rgba(216,90,48,.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, color:"#D85A30", flexShrink:0, marginTop:2 }}>✦</div>}
                  <div style={{ maxWidth:"82%", fontSize:12, lineHeight:1.65, padding:"7px 10px", borderRadius:8, whiteSpace:"pre-wrap", background:m.role==="user"?"var(--color-background-secondary)":"rgba(216,90,48,.06)", border:m.role==="assistant"?"0.5px solid rgba(216,90,48,.2)":"0.5px solid var(--color-border-tertiary)" }}>{m.content}</div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div style={{ borderTop:"0.5px solid var(--color-border-tertiary)", padding:"8px 10px", display:"flex", gap:6 }}>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),onSend(input),setInput(""))} placeholder="Reagieren, verfeinern... (Enter)" style={{ flex:1, fontFamily:"var(--font-sans)", fontSize:12, border:"0.5px solid var(--color-border-tertiary)", borderRadius:6, padding:"5px 8px", background:"var(--color-background-secondary)" }} />
              <button onClick={()=>{onSend(input);setInput("");}} style={{ padding:"5px 11px", borderRadius:7, border:"none", background:"#D85A30", color:"#fff", fontSize:12, cursor:"pointer" }}>→</button>
            </div>
          </div>
          <Btn col="#D85A30" onClick={onFinalize}>Konzept zu Szenen konvertieren →</Btn>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ steps, currentStep, brandColor }) {
  const idx = steps.findIndex(s=>s.id===currentStep);
  const pct = Math.round(((idx+1)/steps.length)*100);
  const col = steps[idx]?.col || brandColor || "#7F77DD";
  return (
    <div style={{ padding:"10px 22px 0", borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
        <span style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)" }}>{steps[idx]?.label||currentStep}</span>
        <span style={{ fontSize:10, fontFamily:"monospace", color:"var(--color-text-tertiary)" }}>{idx+1} / {steps.length}</span>
      </div>
      <div style={{ height:2, background:"var(--color-border-tertiary)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:2, transition:"width .5s cubic-bezier(.4,0,.2,1)" }} />
      </div>
    </div>
  );
}

function QuickfireStep({ contentType, onSubmit, onSkip }) {
  const questions = QUICKFIRE[contentType] || QUICKFIRE.product;
  const [answers, setAnswers] = useState({});
  const allDone = questions.every(q=>answers[q.id]);
  return (
    <div>
      <Hdr title="Richtungs-Fragen" sub="4 Klicks — bessere, zielgerichtetere Szenen" badge="QUICK" col="#7F77DD" />
      <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:14, lineHeight:1.6 }}>Einfach auswählen was passt — fließt direkt in die Szenenentwicklung ein.</div>
      {questions.map((q,qi)=>(
        <div key={q.id} style={{ marginBottom:13 }}>
          <div style={{ fontSize:12, fontWeight:500, marginBottom:6, display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontFamily:"monospace", fontSize:"9px", background:"var(--color-background-secondary)", padding:"1px 5px", borderRadius:4, color:"var(--color-text-tertiary)" }}>{qi+1}</span>
            {q.q}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {q.opts.map(opt=>(
              <button key={opt.v} onClick={()=>setAnswers(a=>({...a,[q.id]:opt.v}))} style={{ fontSize:12, padding:"6px 13px", borderRadius:8, cursor:"pointer", fontFamily:"var(--font-sans)", border:`0.5px solid ${answers[q.id]===opt.v?"#7F77DD":"var(--color-border-tertiary)"}`, background:answers[q.id]===opt.v?"rgba(127,119,221,.12)":"transparent", color:answers[q.id]===opt.v?"#7F77DD":"var(--color-text-secondary)", fontWeight:answers[q.id]===opt.v?500:400 }}>{opt.l}</button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display:"flex", gap:8, marginTop:16 }}>
        <BtnOut onClick={onSkip}>Überspringen</BtnOut>
        <button onClick={()=>allDone&&onSubmit(answers)} style={{ flex:2, padding:"9px 14px", borderRadius:8, border:"none", background:"#7F77DD", color:"#fff", fontSize:13, fontWeight:500, cursor:allDone?"pointer":"default", fontFamily:"var(--font-sans)", opacity:allDone?1:0.45 }}>
          {allDone?"Szenen generieren →":`Noch ${questions.filter(q=>!answers[q.id]).length} Frage${questions.filter(q=>!answers[q.id]).length!==1?"n":""} offen`}
        </button>
      </div>
    </div>
  );
}

function ScenesStep({ p, brand, onGen, onNext, quickfireEnabled, onToggleQuickfire }) {
  const ct = CONTENT_TYPES[p.contentType]||CONTENT_TYPES.product;
  const showQuickfire = quickfireEnabled && !p.scenes?.length && !p.sceneAnswers;
  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14, paddingBottom:11, borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
        <div>
          <span style={{ fontFamily:"monospace", fontSize:"8px", padding:"2px 6px", borderRadius:4, background:`${ct.col}22`, color:ct.col, letterSpacing:".07em", display:"inline-block", marginBottom:5 }}>TAG 1</span>
          <div style={{ fontSize:18, fontWeight:600, letterSpacing:"-.01em", marginBottom:2 }}>Szenen-Entwicklung</div>
          <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>Semantische, toolunabhängige Beschreibungen</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:7, flexShrink:0, marginTop:4 }}>
          <span style={{ fontSize:10, color:"var(--color-text-tertiary)", whiteSpace:"nowrap" }}>Richtungs-Fragen</span>
          <div onClick={()=>onToggleQuickfire(!quickfireEnabled)} style={{ width:32, height:18, borderRadius:9, background:quickfireEnabled?"#7F77DD":"var(--color-border-secondary)", cursor:"pointer", position:"relative", transition:"background .2s" }}>
            <div style={{ position:"absolute", top:2, left:quickfireEnabled?16:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,.2)" }} />
          </div>
        </div>
      </div>
      {p.brief&&<div style={{ background:"var(--color-background-secondary)", borderRadius:7, padding:"5px 9px", marginBottom:9, fontSize:11 }}><strong>{p.brief.project||"Projekt"}</strong>{p.brief.sceneCount?` · ${p.brief.sceneCount} Szenen`:""}</div>}
      {showQuickfire ? <QuickfireStep contentType={p.contentType} onSubmit={onGen} onSkip={()=>onGen(null)} /> :
        !p.scenes?.length ? <Btn col={ct.col} onClick={()=>onGen(p.sceneAnswers||null)}>Szenen generieren →</Btn> : (
          <>
            {p.sceneAnswers&&<div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:9 }}>{Object.values(p.sceneAnswers).map((v,i)=><span key={i} style={{ fontSize:"9px", padding:"2px 7px", borderRadius:8, background:"rgba(127,119,221,.1)", color:"#7F77DD", fontFamily:"monospace" }}>{v}</span>)}</div>}
            {p.scenes.map((s,i)=>(
              <div key={i} style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:"9px 11px", marginBottom:5 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <div style={{ display:"flex", gap:4 }}><Tg text={`SZENE ${s.id}`} /><Tg text={s.duration} muted /></div>
                  <span style={{ fontSize:10, color:"var(--color-text-tertiary)", fontStyle:"italic" }}>{s.mood}</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"3px 10px" }}>
                  {[["Setting",s.setting],["Action",s.action],["Kamera",s.camera],["Licht",s.lighting],["Produkt",s.productPlacement],s.specialEffect&&["AI-Effekt",s.specialEffect]].filter(Boolean).filter(([,v])=>v).map(([k,v])=>(
                    <div key={k} style={{ fontSize:11 }}><span style={{ fontWeight:500, color:"var(--color-text-secondary)" }}>{k}: </span><span>{v}</span></div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:4 }}>
              <BtnOut onClick={()=>onGen(null)}>Neu generieren</BtnOut>
              <Btn col={ct.col} onClick={onNext} style={{ flex:2, marginBottom:0 }}>Weiter zu Keyframes →</Btn>
            </div>
          </>
        )}
    </div>
  );
}

function KeyframesStep({ p, onGen, onUpdate, onNext, copy, copied }) {
  return (
    <div>
      <Hdr title="Keyframe-Prompts" sub="Tool-Schicht — bei Tool-Wechsel nur Engine-Profil aktualisieren" badge="TOOL-SCHICHT" col="#BA7517" />
      <TP value={p.imageTool||"midjourney"} onChange={v=>onUpdate({imageTool:v})} options={IMAGE_TOOLS} label="Image Tool" col="#BA7517" />
      {!p.keyframes?.length ? <Btn col="#BA7517" onClick={onGen}>Keyframe-Prompts generieren →</Btn> : (
        <>
          {p.keyframes.map((kf,i)=>(
            <div key={i} style={{ border:"0.5px solid rgba(186,117,23,.3)", background:"rgba(250,238,218,.04)", borderRadius:10, padding:"9px 11px", marginBottom:5 }}>
              <div style={{ display:"flex", gap:4, marginBottom:5 }}><Tg text={`SZENE ${kf.sceneId}`} col="#BA7517" /><Tg text={IMAGE_TOOLS[p.imageTool||"midjourney"]?.name} col="#BA7517" muted /></div>
              <PB label="Keyframe Prompt" text={kf.startFrame} id={`ks${i}`} copy={copy} copied={copied} />
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:4 }}>
            <BtnOut onClick={onGen}>Neu generieren</BtnOut>
            <Btn col="#BA7517" onClick={onNext} style={{ flex:2, marginBottom:0 }}>Weiter zu Video-Prompts →</Btn>
          </div>
        </>
      )}
    </div>
  );
}

function VideoStep({ p, onGen, onUpdate, onNext, copy, copied }) {
  return (
    <div>
      <Hdr title="Video-Prompts" sub="Tool-Schicht — LLM übersetzt in engine-spezifische Syntax" badge="TOOL-SCHICHT" col="#BA7517" />
      <TP value={p.engine||"kling"} onChange={v=>onUpdate({engine:v})} options={ENGINES} label="Video Engine" col="#BA7517" />
      {!p.videoPrompts?.length ? <Btn col="#BA7517" onClick={onGen}>Video-Prompts generieren →</Btn> : (
        <>
          {p.videoPrompts.map((vp,i)=>(
            <div key={i} style={{ border:"0.5px solid rgba(186,117,23,.3)", background:"rgba(250,238,218,.04)", borderRadius:10, padding:"9px 11px", marginBottom:5 }}>
              <div style={{ display:"flex", gap:4, marginBottom:5 }}><Tg text={`SZENE ${vp.sceneId}`} col="#BA7517" /><Tg text={ENGINES[p.engine||"kling"]?.name} col="#BA7517" muted />{vp.duration&&<Tg text={`~${vp.duration}s`} muted />}</div>
              <PB label="Video Prompt"   text={vp.prompt}         id={`vp${i}`} copy={copy} copied={copied} />
              <PB label="Negativ-Prompt" text={vp.negativePrompt} id={`vn${i}`} copy={copy} copied={copied} muted />
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:4 }}>
            <BtnOut onClick={onGen}>Neu generieren</BtnOut>
            <Btn col="#1D9E75" onClick={onNext} style={{ flex:2, marginBottom:0 }}>Weiter zu Review →</Btn>
          </div>
        </>
      )}
    </div>
  );
}

function ReviewStep({ p, onRate, copy, copied }) {
  const vals = Object.values(p.ratings||{});
  const good=vals.filter(r=>r.rating==="✅").length, warn=vals.filter(r=>r.rating==="⚠️").length, bad=vals.filter(r=>r.rating==="❌").length;
  const issues=[...new Set(vals.filter(r=>r.issue).map(r=>r.issue))];
  return (
    <div>
      <Hdr title="Review & Log" sub="Bewerte jeden Clip — Log wird automatisch erstellt" badge="TAG 2" col="#1D9E75" />
      {!p.scenes?.length&&<div style={{ fontSize:13, color:"var(--color-text-tertiary)", padding:"40px 0", textAlign:"center" }}>Noch keine Szenen — starte bei Schritt 1.</div>}
      {(p.scenes||[]).map(s=>{
        const r=p.ratings?.[s.id]||{}, vp=(p.videoPrompts||[]).find(v=>v.sceneId===s.id);
        return (
          <div key={s.id} style={{ border:`0.5px solid ${r.rating?"rgba(29,158,117,.35)":"var(--color-border-tertiary)"}`, borderRadius:10, padding:"9px 11px", marginBottom:5 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
              <div><Tg text={`SZENE ${s.id}`} /><div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:3 }}>{s.action}</div></div>
              <div style={{ display:"flex", gap:4 }}>
                {["✅","⚠️","❌"].map(rt=><button key={rt} onClick={()=>onRate(s.id,rt)} style={{ padding:"4px 8px", borderRadius:6, border:`0.5px solid ${r.rating===rt?"#1D9E75":"var(--color-border-tertiary)"}`, background:r.rating===rt?"rgba(29,158,117,.12)":"transparent", cursor:"pointer", fontSize:13, opacity:r.rating&&r.rating!==rt?0.3:1 }}>{rt}</button>)}
              </div>
            </div>
            {(r.rating==="⚠️"||r.rating==="❌")&&(
              <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:5 }}>
                {ISSUE_TAGS.map(tag=><button key={tag} onClick={()=>onRate(s.id,r.rating,tag)} style={{ fontSize:10, padding:"2px 7px", borderRadius:10, cursor:"pointer", border:`0.5px solid ${r.issue===tag?"#BA7517":"var(--color-border-tertiary)"}`, background:r.issue===tag?"rgba(186,117,23,.12)":"transparent", color:r.issue===tag?"#BA7517":"var(--color-text-tertiary)" }}>{tag}</button>)}
              </div>
            )}
            {vp&&<PB label="Prompt" text={vp.prompt} id={`rv-${s.id}`} copy={copy} copied={copied} />}
            {r.ts&&<div style={{ fontSize:"9px", fontFamily:"monospace", color:"var(--color-text-tertiary)", marginTop:3 }}>{fmtDate(r.ts)}{r.issue?` · ${r.issue}`:""} · {ENGINES[p.engine||"kling"]?.name}</div>}
          </div>
        );
      })}
      {vals.length>0&&(
        <div style={{ border:"0.5px solid rgba(29,158,117,.3)", background:"rgba(29,158,117,.05)", borderRadius:10, padding:"9px 11px", marginTop:5 }}>
          <div style={{ fontFamily:"monospace", fontSize:"8px", letterSpacing:".07em", color:"#1D9E75", marginBottom:4 }}>LOG-ZUSAMMENFASSUNG</div>
          <div style={{ display:"flex", gap:12, marginBottom:issues.length?4:0 }}>
            {good>0&&<span style={{ fontSize:11 }}>✅ {good}</span>}{warn>0&&<span style={{ fontSize:11 }}>⚠️ {warn}</span>}{bad>0&&<span style={{ fontSize:11 }}>❌ {bad}</span>}
          </div>
          {issues.length>0&&<div style={{ fontSize:11 }}>Probleme: <strong>{issues.join(", ")}</strong></div>}
        </div>
      )}
    </div>
  );
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────
function Hdr({ title, sub, badge, col }) {
  return (
    <div style={{ marginBottom:14, paddingBottom:11, borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
      <span style={{ fontFamily:"monospace", fontSize:"8px", padding:"2px 6px", borderRadius:4, background:`${col}22`, color:col, letterSpacing:".07em", display:"inline-block", marginBottom:5 }}>{badge}</span>
      <div style={{ fontSize:18, fontWeight:600, letterSpacing:"-.01em", marginBottom:2 }}>{title}</div>
      <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{sub}</div>
    </div>
  );
}
function Fld({ label, hint, value, onChange, placeholder, rows }) {
  const T = rows ? "textarea" : "input";
  return (
    <div style={{ marginBottom:9 }}>
      <div style={{ fontSize:12, fontWeight:500, marginBottom:2 }}>{label}</div>
      {hint&&<div style={{ fontSize:10, color:"var(--color-text-tertiary)", marginBottom:3 }}>{hint}</div>}
      <T value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||""} rows={rows} style={{ width:"100%", resize:rows?"vertical":undefined, fontFamily:"var(--font-sans)", fontSize:12 }} />
    </div>
  );
}
function TP({ value, onChange, options, label, col }) {
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:11, alignItems:"center" }}>
      <span style={{ fontSize:11, color:"var(--color-text-tertiary)", marginRight:2 }}>{label}:</span>
      {Object.entries(options).map(([k,v])=>(
        <button key={k} onClick={()=>onChange(k)} style={{ fontSize:11, padding:"3px 9px", borderRadius:6, cursor:"pointer", fontFamily:"var(--font-sans)", border:`0.5px solid ${value===k?col:"var(--color-border-tertiary)"}`, background:value===k?`${col}18`:"transparent", color:value===k?col:"var(--color-text-secondary)", fontWeight:value===k?500:400 }}>{v.name}</button>
      ))}
    </div>
  );
}
function PB({ label, text, id, copy, copied, muted }) {
  if (!text) return null;
  return (
    <div style={{ marginBottom:4 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:2 }}>
        <span style={{ fontSize:"9px", fontFamily:"monospace", letterSpacing:".05em", color:"var(--color-text-tertiary)" }}>{label}</span>
        <button onClick={()=>copy(text,id)} style={{ fontSize:10, padding:"1px 7px", borderRadius:4, border:"0.5px solid var(--color-border-tertiary)", background:"transparent", cursor:"pointer", color:copied===id?"#1D9E75":"var(--color-text-tertiary)" }}>{copied===id?"✓":"Kopieren"}</button>
      </div>
      <div style={{ fontFamily:"monospace", fontSize:11, background:"var(--color-background-secondary)", borderRadius:6, padding:"6px 8px", lineHeight:1.6, color:muted?"var(--color-text-tertiary)":"var(--color-text-secondary)", whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{text}</div>
    </div>
  );
}
function BriefTbl({ brief }) {
  if (brief?.raw) return <div style={{ fontFamily:"monospace", fontSize:11, background:"var(--color-background-secondary)", padding:11, borderRadius:8, whiteSpace:"pre-wrap", lineHeight:1.6 }}>{brief.raw}</div>;
  return (
    <div style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, overflow:"hidden" }}>
      {Object.entries(brief||{}).map(([k,v],i,arr)=>(
        <div key={k} style={{ display:"grid", gridTemplateColumns:"120px 1fr", borderBottom:i<arr.length-1?"0.5px solid var(--color-border-tertiary)":"none" }}>
          <div style={{ padding:"5px 9px", fontSize:"9px", fontWeight:500, color:"var(--color-text-tertiary)", background:"var(--color-background-secondary)", borderRight:"0.5px solid var(--color-border-tertiary)", fontFamily:"monospace" }}>{k}</div>
          <div style={{ padding:"5px 9px", fontSize:11 }}>{String(v)}</div>
        </div>
      ))}
    </div>
  );
}
function Tg({ text, col, muted }) {
  return <span style={{ fontFamily:"monospace", fontSize:"8px", letterSpacing:".04em", padding:"2px 5px", borderRadius:4, background:col?`${col}18`:"var(--color-background-secondary)", color:col&&!muted?col:"var(--color-text-tertiary)" }}>{text}</span>;
}
function Spinner({ msg }) {
  return <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:280, gap:14 }}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div style={{ fontSize:22, animation:"spin 1.4s linear infinite", color:"var(--color-text-tertiary)" }}>◎</div>
    <div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{msg}</div>
  </div>;
}
function Btn({ col, onClick, children, style={} }) {
  return <button onClick={onClick} style={{ display:"block", width:"100%", padding:"9px 14px", borderRadius:8, border:"none", background:col, color:"#fff", fontSize:13, fontWeight:500, cursor:"pointer", marginBottom:7, fontFamily:"var(--font-sans)", ...style }}>{children}</button>;
}
function BtnOut({ onClick, children }) {
  return <button onClick={onClick} style={{ flex:1, padding:"9px", borderRadius:8, border:"0.5px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-secondary)", fontSize:13, cursor:"pointer", fontFamily:"var(--font-sans)" }}>{children}</button>;
}
