# AI Video Framework

Tool-agnostisches AI Video Production Framework für Teams.  
Stack: React + Vite · Vercel (Hosting + API Proxy) · Supabase (Datenbank)

---

## Setup in ~15 Minuten

### 1. Supabase einrichten

1. Öffne [supabase.com](https://supabase.com) → dein Projekt (oder neues anlegen)
2. Gehe zu **SQL Editor** → **New Query**
3. Kopiere den Inhalt von `supabase-schema.sql` und führe ihn aus (**Run**)
4. Gehe zu **Project Settings → API**
5. Notiere:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / public key** → `VITE_SUPABASE_ANON_KEY`

### 2. Anthropic API Key

1. Öffne [console.anthropic.com](https://console.anthropic.com)
2. API Keys → **Create Key**
3. Notiere den Key → `ANTHROPIC_API_KEY`

### 3. GitHub Repo anlegen

```bash
# Im Projektordner:
git init
git add .
git commit -m "initial commit"
# Dann auf github.com ein neues Repo anlegen und:
git remote add origin https://github.com/DEIN-NAME/ai-video-framework.git
git push -u origin main
```

### 4. Vercel deployen

1. Öffne [vercel.com](https://vercel.com) → **Add New Project**
2. GitHub Repo importieren
3. Framework: **Vite** (wird automatisch erkannt)
4. **Environment Variables** hinzufügen:

| Name | Wert | Environment |
|------|------|-------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Production, Preview |
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Production, Preview |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Production, Preview |

5. **Deploy** klicken

Nach ~1 Minute hat dein Team eine URL wie `https://ai-video-framework.vercel.app`

---

## Lokale Entwicklung

```bash
npm install

# .env anlegen (aus .env.example kopieren):
cp .env.example .env
# .env mit deinen Werten befüllen

npm run dev
```

⚠️ Lokal laufen die Vercel API-Routes nicht automatisch.  
Installiere dafür: `npm install -g vercel` und starte mit `vercel dev` statt `npm run dev`.

---

## Architektur

```
Browser (React/Vite)
    ↓ /api/claude
Vercel Serverless Function (api/claude.js)
    ↓ ANTHROPIC_API_KEY
Anthropic API

Browser
    ↓ Supabase JS Client (anon key)
Supabase (PostgreSQL)
    brands + projects Tabellen
```

**Warum ein Backend-Proxy?**  
Der Anthropic API Key darf nie im Browser-Code landen. Die Vercel Function hält ihn sicher als Server-side Environment Variable.

**Warum Supabase statt localStorage?**  
Alle Team-Mitglieder teilen dieselben Brands und Projekte in Echtzeit.  
Per-User Präferenzen (Richtungs-Fragen Toggle, letztes Projekt) bleiben im localStorage.

---

## Team-Zugang

Alle mit der Vercel-URL können das Tool nutzen — kein Login erforderlich.  
Für Passwort-Schutz: Vercel → Deployment → **Password Protection** aktivieren.

Für rollenbasierte Zugangskontrolle kann später Supabase Auth eingebaut werden.

---

## Projektstruktur

```
ai-video-framework/
├── api/
│   └── claude.js          # Vercel API Route (Anthropic Proxy)
├── src/
│   ├── lib/
│   │   └── supabase.js    # Supabase Client
│   ├── App.jsx            # Gesamte App (Logik + UI)
│   └── main.jsx           # React Entry Point
├── index.html
├── vite.config.js
├── package.json
├── supabase-schema.sql    # DB Schema (einmalig ausführen)
├── .env.example
└── README.md
```
