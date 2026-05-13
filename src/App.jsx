import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./lib/supabase";

// ─── API ──────────────────────────────────────────────────────────────────────
const callClaude = async (system, messages, maxTokens = 1500) => {
  const r = await fetch("/api/claude", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:maxTokens, system, messages }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.content?.[0]?.text ?? "";
};
const claudeS = (sys, user, mt) => callClaude(sys, [{role:"user",content:user}], mt);
const muSubmit = (endpoint, body) => fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"submit",endpoint,body})}).then(r=>r.json());
const muPoll = (requestId) => fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"poll",requestId})}).then(r=>r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const muPollUntilDone = async (requestId, onStatus) => {
  for (let i=0; i<120; i++) {
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
const parseJ = t => { if(!t) return null; try{return JSON.parse(t.replace(/```json|```/g,"").trim());}catch{} const m=t.match(/\[[\s\S]*\]/)||t.match(/\{[\s\S]*\}/); if(m){try{return JSON.parse(m[0]);}catch{}} return null; };
const fileToB64 = f => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
const uid = () => Math.random().toString(36).slice(2,10);
const fmt = iso => { try{return new Date(iso).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"});}catch{return "";} };
const stripBin = p => ({...p, productData: p.productData ? {...p.productData, imageB64:null} : p.productData});
const cntSteps = p => [p.productData?.analyzed||p.proj?.product, p.scenes?.length>0, p.keyframes?.length>0, p.videoPrompts?.length>0].filter(Boolean).length;

// ─── Constants ────────────────────────────────────────────────────────────────
const BRAND_COLORS = ["#6B57FF","#00C896","#FF6B35","#FF4444","#0094FF","#C5EE32","#FF5FAD","#8B5CF6"];

const CT = {
  product:     { label:"Product Ad",   icon:"◈", col:"#6B57FF", bg:"rgba(107,87,255,.1)" },
  ugc:         { label:"UGC Style",    icon:"◉", col:"#00C896", bg:"rgba(0,200,150,.1)" },
  talkinghead: { label:"Talking Head", icon:"◎", col:"#FF6B35", bg:"rgba(255,107,53,.1)" },
  impossible:  { label:"AI Creative",  icon:"✦", col:"#FF5FAD", bg:"rgba(255,95,173,.1)" },
};

const IMG_MODELS = {
  "flux-dev-image":       { name:"Flux Dev",    desc:"Schnell" },
  "flux-2-pro":           { name:"Flux Pro",    desc:"Qualität" },
  "flux-kontext-max-t2i": { name:"Flux Kontext",desc:"Beste" },
};
const VID_MODELS = {
  "kling-v2.6-pro-i2v":    { name:"Kling 3.0",     desc:"Realistisch", i2v:true },
  "seedance-v2.0-i2v":     { name:"Seedance 2.0",  desc:"Cinematisch", i2v:true },
  "veo3.1-image-to-video": { name:"Veo 3.1",        desc:"Premium",     i2v:true },
  "wan2.5-image-to-video": { name:"Wan 2.5",        desc:"Günstig",     i2v:true },
  "kling-v2.6-pro-t2v":    { name:"Kling (Text)",   desc:"Kein Bild",   i2v:false },
  "seedance-v2.0-t2v":     { name:"Seedance (Text)",desc:"Text",        i2v:false },
};

const QUICKFIRE = {
  product: [
    {id:"proximity",q:"Nähe zum Produkt?",opts:[{v:"extreme",l:"Extreme Close-ups"},{v:"medium",l:"Mittelnahaufnahmen"},{v:"mixed",l:"Gemischt"}]},
    {id:"setting",  q:"Setting?",          opts:[{v:"studio",l:"Studio"},{v:"context",l:"Im Kontext"},{v:"abstract",l:"Abstrakt"}]},
    {id:"camera",   q:"Kamerabewegung?",   opts:[{v:"still",l:"Statisch"},{v:"smooth",l:"Fließend"},{v:"organic",l:"Organisch"}]},
    {id:"mood",     q:"Atmosphäre?",        opts:[{v:"dark",l:"Dunkel/Premium"},{v:"bright",l:"Hell/Clean"},{v:"warm",l:"Warm"}]},
  ],
  ugc: [
    {id:"subject", q:"Person?",            opts:[{v:"using",l:"Benutzt Produkt"},{v:"talking",l:"Zur Kamera"},{v:"mixed",l:"Gemischt"}]},
    {id:"setting", q:"Setting?",           opts:[{v:"home",l:"Zuhause"},{v:"outdoor",l:"Outdoor"},{v:"onthego",l:"Unterwegs"}]},
    {id:"rawness", q:"Authentizität?",     opts:[{v:"raw",l:"Sehr roh"},{v:"mid",l:"Authentisch"},{v:"polished",l:"Poliert"}]},
    {id:"product", q:"Produktpräsenz?",    opts:[{v:"hero",l:"Dominant"},{v:"natural",l:"Natürlich"},{v:"subtle",l:"Subtil"}]},
  ],
  talkinghead: [
    {id:"bg",     q:"Hintergrund?",       opts:[{v:"minimal",l:"Minimal"},{v:"branded",l:"Branded"},{v:"lifestyle",l:"Lifestyle"}]},
    {id:"pacing", q:"Schnittrhythmus?",   opts:[{v:"slow",l:"Ruhig"},{v:"medium",l:"Standard"},{v:"fast",l:"Schnell"}]},
    {id:"energy", q:"Energie?",           opts:[{v:"calm",l:"Ruhig"},{v:"energetic",l:"Energetisch"},{v:"friendly",l:"Freundlich"}]},
    {id:"broll",  q:"B-Roll?",            opts:[{v:"product",l:"Produkt"},{v:"lifestyle",l:"Lifestyle"},{v:"graphic",l:"Grafik"}]},
  ],
  impossible: [
    {id:"scale",   q:"Skala?",    opts:[{v:"micro",l:"Mikrokosmos"},{v:"normal",l:"Normal"},{v:"epic",l:"Episch"}]},
    {id:"physics", q:"Physik?",   opts:[{v:"real",l:"Hyperrealistisch"},{v:"slightly",l:"Leicht surreal"},{v:"full",l:"Surreal"}]},
    {id:"time",    q:"Zeit?",     opts:[{v:"slow",l:"Zeitlupe"},{v:"normal",l:"Normal"},{v:"lapse",l:"Zeitraffer"}]},
    {id:"mood",    q:"Stimmung?", opts:[{v:"mystic",l:"Mystisch"},{v:"fresh",l:"Frisch"},{v:"magic",l:"Magisch"}]},
  ],
};

const EMPTY_PROJ = (id, brandId) => ({ id, brandId, contentType:"product", sceneCount:5, imageTool:"flux-dev-image", videoTool:"kling-v2.6-pro-i2v", proj:{name:"",product:"",goal:"",platform:"Instagram"}, productData:{imageB64:null,mediaType:null,imageUrl:"",analyzed:null,mockupPrompts:[]}, scenes:[], keyframes:[], videoPrompts:[], generations:{}, ratings:{}, updatedAt:new Date().toISOString() });

// ─── App ──────────────────────────────────────────────────────────────────────
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
      const {data:brandsData} = await supabase.from("brands").select("*").order("created_at");
      const map = {}; (brandsData||[]).forEach(b => map[b.id]=b); setBrands(map);
      const last = JSON.parse(localStorage.getItem("fw-last")||"null");
      if (last?.brandId && map[last.brandId]) {
        const brand = map[last.brandId]; setActiveBrand(brand);
        const {data:projs} = await supabase.from("projects").select("id,name,content_type,updated_at,steps_done").eq("brand_id",last.brandId).order("updated_at",{ascending:false});
        setProjects(projs||[]);
        if (last.projId) {
          const {data:p} = await supabase.from("projects").select("data").eq("id",last.projId).single();
          if (p?.data) { setProj(p.data); setView("project"); setReady(true); return; }
        }
        setView("dashboard");
      }
      setReady(true);
    })();
  }, []);

  const saveBrand = async brand => { await supabase.from("brands").upsert({id:brand.id,name:brand.name,color:brand.color,foundation:brand.foundation,created_at:brand.createdAt||new Date().toISOString()}); };
  const saveProj = useCallback(async p => {
    const updated = {...p, updatedAt:new Date().toISOString()}; setProj(updated);
    const toSave = stripBin(updated);
    await supabase.from("projects").upsert({id:toSave.id,brand_id:toSave.brandId,name:toSave.proj?.name||"Ohne Titel",content_type:toSave.contentType,steps_done:cntSteps(toSave),data:toSave,updated_at:toSave.updatedAt});
    const meta = {id:updated.id,name:updated.proj?.name||"Ohne Titel",content_type:updated.contentType,steps_done:cntSteps(updated),updated_at:updated.updatedAt};
    setProjects(prev => { const l=[...prev]; const i=l.findIndex(x=>x.id===updated.id); if(i>=0)l[i]=meta; else l.unshift(meta); return l; });
  }, []);
  const setP = useCallback(upd => setProj(prev => prev ? {...prev,...upd} : prev), []);

  const createBrand = async (name, color) => { const brand={id:uid(),name,color,foundation:{visualBible:"",styleTokens:"",assetNotes:""},createdAt:new Date().toISOString()}; setBrands(prev=>({...prev,[brand.id]:brand})); await saveBrand(brand); openBrand(brand,[]); };
  const updateFoundation = async foundation => { const updated={...activeBrand,foundation}; setBrands(prev=>({...prev,[updated.id]:updated})); setActiveBrand(updated); await supabase.from("brands").update({foundation}).eq("id",updated.id); };
  const deleteBrand = async id => { setBrands(prev=>{const n={...prev};delete n[id];return n;}); await supabase.from("brands").delete().eq("id",id); };
  const openBrand = (brand, projs) => { setActiveBrand(brand); setProjects(projs); setProj(null); localStorage.setItem("fw-last",JSON.stringify({brandId:brand.id})); setView("dashboard"); };
  const selectBrand = async brand => { const {data}=await supabase.from("projects").select("id,name,content_type,updated_at,steps_done").eq("brand_id",brand.id).order("updated_at",{ascending:false}); openBrand(brand,data||[]); };
  const createProject = async () => { const p=EMPTY_PROJ(uid(),activeBrand.id); await saveProj(p); localStorage.setItem("fw-last",JSON.stringify({brandId:activeBrand.id,projId:p.id})); setView("project"); };
  const openProject = async meta => { const {data}=await supabase.from("projects").select("data").eq("id",meta.id).single(); const p=data?.data||EMPTY_PROJ(meta.id,activeBrand.id); setProj(p); localStorage.setItem("fw-last",JSON.stringify({brandId:activeBrand.id,projId:meta.id})); setView("project"); };
  const deleteProject = async id => { setProjects(prev=>prev.filter(p=>p.id!==id)); await supabase.from("projects").delete().eq("id",id); };

  if (!ready) return <Spin msg="Wird geladen…" />;

  const sidebarItems = [
    { id:"brands", label:"Brands", icon:"◈", onClick:()=>setView("brands") },
    ...(activeBrand ? [{ id:"dashboard", label:activeBrand.name, icon:"◉", onClick:()=>setView("dashboard"), color:activeBrand.color }] : []),
    ...(proj ? [{ id:"project", label:proj.proj?.name||"Projekt", icon:"◎", onClick:()=>setView("project") }] : []),
  ];

  return (
    <div style={{display:"flex", height:"100vh", overflow:"hidden", background:"var(--bg)"}}>
      {/* Sidebar */}
      <div style={{width:200, flexShrink:0, background:"var(--sidebar)", display:"flex", flexDirection:"column", padding:"0"}}>
        <div style={{padding:"20px 16px 14px", borderBottom:"1px solid rgba(255,255,255,.06)"}}>
          <div style={{fontSize:14, fontWeight:700, color:"#fff", fontFamily:"Syne, sans-serif", letterSpacing:".04em"}}>AI VIDEO</div>
          <div style={{fontSize:9, color:"rgba(255,255,255,.3)", letterSpacing:".12em", textTransform:"uppercase", marginTop:2}}>Production Framework</div>
        </div>
        <div style={{flex:1, padding:"10px 8px", overflowY:"auto"}}>
          {sidebarItems.map(item => (
            <button key={item.id} onClick={item.onClick} style={{width:"100%", display:"flex", alignItems:"center", gap:8, padding:"7px 8px", borderRadius:7, border:"none", background:view===item.id?"var(--sidebar-active)":"transparent", color:view===item.id?"#fff":"rgba(255,255,255,.5)", cursor:"pointer", fontSize:12, fontFamily:"inherit", textAlign:"left", marginBottom:1, transition:"background .15s,color .15s"}}>
              <span style={{fontSize:9, opacity:.6}}>{item.icon}</span>
              <span style={{flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{item.label}</span>
              {item.color && <span style={{width:6, height:6, borderRadius:"50%", background:item.color, flexShrink:0}} />}
            </button>
          ))}
        </div>
        <div style={{padding:"10px 8px", borderTop:"1px solid rgba(255,255,255,.06)"}}>
          <div style={{fontSize:10, color:"rgba(255,255,255,.2)", padding:"4px 8px"}}>v2.0</div>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1, overflow:"auto"}}>
        {view==="brands"    && <BrandsView brands={brands} onSelect={selectBrand} onCreate={createBrand} onDelete={deleteBrand} />}
        {view==="dashboard" && <DashView brand={activeBrand} projects={projects} onBack={()=>setView("brands")} onFoundation={updateFoundation} onNew={createProject} onOpen={openProject} onDelete={deleteProject} />}
        {view==="project" && proj && <ProjView proj={proj} brand={activeBrand} qfEnabled={qfEnabled} onQfToggle={v=>setQfEnabled(v)} onBack={()=>setView("dashboard")} onSave={saveProj} setP={setP} onNew={createProject} />}
      </div>
    </div>
  );
}

// ─── Brands ───────────────────────────────────────────────────────────────────
function BrandsView({ brands, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(BRAND_COLORS[0]);
  const list = Object.values(brands).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  const submit = () => { if(!name.trim()) return; onCreate(name.trim(),color); setCreating(false); setName(""); };
  return (
    <div style={{padding:"32px 36px", maxWidth:700}}>
      <PageHeader title="Brands & Kunden" sub="Wähle einen Brand um Projekte zu verwalten" />
      {creating ? (
        <Card style={{marginBottom:16, background:"var(--surface)"}}>
          <div style={{fontSize:12, fontWeight:600, marginBottom:10, color:"var(--text)"}}>Neuer Brand</div>
          <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Kundenname" style={{marginBottom:10}} />
          <div style={{display:"flex", gap:5, marginBottom:12}}>
            {BRAND_COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",outline:color===c?`2.5px solid ${c}`:"2.5px solid transparent",outlineOffset:2,transition:"outline .1s"}} />)}
          </div>
          <div style={{display:"flex", gap:7}}>
            <BtnGhost onClick={()=>setCreating(false)}>Abbrechen</BtnGhost>
            <BtnPrimary onClick={submit} col={color} style={{flex:2}}>Anlegen →</BtnPrimary>
          </div>
        </Card>
      ) : (
        <button onClick={()=>setCreating(true)} style={{width:"100%",padding:"10px 14px",borderRadius:"var(--radius)",border:"1.5px dashed var(--border-2)",background:"transparent",color:"var(--text-2)",fontSize:13,cursor:"pointer",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"background .15s"}} onMouseEnter={e=>e.currentTarget.style.background="var(--surface)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <span style={{fontSize:16,lineHeight:1}}>+</span> Neuen Brand anlegen
        </button>
      )}
      {list.length===0 && !creating && <Empty text="Noch keine Brands — leg jetzt den ersten an." />}
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
        {list.map(brand=>(
          <Card key={brand.id} onClick={()=>onSelect(brand)} hover style={{cursor:"pointer", position:"relative"}}>
            <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:7}}>
              <div style={{width:32,height:32,borderRadius:8,background:`${brand.color}20`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:brand.color}} />
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600}}>{brand.name}</div>
                <div style={{fontSize:10,color:"var(--text-3)"}}>Brand</div>
              </div>
            </div>
            <div style={{fontSize:11,color:"var(--text-2)",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
              {brand.foundation?.visualBible || <em style={{color:"var(--text-3)"}}>Brand Foundation noch leer</em>}
            </div>
            <button onClick={e=>{e.stopPropagation();if(confirm(`"${brand.name}" löschen?`))onDelete(brand.id);}} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:14,color:"var(--text-3)",lineHeight:1,padding:"2px 4px",borderRadius:4}} onMouseEnter={e=>e.currentTarget.style.color="var(--red)"} onMouseLeave={e=>e.currentTarget.style.color="var(--text-3)"}>×</button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashView({ brand, projects, onBack, onFoundation, onNew, onOpen, onDelete }) {
  const [foundation, setFoundation] = useState(brand.foundation||{});
  const [open, setOpen] = useState(!brand.foundation?.visualBible);
  const [saved, setSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analMsg, setAnalMsg] = useState("");
  const [pdfB64, setPdfB64] = useState(null); const [pdfName, setPdfName] = useState(""); const [pdfMtype, setPdfMtype] = useState("application/pdf");
  const [webUrl, setWebUrl] = useState("");
  const [shotB64, setShotB64] = useState(null); const [shotType, setShotType] = useState("");
  const pdfRef=useRef(); const shotRef=useRef();
  const hasSrc = pdfB64||webUrl.trim()||shotB64;

  const save = async () => { await onFoundation(foundation); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  const analyze = async () => {
    if (!pdfB64 && !shotB64 && !webUrl.trim()) {
      setAnalMsg("Bitte zuerst eine Quelle hinzufügen (PDF, URL oder Screenshot)");
      return;
    }
    setAnalyzing(true); setAnalMsg("Analyse startet…");
    const sys = 'You are a brand strategist for AI video production. Carefully analyze all provided brand materials. Extract SPECIFIC information: exact hex color codes, exact font names, specific do's and don'ts, logo rules. CRITICAL: Respond ONLY with a single flat JSON object, no markdown, no explanation, just JSON. All 3 values must be plain text strings. Example format: {"visualBible":"Warm earthy aesthetic inspired by nature. Soft diffused lighting, slow panning shots, close-up texture details. Cinematic references: Terrence Malick natural light style.","styleTokens":"Camera: slow smooth movements, macro/close-up product shots. Lighting: soft natural daylight, avoid harsh shadows. Pacing: calm 3-5s shots. Forbidden: fast cuts, neon colors, dark moody lighting.","assetNotes":"Primary: #2E5D3A (forest green), #F5E6D3 (cream), #8B4513 (brown). Fonts: Playfair Display (headlines), Lato (body). Logo: minimum 40px, always on light backgrounds. No gradients."}';
    try {
      // Load website content
      let extra = "";
      if (webUrl.trim()) {
        setAnalMsg("Website wird geladen…");
        try {
          const r = await Promise.race([
            fetch("https://api.allorigins.win/get?url=" + encodeURIComponent(webUrl)).then(r=>r.json()),
            new Promise((_,rj)=>setTimeout(()=>rj(new Error("timeout")),8000))
          ]);
          if (r?.contents) extra = r.contents
            .replace(/<script[\s\S]*?<\/script>/gi,"")
            .replace(/<style[\s\S]*?<\/style>/gi,"")
            .replace(/<[^>]+>/g," ")
            .replace(/\s+/g," ").trim().slice(0,2000);
        } catch(e) { extra = ""; }
      }
      setAnalMsg("KI analysiert…");

      // Build content array - always use array format for consistency
      const textParts = ["Analyze all provided brand materials and respond with the JSON object."];
      if (webUrl.trim()) textParts.push("Website URL: " + webUrl + (extra ? "\nWebsite content: " + extra : " (could not load content)"));
      const contentArr = [];
      if (pdfB64) {
        // Claude API only supports PDFs as documents, not docx
        const isPdf = pdfMtype === "application/pdf" || pdfName.toLowerCase().endsWith(".pdf");
        if (isPdf) {
          contentArr.push({type:"document", source:{type:"base64", media_type:"application/pdf", data:pdfB64}});
        } else {
          textParts.push("Note: A brand guide document was uploaded (" + pdfName + ") but could not be read directly. Please use the website URL for analysis.");
        }
      }
      if (shotB64) contentArr.push({type:"image", source:{type:"base64", media_type:shotType, data:shotB64}});
      contentArr.push({type:"text", text:textParts.join("\n\n")});

      const messages = [{role:"user", content: contentArr}];
      const res = await callClaude(sys, messages, 1500);
      console.log("Claude raw response:", res.slice(0, 300));

      const ex = parseJ(res);
      if (ex) {
        // Flatten any nested objects to strings
        const flatten = v => {
          if (!v) return "";
          if (typeof v === "string") return v;
          if (typeof v === "object") return Object.entries(v).map(([k,val]) => k + ": " + (typeof val === "object" ? JSON.stringify(val) : val)).join(". ");
          return String(v);
        };
        const m = {
          visualBible: flatten(ex.visualBible) || foundation.visualBible || "",
          styleTokens: flatten(ex.styleTokens) || foundation.styleTokens || "",
          assetNotes:  flatten(ex.assetNotes)  || foundation.assetNotes  || ""
        };
        if (m.visualBible || m.styleTokens || m.assetNotes) {
          setFoundation(m);
          await onFoundation(m);
          setSaved(true);
          setTimeout(()=>setSaved(false), 2500);
          setAnalMsg("");
        } else {
          setAnalMsg("Leere Antwort erhalten — bitte nochmal versuchen");
        }
      } else {
        setAnalMsg("Antwort konnte nicht verarbeitet werden");
        console.error("Could not parse:", res);
      }
    } catch(e) {
      console.error("Analyze error:", e);
      setAnalMsg("Fehler: " + e.message);
    }
    setAnalyzing(false);
  };

  return (
    <div style={{padding:"32px 36px", maxWidth:700}}>
      <PageHeader title={brand.name} sub="Projekte & Brand Foundation" col={brand.color} />

      {/* Foundation */}
      <Card style={{marginBottom:14}}>
        <div onClick={()=>setOpen(o=>!o)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:open?12:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-2)"}}>Brand Foundation</span>
            {brand.foundation?.visualBible&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:99,background:"rgba(0,200,150,.12)",color:"var(--teal)",fontWeight:600}}>✓</span>}
          </div>
          <span style={{fontSize:9,color:"var(--text-3)",transform:open?"rotate(180deg)":"none",transition:"transform .15s"}}>▼</span>
        </div>
        {open && (
          <div>
            <FieldLabel>Quellen für automatische Analyse</FieldLabel>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              <input ref={pdfRef} type="file" accept="application/pdf,.doc,.docx" onChange={async e=>{const f=e.target.files[0];if(f){setPdfName(f.name);setPdfMtype(f.type||'application/pdf');setPdfB64(await fileToB64(f));}}} style={{display:"none"}} />
              {pdfB64
                ? <FileTag name={pdfName} onRemove={()=>{setPdfB64(null);setPdfName("");}} />
                : <button onClick={()=>pdfRef.current?.click()}
                    onDragOver={e=>{e.preventDefault();e.currentTarget.style.background=`${brand.color}18`;e.currentTarget.style.borderColor=brand.color;}}
                    onDragLeave={e=>{e.currentTarget.style.background=`${brand.color}08`;e.currentTarget.style.borderColor=`${brand.color}66`;}}
                    onDrop={async e=>{e.preventDefault();e.currentTarget.style.background=`${brand.color}08`;e.currentTarget.style.borderColor=`${brand.color}66`;const f=e.dataTransfer.files[0];if(f){setPdfName(f.name);setPdfB64(await fileToB64(f));}}}
                    style={{flex:1,padding:"7px 10px",borderRadius:8,border:`1.5px dashed ${brand.color}66`,background:`${brand.color}08`,color:brand.color,fontSize:11,fontWeight:500,cursor:"pointer",transition:"background .15s,border-color .15s"}}>↑ Brand Guide PDF / DOC</button>}
              <input value={webUrl} onChange={e=>setWebUrl(e.target.value)} placeholder="🌐 Website-URL" style={{flex:2}} />
            </div>
            <div style={{marginBottom:10}}>
              <input ref={shotRef} type="file" accept="image/*" onChange={async e=>{const f=e.target.files[0];if(f){setShotType(f.type);setShotB64(await fileToB64(f));}}} style={{display:"none"}} />
              {shotB64
                ? <FileTag name="Screenshot" onRemove={()=>setShotB64(null)} />
                : <div onClick={()=>shotRef.current?.click()} style={{padding:"6px 10px",borderRadius:7,border:"1px dashed var(--border)",color:"var(--text-3)",fontSize:11,cursor:"pointer",textAlign:"center"}}>Screenshot hinzufügen (optional)</div>}
            </div>
            {analyzing
              ? <StatusBar msg={analMsg} col={brand.color} />
              : hasSrc ? <BtnPrimary onClick={analyze} col={brand.color} style={{marginBottom:10}}>✦ Automatisch befüllen</BtnPrimary>
              : analMsg ? <div style={{fontSize:11,color:"var(--orange)",marginBottom:10}}>{analMsg}</div> : <BtnPrimary onClick={analyze} col={brand.color} style={{marginBottom:10,opacity:0.45}}>✦ Automatisch befüllen</BtnPrimary>}
            <Divider />
            <Fld label="Visual Bible" rows={3} value={foundation.visualBible||""} onChange={v=>setFoundation(f=>({...f,visualBible:v}))} placeholder="Gesamtästhetik, Stimmung, Referenzen…" />
            <Fld label="Style Tokens" rows={2} value={foundation.styleTokens||""} onChange={v=>setFoundation(f=>({...f,styleTokens:v}))} placeholder="Kamerastil, Licht, Pacing…" />
            <Fld label="Asset-Notizen" rows={2} value={foundation.assetNotes||""} onChange={v=>setFoundation(f=>({...f,assetNotes:v}))} placeholder="Farbcodes, Markenrichtlinien…" />
            <BtnPrimary onClick={save} col={saved?"var(--teal)":brand.color}>{saved?"✓ Gespeichert":"Speichern"}</BtnPrimary>
          </div>
        )}
      </Card>

      {/* Projects */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:600}}>Projekte</span>
        <BtnPrimary onClick={onNew} col={brand.color} style={{padding:"6px 14px",fontSize:12,width:"auto"}}>+ Neu</BtnPrimary>
      </div>
      {projects.length===0
        ? <Empty text="Noch keine Projekte — erstelle dein erstes." />
        : <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {[...projects].sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0)).map(p=>{
            const ct=CT[p.content_type]||CT.product;
            return (
              <Card key={p.id} onClick={()=>onOpen(p)} hover style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:34,height:34,borderRadius:8,background:ct.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{ct.icon}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                    <span style={{fontSize:13,fontWeight:500}}>{p.name||"Ohne Titel"}</span>
                    <Tag col={ct.col}>{ct.label}</Tag>
                  </div>
                  <Progress val={p.steps_done||0} max={4} col={brand.color} />
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {p.updated_at&&<span style={{fontSize:11,color:"var(--text-3)"}}>{fmt(p.updated_at)}</span>}
                  <button onClick={e=>{e.stopPropagation();if(confirm("Projekt löschen?"))onDelete(p.id);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:"var(--text-3)",padding:"2px 4px"}} onMouseEnter={e=>e.currentTarget.style.color="var(--red)"} onMouseLeave={e=>e.currentTarget.style.color="var(--text-3)"}>×</button>
                </div>
              </Card>
            );
          })}
        </div>}
    </div>
  );
}

// ─── Project View ─────────────────────────────────────────────────────────────
function ProjView({ proj, brand, qfEnabled, onQfToggle, onBack, onSave, setP, onNew }) {
  const [loading, setLoading]   = useState(false);
  const [loadMsg, setLoadMsg]   = useState("");
  const [copied, setCopied]     = useState("");
  const [showQF, setShowQF]     = useState(false);
  const [qfAns, setQfAns]       = useState({});
  const [sparIn, setSparIn]     = useState("");
  const [sparSend, setSparSend] = useState(false);
  const [genJobs, setGenJobs]   = useState({});
  const [pdTab, setPdTab]       = useState("upload");
  const [pdUrl, setPdUrl]       = useState("");
  const fileRef = useRef(); const sparRef = useRef();

  useEffect(()=>{ sparRef.current?.scrollIntoView({behavior:"smooth"}); },[proj.sparring]);

  const ct = CT[proj.contentType]||CT.product;
  const copy = (text,id) => { navigator.clipboard.writeText(text).catch(()=>{}); setCopied(id); setTimeout(()=>setCopied(""),2000); };
  const err = async msg => { setLoadMsg(msg); await sleep(2500); };

  const analyzeProduct = async (b64, mtype, url) => {
    setLoading(true); setLoadMsg("Produkt analysieren…");
    let imageB64=b64, imageMtype=mtype;
    if (!b64&&url) {
      setLoadMsg("Seite laden…");
      try {
        const html=await Promise.race([fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`).then(r=>r.json()).then(d=>d?.contents||""),new Promise((_,r)=>setTimeout(()=>r(""),12000))]);
        if(html){
          const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||html.match(/<title[^>]*>([^<]+)/i)?.[1]||"";
          const desc=html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1]||"";
          const body=html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,2000);
          const imgSrc=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
          if(imgSrc){try{const abs=imgSrc.startsWith("http")?imgSrc:new URL(imgSrc,url).href;const blob=await Promise.race([fetch(`https://images.weserv.nl/?url=${encodeURIComponent(abs)}&output=jpg&w=800`).then(r=>r.ok?r.blob():null),new Promise((_,r)=>setTimeout(()=>r(null),6000))]);if(blob?.size>1000){imageMtype="image/jpeg";imageB64=await fileToB64(blob);}}catch{}}
          const mc=[]; if(imageB64)mc.push({type:"image",source:{type:"base64",media_type:imageMtype,data:imageB64}}); mc.push({type:"text",text:`URL:${url}\nTitel:${title}\nBeschreibung:${desc}\nInhalt:${body}`});
          const res=await callClaude(`Product analyst for AI video. Respond ONLY as JSON: {"productName":"","colors":[],"usps":["","","","",""],"suggestedDescription":"","mockupPrompts":[{"setting":"Studio","prompt":""},{"setting":"Lifestyle","prompt":""},{"setting":"Abstract","prompt":""}]}`,mc,600);
          const a=parseJ(res)||{suggestedDescription:title,usps:[],colors:[],mockupPrompts:[]};
          const{mockupPrompts,...analyzed}=a;
          await onSave({...proj,productData:{imageB64,mediaType:imageMtype,imageUrl:url,analyzed,mockupPrompts:mockupPrompts||[]},proj:{...proj.proj,product:analyzed.suggestedDescription||proj.proj?.product}});
          setLoading(false); return;
        }
      } catch { await err("Seite nicht lesbar — Bild hochladen"); setLoading(false); return; }
    }
    try {
      const res=await callClaude(`Product analyst for AI video. Respond ONLY as JSON: {"productName":"","colors":[],"usps":["","","","",""],"suggestedDescription":"","mockupPrompts":[{"setting":"Studio","prompt":""},{"setting":"Lifestyle","prompt":""},{"setting":"Abstract","prompt":""}]}`,[{role:"user",content:[{type:"image",source:{type:"base64",media_type:imageMtype,data:imageB64}},{type:"text",text:"Analyze this product image."}]}],600);
      const a=parseJ(res)||{suggestedDescription:res,usps:[],colors:[],mockupPrompts:[]};
      const{mockupPrompts,...analyzed}=a;
      await onSave({...proj,productData:{imageB64,mediaType:imageMtype,imageUrl:"",analyzed,mockupPrompts:mockupPrompts||[]},proj:{...proj.proj,product:analyzed.suggestedDescription||proj.proj?.product}});
    } catch(e){await err(`Fehler: ${e.message}`);}
    setLoading(false);
  };

  const genAll = async answers => {
    setShowQF(false); setLoading(true);
    const ansCtx=answers&&Object.keys(answers).length?` Direction: ${Object.entries(answers).map(([k,v])=>`${k}=${v}`).join(",")}`:""
    const prod=proj.productData?.analyzed;
    const pCtx=prod?`${prod.productName||""}, ${(prod.colors||[]).join(", ")}, ${prod.suggestedDescription||""}`.trim():proj.proj?.product||"";
    try {
      setLoadMsg("Brief erstellen…");
      const brief=parseJ(await claudeS(`Creative director for AI video. Type: ${proj.contentType}. Brand: ${JSON.stringify(brand.foundation)}. Product: ${JSON.stringify(prod)}. Respond ONLY as JSON: {"coreMessage":"","emotion":"","visualDirection":"","cta":""}`,`Goal: ${proj.proj?.goal||"Awareness"} | Platform: ${proj.proj?.platform||"Instagram"} | Product: ${proj.proj?.product}`,600))||{};
      setLoadMsg("Szenen entwickeln…");
      const scenes=parseJ(await claudeS(`Scene writer for AI video. Content: ${proj.contentType}. Brief: ${JSON.stringify(brief)}. Product: ${JSON.stringify(prod)}. Brand: ${brand.foundation?.styleTokens}.${ansCtx}. Respond ONLY as JSON array: [{"id":1,"duration":"~3s","setting":"","action":"","camera":"","lighting":"","mood":"","productPlacement":""}]`,`Create exactly ${proj.sceneCount||5} scenes.`,2500));
      if(!scenes?.length) throw new Error("Szenen konnten nicht erstellt werden");
      setLoadMsg("Keyframe-Prompts…");
      const tool=IMG_MODELS[proj.imageTool||"flux-dev-image"];
      const sc=scenes.map(s=>({id:s.id,setting:s.setting,action:s.action,camera:s.camera,lighting:s.lighting,mood:s.mood}));
      const keyframes=parseJ(await claudeS(`${tool?.name||"Flux"} image prompt specialist. Brand: ${brand.foundation?.styleTokens||"cinematic"}. Product: ${pCtx}. MANDATORY: camera angle + lighting. Format: "[camera], [subject], [lighting], [mood]". English. Max 35 words. Respond ONLY as JSON array: [{"sceneId":1,"startFrame":"..."}]`,`Scenes: ${JSON.stringify(sc)}`,3000));
      if(!keyframes?.length) throw new Error("Keyframe-Prompts fehlgeschlagen");
      setLoadMsg("Video-Prompts…");
      const vidModel=VID_MODELS[proj.videoTool||"kling-v2.6-pro-i2v"];
      const videoPrompts=parseJ(await claudeS(`${vidModel?.name||"Kling"} video prompt specialist. Content: ${proj.contentType}. Brand: ${brand.foundation?.styleTokens||"cinematic"}. MANDATORY: camera+action+light in one sentence. English. Respond ONLY as JSON array: [{"sceneId":1,"prompt":"...","negativePrompt":"","duration":"4"}]`,`Scenes: ${JSON.stringify(sc)}`,3000));
      if(!videoPrompts?.length) throw new Error("Video-Prompts fehlgeschlagen");
      await onSave({...proj,brief,scenes,keyframes,videoPrompts,sceneAnswers:answers||null});
    } catch(e){await err(`Fehler: ${e.message}`);}
    setLoading(false);
  };

  const regenOne = async (sceneId, type) => {
    const scene=proj.scenes?.find(s=>s.id===sceneId); if(!scene) return;
    setLoading(true); setLoadMsg(`Szene ${sceneId} neu generieren…`);
    try {
      if(type==="keyframe"){const tool=IMG_MODELS[proj.imageTool||"flux-dev-image"];const res=parseJ(await claudeS(`${tool?.name} keyframe. MANDATORY: camera+light. "[angle],[subject],[light],[mood]". English. Max 35 words. JSON: {"sceneId":${sceneId},"startFrame":"..."}`,`Scene: ${JSON.stringify(scene)}`,300));if(res){const updated=(proj.keyframes||[]).map(k=>k.sceneId===sceneId?{...k,...res}:k);if(!updated.find(k=>k.sceneId===sceneId))updated.push(res);await onSave({...proj,keyframes:updated});}}
      else{const vm=VID_MODELS[proj.videoTool||"kling-v2.6-pro-i2v"];const res=parseJ(await claudeS(`${vm?.name} video prompt. MANDATORY: camera+action+light. English. JSON: {"sceneId":${sceneId},"prompt":"...","negativePrompt":"","duration":"4"}`,`Scene: ${JSON.stringify(scene)}`,300));if(res){const updated=(proj.videoPrompts||[]).map(v=>v.sceneId===sceneId?{...v,...res}:v);if(!updated.find(v=>v.sceneId===sceneId))updated.push(res);await onSave({...proj,videoPrompts:updated});}}
    } catch(e){await err(`Fehler: ${e.message}`);}
    setLoading(false);
  };

  const startSpar = async () => {
    setLoading(true); setLoadMsg("Konzepte generieren…");
    try {
      const init="Propose 5 concrete impossible concepts. Numbered, 2-3 sentences each. Provocatively creative.";
      const res=await callClaude(`Creative sparring partner for AI video. Impossible concepts achievable with AI. Product: ${proj.productData?.analyzed?.suggestedDescription||proj.proj?.product}.`,[{role:"user",content:init}],1000);
      await onSave({...proj,sparring:[{role:"user",content:init},{role:"assistant",content:res}]});
    } catch(e){await err(`Fehler: ${e.message}`);}
    setLoading(false);
  };
  const sendSpar = async input => {
    if(!input.trim()||sparSend) return;
    setSparIn(""); setSparSend(true);
    try {
      const msgs=[...(proj.sparring||[]),{role:"user",content:input}];
      const res=await callClaude(`Creative sparring. Impossible AI video. Product: ${proj.productData?.analyzed?.suggestedDescription||proj.proj?.product}.`,msgs,800);
      await onSave({...proj,sparring:[...msgs,{role:"assistant",content:res}]});
    } catch(e){await onSave({...proj,sparring:[...(proj.sparring||[]),{role:"user",content:input},{role:"assistant",content:`Fehler: ${e.message}`}]});}
    setSparSend(false);
  };
  const sparToScenes = async () => {
    setLoading(true); setLoadMsg("Szenen aus Sparring…");
    try {
      const conv=(proj.sparring||[]).map(m=>`${m.role==="user"?"User":"AI"}: ${m.content}`).join("\n\n");
      const scenes=parseJ(await claudeS(`Extract scenes from sparring. JSON array: [{"id":1,"duration":"~3s","setting":"","action":"","camera":"","lighting":"","mood":""}]`,`Sparring:\n${conv.slice(0,3000)}\n\nCreate ${proj.sceneCount||5} scenes.`,2000));
      if(!scenes?.length) throw new Error("Szenen konnten nicht erstellt werden");
      const sc=scenes.map(s=>({id:s.id,setting:s.setting,action:s.action,mood:s.mood}));
      const kf=parseJ(await claudeS(`Keyframe prompts. MANDATORY: camera+light. JSON array: [{"sceneId":1,"startFrame":"..."}]`,`Scenes: ${JSON.stringify(sc)}`,2500));
      const vp=parseJ(await claudeS(`Video prompts. MANDATORY: camera+action+light. JSON array: [{"sceneId":1,"prompt":"...","negativePrompt":"","duration":"4"}]`,`Scenes: ${JSON.stringify(sc)}`,2500));
      await onSave({...proj,scenes,keyframes:kf||[],videoPrompts:vp||[]});
    } catch(e){await err(`Fehler: ${e.message}`);}
    setLoading(false);
  };

  const setJob = (key,val) => setGenJobs(prev=>({...prev,[key]:{...prev[key],...val}}));
  const generateImage = async scene => {
    const k=`${scene.id}-image`;
    const kf=(proj.keyframes||[]).find(x=>x.sceneId===scene.id);
    const prompt=kf?.startFrame||`${scene.setting}, ${scene.action}, ${scene.mood}`;
    setJob(k,{status:"Sende…"});
    try {
      const sub=await muSubmit(proj.imageTool||"flux-dev-image",{prompt,aspect_ratio:"16:9"});
      if(!sub.request_id) throw new Error(sub.message||sub.error||"Submission fehlgeschlagen");
      setJob(k,{status:"Generiert…"});
      const res=await muPollUntilDone(sub.request_id,s=>setJob(k,{status:s==="processing"?"Generiert…":s}));
      const url=res?.data?.image_url||res?.image?.url||res?.data?.url;
      if(!url) throw new Error("Kein Bild-URL");
      const generations={...proj.generations,[scene.id]:{...(proj.generations?.[scene.id]||{}),image:url}};
      await onSave({...proj,generations}); setJob(k,{status:"done"});
    } catch(e){setJob(k,{status:"error",error:e.message});}
  };
  const generateVideo = async scene => {
    const k=`${scene.id}-video`;
    const vp=(proj.videoPrompts||[]).find(x=>x.sceneId===scene.id);
    const prompt=vp?.prompt||scene.action||"";
    const imageUrl=proj.generations?.[scene.id]?.image;
    const model=proj.videoTool||"kling-v2.6-pro-i2v";
    const isI2V=VID_MODELS[model]?.i2v&&imageUrl;
    const endpoint=isI2V?model:model.replace("-i2v","-t2v").replace("kling-v2.6-pro-i2v","kling-v2.6-pro-t2v").replace("veo3.1-image-to-video","veo3.1-text-to-video").replace("wan2.5-image-to-video","wan2.5-text-to-video");
    setJob(k,{status:"Sende…"});
    try {
      const body={prompt,duration:parseInt(vp?.duration||"4"),aspect_ratio:"16:9",...(isI2V?{image_url:imageUrl}:{})};
      const sub=await muSubmit(endpoint,body);
      if(!sub.request_id) throw new Error(sub.message||sub.error||"Submission fehlgeschlagen");
      setJob(k,{status:"Generiert…"});
      const res=await muPollUntilDone(sub.request_id,s=>setJob(k,{status:s==="processing"?"Generiert…":s}));
      const url=res?.data?.video_url||res?.video?.url||res?.data?.url;
      if(!url) throw new Error("Kein Video-URL");
      const generations={...proj.generations,[scene.id]:{...(proj.generations?.[scene.id]||{}),video:url}};
      await onSave({...proj,generations}); setJob(k,{status:"done"});
    } catch(e){setJob(k,{status:"error",error:e.message});}
  };
  const generateAll = async () => { for(const scene of (proj.scenes||[])){await generateImage(scene);await generateVideo(scene);} };
  const updPrompt = (type,sceneId,value) => {
    if(type==="keyframe") setP({keyframes:(proj.keyframes||[]).map(k=>k.sceneId===sceneId?{...k,startFrame:value}:k)});
    else setP({videoPrompts:(proj.videoPrompts||[]).map(v=>v.sceneId===sceneId?{...v,prompt:value}:v)});
  };
  const rate = (id, rating, issue="") => { const ratings={...proj.ratings,[id]:{rating,issue,ts:new Date().toISOString()}}; setP({ratings}); onSave({...proj,ratings}); };

  const hasPrompts = proj.videoPrompts?.length>0 && proj.keyframes?.length>0;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh"}}>
      {/* Topbar */}
      <div style={{background:"var(--surface)",borderBottom:"1px solid var(--border)",padding:"0 24px",height:52,display:"flex",alignItems:"center",gap:10,flexShrink:0,position:"sticky",top:0,zIndex:10}}>
        <button onClick={onBack} style={{fontSize:12,color:"var(--text-3)",background:"none",border:"none",cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:4}} onMouseEnter={e=>e.currentTarget.style.color="var(--text)"} onMouseLeave={e=>e.currentTarget.style.color="var(--text-3)"}>← {brand.name}</button>
        <div style={{width:"0.5px",height:14,background:"var(--border)"}} />
        <input value={proj.proj?.name||""} onChange={e=>setP({proj:{...proj.proj,name:e.target.value}})} onBlur={()=>onSave(proj)} placeholder="Projektname…" style={{flex:1,border:"none",fontSize:14,fontWeight:600,background:"transparent",outline:"none",width:"auto",fontFamily:"Syne, sans-serif"}} />
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {hasPrompts && <BtnPrimary onClick={generateAll} col="var(--teal)" style={{padding:"6px 14px",fontSize:12,width:"auto"}}>⚡ Alle generieren</BtnPrimary>}
          <button onClick={onNew} style={{fontSize:11,padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:"transparent",color:"var(--text-2)",cursor:"pointer"}}>+ Neu</button>
        </div>
      </div>

      {loading && (
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(20,20,43,.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(2px)"}}>
          <div style={{background:"var(--surface)",borderRadius:"var(--radius-lg)",padding:"20px 28px",display:"flex",alignItems:"center",gap:12,boxShadow:"var(--shadow-lg)"}}>
            <SpinInline col="var(--accent)" />
            <div style={{fontSize:13,fontWeight:500}}>{loadMsg}</div>
          </div>
        </div>
      )}

      <div style={{flex:1,overflowY:"auto",padding:"20px 24px 40px"}}>
        {/* Product */}
        <Card style={{marginBottom:12}}>
          {proj.productData?.analyzed ? (
            <div style={{display:"flex",gap:12}}>
              {proj.productData.imageB64&&<div style={{width:90,height:90,borderRadius:8,overflow:"hidden",flexShrink:0}}><img src={`data:${proj.productData.mediaType||"image/jpeg"};base64,${proj.productData.imageB64}`} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} /></div>}
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:"Syne,sans-serif",marginBottom:2}}>{proj.productData.analyzed.productName}</div>
                    {proj.productData.analyzed.colors?.length>0&&<div style={{fontSize:11,color:"var(--text-3)",marginBottom:6}}>{proj.productData.analyzed.colors.join(" · ")}</div>}
                    {proj.productData.analyzed.usps?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4}}>{proj.productData.analyzed.usps.slice(0,4).map((u,i)=><Tag key={i} col="var(--text-3)" bg="var(--bg)">{u}</Tag>)}</div>}
                  </div>
                  <button onClick={()=>{setP({productData:{imageB64:null,mediaType:null,imageUrl:"",analyzed:null,mockupPrompts:[]}});onSave({...proj,productData:{imageB64:null,mediaType:null,imageUrl:"",analyzed:null,mockupPrompts:[]}});}} style={{fontSize:11,color:"var(--text-3)",background:"none",border:"none",cursor:"pointer"}}>↺ ändern</button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text-2)",marginBottom:8}}>Produkt hinzufügen</div>
              <div style={{display:"flex",gap:5,marginBottom:8}}>
                {[["upload","↑ Upload"],["url","URL"],["manual","Manuell"]].map(([t,l])=>(
                  <button key={t} onClick={()=>setPdTab(t)} style={{fontSize:11,padding:"4px 10px",borderRadius:6,cursor:"pointer",border:`1px solid ${pdTab===t?"var(--accent)":"var(--border)"}`,background:pdTab===t?"var(--accent-light)":"transparent",color:pdTab===t?"var(--accent)":"var(--text-2)",fontWeight:pdTab===t?500:400}}>{l}</button>
                ))}
              </div>
              {pdTab==="upload"&&<div onClick={()=>fileRef.current?.click()} style={{border:"1.5px dashed var(--border)",borderRadius:"var(--radius)",padding:"20px",textAlign:"center",cursor:"pointer",color:"var(--text-3)",fontSize:12}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}><div style={{fontSize:22,marginBottom:4}}>⬆</div>Produktbild hochladen<input ref={fileRef} type="file" accept="image/*" onChange={async e=>{const f=e.target.files[0];if(f)analyzeProduct(await fileToB64(f),f.type,null);}} style={{display:"none"}} /></div>}
              {pdTab==="url"&&<div style={{display:"flex",gap:6}}><input value={pdUrl} onChange={e=>setPdUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&analyzeProduct(null,null,pdUrl.trim())} placeholder="https://shop.example.com/produkt" /><BtnPrimary onClick={()=>analyzeProduct(null,null,pdUrl.trim())} col={brand.color} style={{whiteSpace:"nowrap",padding:"0 12px",width:"auto"}}>Analysieren</BtnPrimary></div>}
              {pdTab==="manual"&&<textarea value={proj.proj?.product||""} onChange={e=>setP({proj:{...proj.proj,product:e.target.value}})} onBlur={()=>onSave(proj)} placeholder="Produkt beschreiben…" rows={3} />}
            </div>
          )}
        </Card>

        {/* Controls */}
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12,alignItems:"flex-end"}}>
          <div style={{flex:"1 1 200px"}}>
            <FieldLabel>Typ</FieldLabel>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {Object.entries(CT).map(([k,v])=>(
                <button key={k} onClick={()=>setP({contentType:k})} style={{fontSize:11,padding:"4px 10px",borderRadius:7,cursor:"pointer",border:`1px solid ${proj.contentType===k?v.col:"var(--border)"}`,background:proj.contentType===k?v.bg:"transparent",color:proj.contentType===k?v.col:"var(--text-2)",fontWeight:proj.contentType===k?600:400}}>{v.icon} {v.label}</button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>Szenen</FieldLabel>
            <div style={{display:"flex",gap:3}}>{[3,4,5,6,8,10].map(n=>(
              <button key={n} onClick={()=>setP({sceneCount:n})} style={{width:28,height:27,borderRadius:6,cursor:"pointer",fontFamily:"monospace",fontSize:11,border:`1px solid ${proj.sceneCount===n?ct.col:"var(--border)"}`,background:proj.sceneCount===n?ct.bg:"var(--surface)",color:proj.sceneCount===n?ct.col:"var(--text-2)",fontWeight:proj.sceneCount===n?700:400}}>{n}</button>
            ))}</div>
          </div>
          <div>
            <FieldLabel>Keyframe</FieldLabel>
            <select value={proj.imageTool||"flux-dev-image"} onChange={e=>setP({imageTool:e.target.value})} style={{width:"auto"}}>
              {Object.entries(IMG_MODELS).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Video-Modell</FieldLabel>
            <select value={proj.videoTool||"kling-v2.6-pro-i2v"} onChange={e=>setP({videoTool:e.target.value})} style={{width:"auto"}}>
              {Object.entries(VID_MODELS).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <FieldLabel>Fragen</FieldLabel>
            <Toggle val={qfEnabled} onChange={onQfToggle} col={ct.col} />
          </div>
          <div style={{marginLeft:"auto"}}>
            {proj.contentType==="impossible"&&!proj.scenes?.length&&!proj.sparring?.length
              ? <BtnPrimary onClick={startSpar} col={ct.col}>✦ Sparring starten</BtnPrimary>
              : qfEnabled&&!proj.scenes?.length
                ? <BtnPrimary onClick={()=>setShowQF(true)} col={ct.col}>⚡ Alles generieren</BtnPrimary>
                : <BtnPrimary onClick={()=>genAll(proj.sceneAnswers||null)} col={ct.col}>{proj.scenes?.length?"↺ Neu generieren":"⚡ Alles generieren"}</BtnPrimary>}
          </div>
        </div>

        {/* Fields */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          <Fld label="Kampagnenziel" value={proj.proj?.goal||""} onChange={v=>setP({proj:{...proj.proj,goal:v}})} onBlur={()=>onSave(proj)} placeholder="Produktlaunch, Awareness, Abverkauf…" />
          <Fld label="Plattform" value={proj.proj?.platform||""} onChange={v=>setP({proj:{...proj.proj,platform:v}})} onBlur={()=>onSave(proj)} placeholder="Instagram, TikTok, YouTube…" />
        </div>

        {/* Quickfire */}
        {showQF&&(
          <Card style={{marginBottom:12,border:`1px solid ${ct.col}44`}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:10,fontFamily:"Syne,sans-serif"}}>Richtungs-Fragen</div>
            {(QUICKFIRE[proj.contentType]||QUICKFIRE.product).map((q,qi)=>(
              <div key={q.id} style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:500,marginBottom:4,display:"flex",gap:6,alignItems:"center"}}><span style={{background:"var(--bg)",borderRadius:4,padding:"1px 5px",fontSize:9,fontFamily:"monospace",color:"var(--text-3)"}}>{qi+1}</span>{q.q}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {q.opts.map(opt=><button key={opt.v} onClick={()=>setQfAns(a=>({...a,[q.id]:opt.v}))} style={{fontSize:11,padding:"4px 10px",borderRadius:7,cursor:"pointer",border:`1px solid ${qfAns[q.id]===opt.v?ct.col:"var(--border)"}`,background:qfAns[q.id]===opt.v?ct.bg:"transparent",color:qfAns[q.id]===opt.v?ct.col:"var(--text-2)",fontWeight:qfAns[q.id]===opt.v?500:400}}>{opt.l}</button>)}
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <BtnGhost onClick={()=>{setShowQF(false);genAll(null);}}>Überspringen</BtnGhost>
              <BtnPrimary onClick={()=>{const q=QUICKFIRE[proj.contentType]||QUICKFIRE.product;if(q.every(x=>qfAns[x.id])){setP({sceneAnswers:qfAns});genAll(qfAns);}}} col={ct.col} style={{flex:2,opacity:(QUICKFIRE[proj.contentType]||QUICKFIRE.product).every(q=>qfAns[q.id])?1:0.5}}>Generieren →</BtnPrimary>
            </div>
          </Card>
        )}

        {/* Sparring */}
        {proj.contentType==="impossible"&&proj.sparring?.length>0&&!proj.scenes?.length&&(
          <Card style={{marginBottom:12,overflow:"hidden",padding:0}}>
            <div style={{maxHeight:280,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
              {proj.sparring.map((m,i)=>(
                <div key={i} style={{display:"flex",gap:7,justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                  {m.role==="assistant"&&<div style={{width:22,height:22,borderRadius:"50%",background:ct.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:ct.col,flexShrink:0,marginTop:2}}>✦</div>}
                  <div style={{maxWidth:"82%",fontSize:12,lineHeight:1.6,padding:"7px 10px",borderRadius:10,whiteSpace:"pre-wrap",background:m.role==="user"?"var(--bg)":ct.bg,border:m.role==="assistant"?`1px solid ${ct.col}33`:"1px solid var(--border)",color:"var(--text)"}}>{m.content}</div>
                </div>
              ))}
              {sparSend&&<div style={{display:"flex",gap:7}}><div style={{width:22,height:22,borderRadius:"50%",background:ct.bg,flexShrink:0}} /><div style={{fontSize:12,padding:"7px 10px",borderRadius:10,background:ct.bg,border:`1px solid ${ct.col}33`,display:"flex",gap:3,alignItems:"center"}}><Dots /></div></div>}
              <div ref={sparRef} />
            </div>
            <div style={{borderTop:"1px solid var(--border)",padding:"8px 12px",display:"flex",gap:6}}>
              <input value={sparIn} onChange={e=>setSparIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),sendSpar(sparIn))} disabled={sparSend} placeholder="Reagieren… (Enter)" style={{flex:1}} />
              <BtnPrimary onClick={()=>sendSpar(sparIn)} col={ct.col} style={{width:"auto",padding:"0 12px",opacity:sparSend?0.5:1}}>→</BtnPrimary>
            </div>
            <div style={{padding:"8px 12px",borderTop:"1px solid var(--border)"}}>
              <BtnPrimary onClick={sparToScenes} col={ct.col}>Konzept → Szenen & Prompts</BtnPrimary>
            </div>
          </Card>
        )}

        {/* Scenes */}
        {(proj.scenes||[]).map(scene=>{
          const kf=(proj.keyframes||[]).find(k=>k.sceneId===scene.id);
          const vp=(proj.videoPrompts||[]).find(v=>v.sceneId===scene.id);
          const r=proj.ratings?.[scene.id]||{};
          const iJ=genJobs[`${scene.id}-image`];
          const vJ=genJobs[`${scene.id}-video`];
          const imgResult=proj.generations?.[scene.id]?.image;
          const vidResult=proj.generations?.[scene.id]?.video;
          return (
            <Card key={scene.id} style={{marginBottom:10,padding:0,overflow:"hidden",border:r.rating?"1px solid var(--teal)44":"1px solid var(--border)"}}>
              <div style={{padding:"8px 14px",background:"var(--bg)",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid var(--border)"}}>
                <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:99,background:ct.bg,color:ct.col,fontFamily:"monospace"}}>#{scene.id}</span>
                <span style={{fontSize:10,color:"var(--text-3)"}}>{scene.duration}</span>
                <span style={{fontSize:12,color:"var(--text)",flex:1,fontWeight:400}}>{scene.action}</span>
                <span style={{fontSize:11,color:"var(--text-3)",fontStyle:"italic"}}>{scene.mood}</span>
                <div style={{display:"flex",gap:3}}>
                  {["✅","⚠️","❌"].map(rt=><button key={rt} onClick={()=>rate(scene.id,rt)} style={{padding:"2px 5px",borderRadius:5,border:`1px solid ${r.rating===rt?"var(--teal)":"var(--border)"}`,background:r.rating===rt?"rgba(0,200,150,.1)":"var(--surface)",cursor:"pointer",fontSize:10,opacity:r.rating&&r.rating!==rt?0.3:1}}>{rt}</button>)}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
                <div style={{padding:"10px 14px",borderRight:"1px solid var(--border)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text-3)"}}>Keyframe · {IMG_MODELS[proj.imageTool||"flux-dev-image"]?.name}</span>
                    <div style={{display:"flex",gap:3}}>
                      {kf?.startFrame&&<CopyBtn onClick={()=>copy(kf.startFrame,`kf-${scene.id}`)} done={copied===`kf-${scene.id}`} />}
                      <IBtn onClick={()=>regenOne(scene.id,"keyframe")}>↺</IBtn>
                    </div>
                  </div>
                  {kf?.startFrame&&<EPrompt value={kf.startFrame} onChange={v=>updPrompt("keyframe",scene.id,v)} onBlur={()=>onSave(proj)} />}
                  {!kf?.startFrame&&<div style={{fontSize:11,color:"var(--text-3)",fontStyle:"italic",padding:"4px 0"}}>Noch nicht generiert</div>}
                  <div style={{marginTop:8}}>
                    {imgResult
                      ? <div><img src={imgResult} alt="" style={{width:"100%",borderRadius:8,display:"block",marginBottom:5}} /><div style={{display:"flex",gap:4}}><a href={imgResult} target="_blank" rel="noreferrer" style={{flex:1,fontSize:11,padding:"5px 8px",borderRadius:7,border:"1px solid var(--border)",color:"var(--text-2)",textAlign:"center",textDecoration:"none"}}>↓ Download</a><IBtn onClick={()=>generateImage(scene)}>↺</IBtn></div></div>
                      : <GenBtn onClick={()=>generateImage(scene)} job={iJ} label="Bild generieren" col="#FF6B35" />}
                  </div>
                </div>
                <div style={{padding:"10px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <span style={{fontSize:9,fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text-3)"}}>Video · {VID_MODELS[proj.videoTool||"kling-v2.6-pro-i2v"]?.name}</span>
                    <div style={{display:"flex",gap:3}}>
                      {vp?.prompt&&<CopyBtn onClick={()=>copy(vp.prompt,`vp-${scene.id}`)} done={copied===`vp-${scene.id}`} />}
                      <IBtn onClick={()=>regenOne(scene.id,"video")}>↺</IBtn>
                    </div>
                  </div>
                  {vp?.prompt&&<EPrompt value={vp.prompt} onChange={v=>updPrompt("video",scene.id,v)} onBlur={()=>onSave(proj)} />}
                  {!vp?.prompt&&<div style={{fontSize:11,color:"var(--text-3)",fontStyle:"italic",padding:"4px 0"}}>Noch nicht generiert</div>}
                  <div style={{marginTop:8}}>
                    {vidResult
                      ? <div><video src={vidResult} controls style={{width:"100%",borderRadius:8,display:"block",marginBottom:5}} /><div style={{display:"flex",gap:4}}><a href={vidResult} target="_blank" rel="noreferrer" style={{flex:1,fontSize:11,padding:"5px 8px",borderRadius:7,border:"1px solid var(--border)",color:"var(--text-2)",textAlign:"center",textDecoration:"none"}}>↓ Download</a><IBtn onClick={()=>generateVideo(scene)}>↺</IBtn></div></div>
                      : <GenBtn onClick={()=>generateVideo(scene)} job={vJ} label="Video generieren" col="var(--accent)" note={!imgResult?"Erst Keyframe generieren":null} />}
                  </div>
                </div>
              </div>
              {r.rating&&(r.rating==="⚠️"||r.rating==="❌")&&(
                <div style={{padding:"6px 14px",borderTop:"1px solid var(--border)",display:"flex",flexWrap:"wrap",gap:4}}>
                  {["Produkt-Form","Produkt-Farbe","Kamerabewegung","Objektbewegung","Beleuchtung","Stil/Mood","Sonstiges"].map(tag=>(
                    <button key={tag} onClick={()=>rate(scene.id,r.rating,tag)} style={{fontSize:10,padding:"2px 7px",borderRadius:99,cursor:"pointer",border:`1px solid ${r.issue===tag?"var(--orange)":"var(--border)"}`,background:r.issue===tag?"rgba(255,107,53,.1)":"transparent",color:r.issue===tag?"var(--orange)":"var(--text-3)"}}>{tag}</button>
                  ))}
                </div>
              )}
            </Card>
          );
        })}

        {/* Mockup prompts */}
        {proj.productData?.mockupPrompts?.length>0&&!proj.scenes?.length&&(
          <div style={{marginTop:4}}>
            <FieldLabel>Mockup-Prompt-Ideen</FieldLabel>
            {proj.productData.mockupPrompts.map((mp,i)=>(
              <div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 10px",marginBottom:4,display:"flex",gap:8,alignItems:"flex-start"}}>
                <span style={{fontSize:9,fontFamily:"monospace",color:brand.color,flexShrink:0,marginTop:1,fontWeight:700}}>{mp.setting}</span>
                <span style={{fontSize:11,color:"var(--text-2)",lineHeight:1.5,flex:1}}>{mp.prompt}</span>
                <CopyBtn onClick={()=>copy(mp.prompt,`mp-${i}`)} done={copied===`mp-${i}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Design System ────────────────────────────────────────────────────────────
function PageHeader({ title, sub, col }) {
  return (
    <div style={{marginBottom:24}}>
      <div style={{fontSize:26,fontWeight:700,fontFamily:"Syne, sans-serif",letterSpacing:"-.01em",display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
        {col&&<div style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0}} />}
        {title}
      </div>
      {sub&&<div style={{fontSize:12,color:"var(--text-3)"}}>{sub}</div>}
    </div>
  );
}

function Card({ children, onClick, hover, style={} }) {
  const [hov,setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>hover&&setHov(true)} onMouseLeave={()=>hover&&setHov(false)}
      style={{background:"var(--surface)",border:`1px solid ${hov?"var(--border-2)":"var(--border)"}`,borderRadius:"var(--radius)",padding:"12px 14px",boxShadow:hov?"var(--shadow)":"var(--shadow-sm)",transition:"border-color .15s,box-shadow .15s",...style}}>
      {children}
    </div>
  );
}

function EPrompt({ value, onChange, onBlur }) {
  const [editing,setEditing] = useState(false);
  if(editing) return <textarea value={value} onChange={e=>onChange(e.target.value)} onBlur={()=>{setEditing(false);onBlur();}} autoFocus rows={4} style={{fontFamily:"'DM Mono',monospace,monospace",fontSize:11,lineHeight:1.6,borderColor:"var(--accent)"}} />;
  return <div onClick={()=>setEditing(true)} style={{fontFamily:"'DM Mono',monospace,monospace",fontSize:11,background:"var(--bg)",borderRadius:6,padding:"6px 8px",lineHeight:1.6,color:"var(--text-2)",cursor:"text",wordBreak:"break-word",border:"1px solid transparent",minHeight:36,transition:"border-color .15s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border)"} onMouseLeave={e=>e.currentTarget.style.borderColor="transparent"}>{value}</div>;
}

function GenBtn({ onClick, job, label, col, note }) {
  const isL = job&&job.status!=="done"&&job.status!=="error";
  const isE = job?.status==="error";
  return <div>
    {note&&!job&&<div style={{fontSize:10,color:"var(--text-3)",marginBottom:4,fontStyle:"italic"}}>{note}</div>}
    <button onClick={onClick} disabled={isL} style={{width:"100%",padding:"7px 12px",borderRadius:8,border:"none",background:isE?"rgba(255,68,68,.1)":isL?"var(--bg)":col,color:isE?"var(--red)":isL?"var(--text-3)":"#fff",fontSize:12,fontWeight:600,cursor:isL?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"opacity .15s",fontFamily:"inherit"}}>
      {isL&&<Dots />}
      {isE?`Fehler: ${job.error}`:isL?job.status:label}
    </button>
  </div>;
}

function Fld({ label, rows, value, onChange, onBlur, placeholder }) {
  const T = rows?"textarea":"input";
  return <div style={{marginBottom:8}}>
    <FieldLabel>{label}</FieldLabel>
    <T value={value} onChange={e=>onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder||""} rows={rows} />
  </div>;
}

function FieldLabel({ children }) { return <div style={{fontSize:10,fontWeight:600,color:"var(--text-3)",marginBottom:4,textTransform:"uppercase",letterSpacing:".08em"}}>{children}</div>; }
function Tag({ col, bg, children }) { return <span style={{fontSize:9,padding:"2px 7px",borderRadius:99,background:bg||`${col}18`,color:col,fontWeight:600,whiteSpace:"nowrap"}}>{children}</span>; }
function Divider() { return <div style={{height:"0.5px",background:"var(--border)",margin:"10px 0"}} />; }
function Progress({ val, max, col }) { return <div style={{display:"flex",gap:3}}>{Array.from({length:max},(_,i)=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:i<val?col:"var(--border)"}} />)}</div>; }
function FileTag({ name, onRemove }) { return <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:"var(--bg)",border:"1px solid var(--border)",borderRadius:7,fontSize:11,flex:1}}><span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span><button onClick={onRemove} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text-3)",fontSize:13,lineHeight:1}}>×</button></div>; }
function StatusBar({ msg, col }) { return <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:col+"14",borderRadius:8,marginBottom:10,fontSize:12}}><SpinInline col={col} />{msg}</div>; }
function Empty({ text }) { return <div style={{border:"1.5px dashed var(--border)",borderRadius:"var(--radius)",padding:"32px 20px",textAlign:"center",color:"var(--text-3)",fontSize:13}}>{text}</div>; }
function BtnPrimary({ onClick, col, children, style={} }) { return <button onClick={onClick} style={{padding:"8px 16px",borderRadius:8,border:"none",background:col||"var(--accent)",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",display:"block",width:"100%",fontFamily:"inherit",transition:"opacity .15s",...style}} onMouseEnter={e=>e.currentTarget.style.opacity=".85"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>{children}</button>; }
function BtnGhost({ onClick, children }) { return <button onClick={onClick} style={{flex:1,padding:"7px 12px",borderRadius:8,border:"1px solid var(--border)",background:"transparent",color:"var(--text-2)",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{children}</button>; }
function IBtn({ onClick, children }) { return <button onClick={onClick} style={{fontSize:11,padding:"2px 6px",borderRadius:5,border:"1px solid var(--border)",background:"var(--surface)",cursor:"pointer",color:"var(--text-3)"}}>{children}</button>; }
function CopyBtn({ onClick, done }) { return <button onClick={onClick} style={{fontSize:10,padding:"2px 6px",borderRadius:5,border:"1px solid var(--border)",background:"var(--surface)",cursor:"pointer",color:done?"var(--teal)":"var(--text-3)",fontWeight:done?600:400}}>{done?"✓":"Kopieren"}</button>; }
function Toggle({ val, onChange, col }) { return <div onClick={()=>onChange(!val)} style={{width:30,height:17,borderRadius:99,background:val?col:"var(--border)",cursor:"pointer",position:"relative",transition:"background .2s"}}><div style={{position:"absolute",top:2.5,left:val?14:2.5,width:12,height:12,borderRadius:"50%",background:"#fff",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}} /></div>; }
function Dots() { return <span style={{display:"flex",gap:3}}><style>{"@keyframes blink{0%,100%{opacity:.3}50%{opacity:1}}"}</style>{[0,.3,.6].map((d,i)=><span key={i} style={{width:4,height:4,borderRadius:"50%",background:"currentColor",animation:`blink 1.2s ${d}s ease infinite`,display:"inline-block"}} />)}</span>; }
function SpinInline({ col="var(--text-3)" }) { return <span style={{display:"inline-block",animation:"spin 1.2s linear infinite",fontSize:14,color:col,lineHeight:1}}><style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>◎</span>; }
function Spin({ msg }) { return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",gap:14}}><SpinInline col="var(--accent)" /><div style={{fontSize:12,color:"var(--text-3)"}}>{msg}</div></div>; }
