import { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase";

const falSubmit  = (appId, input) => fetch("/api/fal", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action:"submit", appId, input }) }).then(r=>r.json());
const falStatus  = (appId, requestId) => fetch("/api/fal", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action:"status", appId, requestId }) }).then(r=>r.json());
const falResult  = (appId, requestId) => fetch("/api/fal", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action:"result", appId, requestId }) }).then(r=>r.json());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const falPollUntilDone = async (appId, requestId, onStatus) => {
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const status = await falStatus(appId, requestId);
    onStatus(status.status);
    if (status.status === "COMPLETED") return await falResult(appId, requestId);
    if (status.status === "FAILED") throw new Error(status.error || "Generation failed");
  }
  throw new Error("Timeout after 5 minutes");
};

const IMAGE_MODELS = {
  "fal-ai/flux/schnell":        { name: "Flux Schnell",  desc: "Schnell & günstig" },
  "fal-ai/flux-pro":            { name: "Flux Pro",      desc: "Hohe Qualität" },
  "fal-ai/flux-pro/v1.1-ultra": { name: "Flux Ultra",    desc: "Beste Qualität" },
};

const VIDEO_MODELS = {
  "fal-ai/kling-video/v2.1/standard/image-to-video": { name: "Kling 2.1",     desc: "Realistisch, stabil" },
  "fal-ai/kling-video/v1.6/pro/image-to-video":      { name: "Kling 1.6 Pro", desc: "Bewährt, präzise" },
  "fal-ai/minimax/video-01-live":                     { name: "Hailuo",        desc: "Schnell, günstig" },
  "fal-ai/wan/v2.1/image-to-video":                  { name: "Wan 2.1",       desc: "Open Source" },
  "fal-ai/kling-video/v2.1/standard/text-to-video":  { name: "Kling 2.1 (Text)", desc: "Kein Keyframe nötig" },
  "fal-ai/minimax/video-01":                          { name: "Hailuo (Text)", desc: "Schnell" },
};

const saveGenerationResult = async (projectId, sceneId, type, result) => {
  try {
    const { data: proj } = await supabase.from("projects").select("data").eq("id", projectId).single();
    if (!proj) return;
    const updated = { ...proj.data };
    if (!updated.generations) updated.generations = {};
    if (!updated.generations[sceneId]) updated.generations[sceneId] = {};
    updated.generations[sceneId][type] = result;
    await supabase.from("projects").update({ data: updated, updated_at: new Date().toISOString() }).eq("id", projectId);
  } catch(e) { console.error("Save result error:", e); }
};

export default function App() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const urlProjectId = new URLSearchParams(window.location.search).get("project");

  useEffect(() => {
    (async () => {
      try {
        if (urlProjectId) {
          const { data } = await supabase.from("projects").select("data, name, brand_id").eq("id", urlProjectId).single();
          if (data) {
            const { data: brand } = await supabase.from("brands").select("name, color, foundation").eq("id", data.brand_id).single();
            setSelected({ ...data.data, _brand: brand });
          }
        } else {
          const { data } = await supabase.from("projects").select("id, name, content_type, updated_at, brand_id, steps_done").order("updated_at", { ascending: false });
          setProjects(data || []);
        }
      } catch(e) {
        setError("Verbindung zu Supabase fehlgeschlagen. Bitte Zugangsdaten prüfen.");
      }
      setLoading(false);
    })();
  }, []);

  const openProject = async (proj) => {
    setLoading(true);
    const { data } = await supabase.from("projects").select("data, brand_id").eq("id", proj.id).single();
    const { data: brand } = await supabase.from("brands").select("name, color, foundation").eq("id", proj.brand_id).single();
    setSelected({ ...data.data, _id: proj.id, _brand: brand });
    setLoading(false);
  };

  if (loading) return <Spinner msg="Wird geladen..." />;
  if (error)   return <ErrorScreen msg={error} />;
  if (selected) return <GenerationDashboard project={selected} onBack={() => { setSelected(null); window.history.pushState({}, "", "/"); }} />;
  return <ProjectList projects={projects} onSelect={openProject} />;
}

function ProjectList({ projects, onSelect }) {
  const COLORS = { product:"#7F77DD", ugc:"#1D9E75", talkinghead:"#BA7517", impossible:"#D85A30" };
  const LABELS = { product:"Product Ad", ugc:"UGC Style", talkinghead:"Talking Head", impossible:"AI Creative" };
  return (
    <div style={{ maxWidth:640, margin:"0 auto", padding:"32px 24px", fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ marginBottom:28 }}>
        <div style={{ fontSize:11, fontFamily:"monospace", letterSpacing:".1em", textTransform:"uppercase", color:"#9b9b99", marginBottom:6 }}>AI Video</div>
        <div style={{ fontSize:24, fontWeight:600, letterSpacing:"-.02em", marginBottom:4 }}>Generation Dashboard</div>
        <div style={{ fontSize:13, color:"#5c5c5a" }}>Wähle ein Projekt um Clips zu generieren.</div>
      </div>
      {projects.length === 0 && (
        <div style={{ border:"1.5px dashed #e5e5e3", borderRadius:12, padding:40, textAlign:"center", color:"#9b9b99", fontSize:13 }}>
          Noch keine Projekte. Erstelle zuerst ein Projekt im Claude Artifact.
        </div>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {projects.map(p => {
          const col = COLORS[p.content_type] || "#7F77DD";
          return (
            <div key={p.id} onClick={() => onSelect(p)} style={{ border:"0.5px solid #efefed", borderRadius:10, padding:"12px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#d4d4d2"} onMouseLeave={e=>e.currentTarget.style.borderColor="#efefed"}>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                  <span style={{ fontSize:13, fontWeight:500 }}>{p.name || "Ohne Titel"}</span>
                  <span style={{ fontSize:9, padding:"1px 6px", borderRadius:8, background:`${col}18`, color:col, fontFamily:"monospace" }}>{LABELS[p.content_type] || p.content_type}</span>
                </div>
                <span style={{ fontSize:10, color:"#9b9b99" }}>{new Date(p.updated_at).toLocaleDateString("de-DE")}</span>
              </div>
              <span style={{ color:"#9b9b99", fontSize:14 }}>→</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GenerationDashboard({ project, onBack }) {
  const brand  = project._brand || {};
  const scenes = project.scenes || [];
  const [gens, setGens]       = useState(project.generations || {});
  const [imgModel, setImgModel] = useState("fal-ai/flux/schnell");
  const [vidModel, setVidModel] = useState("fal-ai/kling-video/v2.1/standard/image-to-video");
  const [jobs, setJobs]       = useState({});
  const projectId = project._id || project.id;

  const setJob = (key, val) => setJobs(prev => ({ ...prev, [key]: { ...prev[key], ...val } }));
  const setGen = (sceneId, type, val) => {
    setGens(prev => {
      const next = { ...prev, [sceneId]: { ...(prev[sceneId]||{}), [type]: val } };
      if (projectId) saveGenerationResult(projectId, sceneId, type, val);
      return next;
    });
  };

  const generateImage = async (scene) => {
    const key = `${scene.id}-image`;
    const kf = (project.keyframes||[]).find(k=>k.sceneId===scene.id);
    const prompt = kf?.startFrame || `${scene.setting}, ${scene.action}, ${scene.mood}`;
    setJob(key, { status:"Wird gesendet..." });
    try {
      const sub = await falSubmit(imgModel, { prompt, image_size:"landscape_16_9", num_images:1, sync_mode:false });
      if (!sub.request_id) throw new Error(sub.detail || "Submission failed");
      setJob(key, { status:"Generiert..." });
      const result = await falPollUntilDone(imgModel, sub.request_id, s => setJob(key, { status: s === "IN_PROGRESS" ? "Generiert..." : s }));
      const url = result?.images?.[0]?.url || result?.image?.url;
      if (!url) throw new Error("Kein Bild-URL in Ergebnis");
      setGen(scene.id, "image", url);
      setJob(key, { status:"done" });
    } catch(e) { setJob(key, { status:"error", error: e.message }); }
  };

  const generateVideo = async (scene) => {
    const key = `${scene.id}-video`;
    const vp = (project.videoPrompts||[]).find(v=>v.sceneId===scene.id);
    const prompt = vp?.prompt || scene.action || "";
    const imageUrl = gens[scene.id]?.image;
    const appId = imageUrl ? vidModel : vidModel.replace("image-to-video","text-to-video");
    setJob(key, { status:"Wird gesendet..." });
    try {
      const input = { prompt, duration:5, ...(imageUrl ? { image_url: imageUrl } : {}) };
      const sub = await falSubmit(appId, input);
      if (!sub.request_id) throw new Error(sub.detail || "Submission failed");
      setJob(key, { status:"Generiert..." });
      const result = await falPollUntilDone(appId, sub.request_id, s => setJob(key, { status: s === "IN_PROGRESS" ? "Generiert..." : s }));
      const url = result?.video?.url || result?.videos?.[0]?.url;
      if (!url) throw new Error("Kein Video-URL in Ergebnis");
      setGen(scene.id, "video", url);
      setJob(key, { status:"done" });
    } catch(e) { setJob(key, { status:"error", error: e.message }); }
  };

  const generateAll = async () => {
    for (const scene of scenes) {
      await generateImage(scene);
      await generateVideo(scene);
    }
  };

  return (
    <div style={{ maxWidth:800, margin:"0 auto", padding:"24px 20px", fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:20, paddingBottom:16, borderBottom:"0.5px solid #efefed" }}>
        <button onClick={onBack} style={{ fontSize:12, color:"#9b9b99", background:"none", border:"none", cursor:"pointer", padding:"4px 0", marginTop:2 }}>← Alle Projekte</button>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
            {brand.color && <div style={{ width:10, height:10, borderRadius:"50%", background:brand.color }} />}
            <span style={{ fontSize:11, color:"#9b9b99" }}>{brand.name}</span>
          </div>
          <div style={{ fontSize:20, fontWeight:600, letterSpacing:"-.01em" }}>{project.proj?.name || "Projekt"}</div>
          {project.productData?.analyzed?.productName && <div style={{ fontSize:12, color:"#5c5c5a", marginTop:2 }}>{project.productData.analyzed.productName}</div>}
        </div>
        <button onClick={generateAll} style={{ padding:"9px 18px", borderRadius:9, border:"none", background:brand.color||"#7F77DD", color:"#fff", fontSize:13, fontWeight:500, cursor:"pointer", flexShrink:0 }}>⚡ Alle generieren</button>
      </div>

      <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <ModelPicker label="Keyframe-Modell" value={imgModel} onChange={setImgModel} options={IMAGE_MODELS} col="#BA7517" />
        <ModelPicker label="Video-Modell" value={vidModel} onChange={setVidModel} options={VIDEO_MODELS} col="#7F77DD" />
      </div>

      {scenes.length === 0 && <div style={{ border:"1.5px dashed #e5e5e3", borderRadius:12, padding:40, textAlign:"center", color:"#9b9b99", fontSize:13 }}>Keine Szenen gefunden. Bitte erst im Claude Artifact generieren.</div>}

      {scenes.map(scene => {
        const kf = (project.keyframes||[]).find(k=>k.sceneId===scene.id);
        const vp = (project.videoPrompts||[]).find(v=>v.sceneId===scene.id);
        const imgJ = jobs[`${scene.id}-image`];
        const vidJ = jobs[`${scene.id}-video`];
        const imgResult = gens[scene.id]?.image;
        const vidResult = gens[scene.id]?.video;
        return (
          <div key={scene.id} style={{ border:"0.5px solid #efefed", borderRadius:12, overflow:"hidden", marginBottom:12 }}>
            <div style={{ padding:"10px 14px", background:"#f7f7f6", borderBottom:"0.5px solid #efefed", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"monospace", fontSize:9, padding:"2px 6px", borderRadius:4, background:"rgba(127,119,221,.12)", color:"#7F77DD" }}>SZENE {scene.id}</span>
              <span style={{ fontSize:11, color:"#9b9b99" }}>{scene.duration}</span>
              <span style={{ fontSize:11, color:"#5c5c5a", flex:1 }}>{scene.action}</span>
              <span style={{ fontSize:10, color:"#9b9b99", fontStyle:"italic" }}>{scene.mood}</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0 }}>
              <div style={{ padding:"12px 14px", borderRight:"0.5px solid #efefed" }}>
                <div style={{ fontSize:10, fontFamily:"monospace", color:"#9b9b99", marginBottom:8 }}>KEYFRAME</div>
                {kf?.startFrame && <div style={{ fontFamily:"monospace", fontSize:10, background:"#f7f7f6", borderRadius:6, padding:"6px 8px", lineHeight:1.6, color:"#5c5c5a", marginBottom:8, wordBreak:"break-word" }}>{kf.startFrame}</div>}
                {imgResult ? (
                  <div>
                    <img src={imgResult} alt="" style={{ width:"100%", borderRadius:8, display:"block", marginBottom:6 }} />
                    <div style={{ display:"flex", gap:5 }}>
                      <a href={imgResult} target="_blank" rel="noreferrer" style={{ flex:1, fontSize:11, padding:"5px 8px", borderRadius:6, border:"0.5px solid #d4d4d2", color:"#5c5c5a", textAlign:"center", textDecoration:"none" }}>↓ Download</a>
                      <button onClick={()=>generateImage(scene)} style={{ fontSize:11, padding:"5px 8px", borderRadius:6, border:"0.5px solid #d4d4d2", background:"transparent", color:"#9b9b99", cursor:"pointer" }}>↺</button>
                    </div>
                  </div>
                ) : <GenButton onClick={()=>generateImage(scene)} job={imgJ} label="Bild generieren" col="#BA7517" />}
              </div>
              <div style={{ padding:"12px 14px" }}>
                <div style={{ fontSize:10, fontFamily:"monospace", color:"#9b9b99", marginBottom:8 }}>VIDEO</div>
                {vp?.prompt && <div style={{ fontFamily:"monospace", fontSize:10, background:"#f7f7f6", borderRadius:6, padding:"6px 8px", lineHeight:1.6, color:"#5c5c5a", marginBottom:8, wordBreak:"break-word" }}>{vp.prompt}</div>}
                {vidResult ? (
                  <div>
                    <video src={vidResult} controls style={{ width:"100%", borderRadius:8, display:"block", marginBottom:6 }} />
                    <div style={{ display:"flex", gap:5 }}>
                      <a href={vidResult} target="_blank" rel="noreferrer" style={{ flex:1, fontSize:11, padding:"5px 8px", borderRadius:6, border:"0.5px solid #d4d4d2", color:"#5c5c5a", textAlign:"center", textDecoration:"none" }}>↓ Download</a>
                      <button onClick={()=>generateVideo(scene)} style={{ fontSize:11, padding:"5px 8px", borderRadius:6, border:"0.5px solid #d4d4d2", background:"transparent", color:"#9b9b99", cursor:"pointer" }}>↺</button>
                    </div>
                  </div>
                ) : <GenButton onClick={()=>generateVideo(scene)} job={vidJ} label="Video generieren" col="#7F77DD" note={!gens[scene.id]?.image ? "Erst Keyframe generieren für beste Ergebnisse" : null} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelPicker({ label, value, onChange, options, col }) {
  return (
    <div style={{ flex:1, minWidth:200 }}>
      <div style={{ fontSize:10, fontFamily:"monospace", color:"#9b9b99", marginBottom:6 }}>{label.toUpperCase()}</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
        {Object.entries(options).map(([id, m]) => (
          <button key={id} onClick={()=>onChange(id)} style={{ fontSize:11, padding:"4px 9px", borderRadius:6, cursor:"pointer", fontFamily:"-apple-system,sans-serif", border:`0.5px solid ${value===id?col:"#e5e5e3"}`, background:value===id?`${col}15`:"transparent", color:value===id?col:"#5c5c5a", fontWeight:value===id?500:400 }}>{m.name}</button>
        ))}
      </div>
    </div>
  );
}

function GenButton({ onClick, job, label, col, note }) {
  const isLoading = job && job.status !== "done" && job.status !== "error";
  const isError   = job?.status === "error";
  return (
    <div>
      {note && !job && <div style={{ fontSize:10, color:"#9b9b99", marginBottom:5, fontStyle:"italic" }}>{note}</div>}
      <button onClick={onClick} disabled={isLoading} style={{ width:"100%", padding:"8px 12px", borderRadius:8, border:"none", background:isError?"#FAECE7":isLoading?"#f0f0f0":col, color:isError?"#D85A30":isLoading?"#9b9b99":"#fff", fontSize:12, fontWeight:500, cursor:isLoading?"default":"pointer", fontFamily:"-apple-system,sans-serif", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
        {isLoading && <Dots />}
        {isError ? `Fehler: ${job.error}` : isLoading ? job.status : label}
      </button>
    </div>
  );
}

function Dots() {
  return (
    <span style={{ display:"flex", gap:3 }}>
      <style>{`@keyframes blink{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      {[0,0.3,0.6].map((d,i) => <span key={i} style={{ width:4, height:4, borderRadius:"50%", background:"#9b9b99", animation:`blink 1.2s ${d}s ease infinite`, display:"inline-block" }} />)}
    </span>
  );
}

function Spinner({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", gap:14, fontFamily:"-apple-system,sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontSize:22, animation:"spin 1.4s linear infinite", color:"#9b9b99" }}>◎</div>
      <div style={{ fontSize:12, color:"#9b9b99" }}>{msg}</div>
    </div>
  );
}

function ErrorScreen({ msg }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", gap:12, fontFamily:"-apple-system,sans-serif" }}>
      <div style={{ fontSize:13, color:"#D85A30", background:"#FAECE7", padding:"12px 16px", borderRadius:10, maxWidth:400, textAlign:"center" }}>{msg}</div>
    </div>
  );
}