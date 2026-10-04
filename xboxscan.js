/**
 * Vystra Launcher — public review source
 * Copyright (c) 2026 Stefan Reibnegger (Vystra)
 * Author: Stefan Reibnegger
 * License: Polyform Noncommercial 1.0.0 — commercial use is forbidden.
 * Official binaries: https://github.com/Stefan2010byte/viscode-launcher
 * This copy has Vystra server APIs and the Vystra shop backend removed.
 */
"use strict";
// Xbox-Scanner: Abo-Status, Game-Pass-Katalog, Bibliothek aus der Xbox-App
// (UI Automation, Vision-KI als Ersatz) und das Zusammenfuehren aller Quellen.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const SIGL_PC_GAMEPASS = "fdd9e2a7-0fee-49f6-ad69-4354098401ff";
const GAMEPASS_TTL_MS = 12 * 60 * 60 * 1000;
const STANDARD_VISION_MODELL = "qwen2.5vl:3b";

// Reihenfolge zaehlt: die hoechste Stufe zuerst, sonst gewinnt "Game Pass" vor "Ultimate".
const ABO_STUFEN = [
  { id: "ultimate", name: "Game Pass Ultimate", re: /Game\s*Pass\s*Ultimate/i, pcKatalog: true },
  { id: "pc", name: "PC Game Pass", re: /PC\s*Game\s*Pass/i, pcKatalog: true },
  { id: "premium", name: "Game Pass Premium", re: /Game\s*Pass\s*Premium/i, pcKatalog: false },
  { id: "standard", name: "Game Pass Standard", re: /Game\s*Pass\s*Standard/i, pcKatalog: false },
  { id: "essential", name: "Game Pass Essential", re: /Game\s*Pass\s*Essential/i, pcKatalog: false },
  { id: "core", name: "Game Pass Core", re: /Game\s*Pass\s*Core/i, pcKatalog: false },
  { id: "gold", name: "Xbox Live Gold", re: /Xbox\s*Live\s*Gold/i, pcKatalog: false }
];
const INAKTIV_RE = /(abgelaufen|expired|beendet|gek[uü]ndigt|canceled|cancelled|inaktiv|inactive)/i;

function normTitel(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/\((spielvorschau|game preview|pc|windows|xbox series x\|s)\)/g, "")
    .replace(/[^a-z0-9äöüß]+/g, "");
}

function bildUrl(images, ...zwecke) {
  for (const z of zwecke) {
    const im = (images || []).find(i => String(i.ImagePurpose || "").toLowerCase() === z.toLowerCase());
    if (im && im.Uri) {
      return im.Uri.startsWith("//") ? "https:" + im.Uri : im.Uri;
    }
  }
  return null;
}

module.exports = function erstelleXboxScanner({ fetchJson, app, BrowserWindow, loadSettings, saveSettings }) {
  const datenDir = () => app.getPath("userData");
  const gamepassDatei = () => path.join(datenDir(), "xbox-gamepass.json");
  const bibliothekDatei = () => path.join(datenDir(), "xbox-bibliothek.json");
  const skriptPfad = () => {
    const kandidaten = [
      path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, "app.asar.unpacked"), "tools", "xbox-bibliothek.ps1"),
      path.join(__dirname, "tools", "xbox-bibliothek.ps1")
    ];
    return kandidaten.find(p => fs.existsSync(p)) || kandidaten[0];
  };

  function lesen(datei) {
    try {
      return JSON.parse(fs.readFileSync(datei, "utf8"));
    } catch {
      return null;
    }
  }
  function schreiben(datei, daten) {
    try {
      fs.writeFileSync(datei, JSON.stringify(daten));
    } catch {}
  }

  // ── Game-Pass-Katalog (oeffentlich, ohne Login) ────────────────────────────
  async function gamePassKatalog(neu = false) {
    const cache = lesen(gamepassDatei());
    if (!neu && cache && Array.isArray(cache.spiele) && Date.now() - cache.ts < GAMEPASS_TTL_MS) {
      return { ok: true, spiele: cache.spiele, ts: cache.ts, cache: true };
    }
    const liste = await fetchJson("https://catalog.gamepass.com/sigls/v2?id=" + SIGL_PC_GAMEPASS + "&language=de-de&market=AT", {}, 15000);
    const ids = (Array.isArray(liste) ? liste : []).map(e => e && e.id).filter(Boolean);
    if (!ids.length) {
      return cache && cache.spiele ? { ok: true, spiele: cache.spiele, ts: cache.ts, cache: true } : { ok: false, error: "Game-Pass-Liste nicht erreichbar", spiele: [] };
    }
    const spiele = [];
    for (let i = 0; i < ids.length; i += 20) {
      const teil = ids.slice(i, i + 20).join(",");
      const d = await fetchJson("https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=" + teil + "&market=AT&languages=de-DE&fieldsTemplate=Details", { headers: { Accept: "application/json" } }, 15000);
      for (const p of (d && d.Products) || []) {
        const lp = (p.LocalizedProperties || [])[0] || {};
        if (!lp.ProductTitle) continue;
        spiele.push({
          productId: p.ProductId,
          title: lp.ProductTitle,
          image: bildUrl(lp.Images, "Poster", "BoxArt", "BrandedKeyArt"),
          bannerImage: bildUrl(lp.Images, "SuperHeroArt", "TitledHeroArt"),
          logo: bildUrl(lp.Images, "Logo")
        });
      }
    }
    const ergebnis = { ts: Date.now(), spiele };
    schreiben(gamepassDatei(), ergebnis);
    return { ok: true, spiele, ts: ergebnis.ts, cache: false };
  }

  // ── Abo-Status ueber account.microsoft.com (Sitzung vom Xbox-Login) ───────
  function aboStatus({ sichtbar = false } = {}) {
    return new Promise(resolve => {
      let fertig = false;
      const win = new BrowserWindow({
        show: !!sichtbar,
        width: 1040,
        height: 780,
        title: "Microsoft-Konto – Abo prüfen",
        autoHideMenuBar: true,
        webPreferences: { partition: "persist:xboxlogin", contextIsolation: true, nodeIntegration: false }
      });
      const ende = erg => {
        if (fertig) return;
        fertig = true;
        clearInterval(timer);
        try {
          if (!win.isDestroyed()) win.close();
        } catch {}
        if (erg.ok) {
          const s = loadSettings();
          s.xboxAbo = { stufe: erg.stufe, name: erg.name, aktiv: erg.aktiv, pcKatalog: erg.pcKatalog, ts: Date.now() };
          saveSettings(s);
        }
        resolve(erg);
      };
      const start = Date.now();
      const maxMs = sichtbar ? 300000 : 35000;
      let letzteLaenge = -1;
      let stabil = 0;
      const timer = setInterval(async () => {
        if (fertig || win.isDestroyed()) return;
        const url = win.webContents.getURL();
        if (/login\.(live|microsoftonline)\.com/i.test(url) && !sichtbar) {
          return ende({ ok: false, needsLogin: true, error: "Microsoft-Anmeldung nötig" });
        }
        if (Date.now() - start > maxMs) {
          return ende({ ok: false, error: "Zeitüberschreitung beim Lesen der Abo-Seite" });
        }
        if (!/account\.microsoft\.com/i.test(url)) return;
        let text = "";
        try {
          text = await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true);
        } catch {
          return;
        }
        for (const st of ABO_STUFEN) {
          const m = st.re.exec(text);
          if (m) {
            const umfeld = text.slice(m.index, m.index + 260);
            const aktiv = !INAKTIV_RE.test(umfeld);
            return ende({ ok: true, stufe: st.id, name: st.name, aktiv, pcKatalog: st.pcKatalog && aktiv });
          }
        }
        // Seite fertig geladen und kein Abo im Text: als "kein Abo" werten.
        if (text.length > 400 && text.length === letzteLaenge) {
          stabil++;
        } else {
          stabil = 0;
        }
        letzteLaenge = text.length;
        if (stabil >= 3) {
          return ende({ ok: true, stufe: null, name: "Kein Game Pass", aktiv: false, pcKatalog: false });
        }
      }, 1500);
      win.on("closed", () => ende({ ok: false, canceled: true, error: "Fenster geschlossen" }));
      win.loadURL("https://account.microsoft.com/services?lang=de-DE").catch(() => {});
    });
  }

  // ── Xbox-App auslesen ─────────────────────────────────────────────────────
  function skriptAusfuehren(args, timeoutMs) {
    return new Promise(resolve => {
      const skript = skriptPfad();
      if (!fs.existsSync(skript)) {
        return resolve({ ok: false, error: "xbox-bibliothek.ps1 fehlt" });
      }
      execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", skript, ...args], { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (err, stdout) => {
        const zeile = String(stdout || "").split(/\r?\n/).reverse().find(z => z.trim().startsWith("{"));
        if (!zeile) {
          return resolve({ ok: false, error: err ? err.message : "keine Antwort vom Xbox-Scan" });
        }
        try {
          const d = JSON.parse(zeile);
          if (d.fehler && !d.error) d.error = d.fehler;
          resolve(d);
        } catch (e) {
          resolve({ ok: false, error: "Antwort unlesbar: " + e.message });
        }
      });
    });
  }

  function titelBereinigen(liste) {
    const out = [];
    const gesehen = new Set();
    for (let t of liste || []) {
      t = String(t || "")
        .replace(/^[\s\-*•\d.)]+/, "")
        .replace(/,\s*(installiert|installed|game pass|cloud|update verfügbar|update available|bereit|ready).*$/i, "")
        .trim();
      if (t.length < 2 || t.length > 100) continue;
      const k = normTitel(t);
      if (!k || gesehen.has(k)) continue;
      gesehen.add(k);
      out.push(t);
    }
    return out;
  }

  async function ollamaModelle(basis) {
    const d = await fetchJson(basis + "/api/tags", {}, 5000);
    return d && Array.isArray(d.models) ? d.models.map(m => m.name) : null;
  }

  function visionKonfig() {
    const s = loadSettings();
    return {
      basis: (s.llamaUrl || "http://127.0.0.1:11434").replace(/\/$/, ""),
      modell: s.xboxVisionModel || STANDARD_VISION_MODELL
    };
  }

  async function kiStatus() {
    const { basis, modell } = visionKonfig();
    const modelle = await ollamaModelle(basis);
    if (!modelle) return { ok: false, ollama: false, modell, error: "Ollama läuft nicht" };
    const da = modelle.some(m => m === modell || m === modell + ":latest" || m.split(":")[0] === modell);
    return { ok: da, ollama: true, modell, vorhanden: da, error: da ? null : "Vision-Modell fehlt" };
  }

  async function kiModellLaden() {
    const { basis, modell } = visionKonfig();
    try {
      const r = await fetch(basis + "/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modell, stream: false }),
        signal: AbortSignal.timeout(60 * 60 * 1000)
      });
      const d = await r.json().catch(() => null);
      return { ok: r.ok && d && d.status === "success", modell, error: r.ok ? null : "Ollama " + r.status };
    } catch (e) {
      return { ok: false, modell, error: e.message };
    }
  }

  async function kiScan() {
    const st = await kiStatus();
    if (!st.ok) return { ok: false, quelle: "ki", error: st.error, modell: st.modell, modellFehlt: st.ollama && !st.vorhanden };
    const dir = path.join(os.tmpdir(), "vystra-xbox-shots-" + Date.now());
    const r = await skriptAusfuehren(["-Mode", "shots", "-OutDir", dir, "-MaxPages", "15"], 180000);
    if (!r.ok || !Array.isArray(r.shots) || !r.shots.length) {
      return { ok: false, quelle: "ki", error: r.error || "Keine Screenshots der Xbox-App" };
    }
    const { basis, modell } = visionKonfig();
    const prompt = "Das ist ein Screenshot der Xbox-App unter Windows, Bereich Bibliothek. Liste ALLE Spieletitel, die als Kachel oder Listeneintrag sichtbar sind, exakt so geschrieben wie im Bild. Ein Titel pro Zeile, ohne Nummerierung und ohne weiteren Text. Keine Menüpunkte, Knöpfe, Filter oder Überschriften.";
    const titel = [];
    for (const f of r.shots) {
      try {
        const bild = fs.readFileSync(f).toString("base64");
        const d = await fetchJson(basis + "/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modell, prompt, images: [bild], stream: false, options: { temperature: 0 } })
        }, 120000);
        const text = d && d.response ? String(d.response) : "";
        titel.push(...text.split(/\r?\n/));
      } catch {}
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    const sauber = titelBereinigen(titel);
    return { ok: sauber.length > 0, quelle: "ki", titel: sauber, seiten: r.shots.length, error: sauber.length ? null : "KI hat keine Titel erkannt" };
  }

  async function appScan({ ki = true } = {}) {
    const r = await skriptAusfuehren(["-Mode", "uia", "-MaxPages", "30"], 150000);
    let ergebnis = null;
    if (r.ok) {
      const titel = titelBereinigen(r.titel);
      ergebnis = { ok: titel.length > 0, quelle: "uia", titel, navigiert: r.navigiert, navLabel: r.navLabel, roh: (r.roh || []).slice(0, 300) };
    } else {
      ergebnis = { ok: false, quelle: "uia", error: r.error };
    }
    // Weniger als 3 Treffer heisst meist: die Liste ist nicht per UIA lesbar.
    if (ki && (!ergebnis.ok || ergebnis.titel.length < 3)) {
      const k = await kiScan();
      if (k.ok) {
        ergebnis = { ...k, uiaFehler: ergebnis.error || null };
      } else {
        ergebnis.kiFehler = k.error;
        ergebnis.modellFehlt = !!k.modellFehlt;
      }
    }
    if (ergebnis.ok) {
      schreiben(bibliothekDatei(), { ts: Date.now(), quelle: ergebnis.quelle, titel: ergebnis.titel });
    }
    return ergebnis;
  }

  // ── Alles zusammenfuehren ────────────────────────────────────────────────
  // gespielt: titlehub-Eintraege, installiert: lokale Scans (beide von main.js).
  async function bibliothekKomplett({ gespielt = [], installiert = [] } = {}) {
    const s = loadSettings();
    const abo = s.xboxAbo || null;
    const app_ = lesen(bibliothekDatei());
    const gp = await gamePassKatalog().catch(() => ({ ok: false, spiele: [] }));
    const gpMap = new Map((gp.spiele || []).map(g => [normTitel(g.title), g]));
    const instSet = new Set((installiert || []).map(g => normTitel(g.title || g.name)));
    const map = new Map();
    const eintrag = (titel, felder) => {
      const k = normTitel(titel);
      if (!k) return null;
      let e = map.get(k);
      if (!e) {
        const gpTreffer = gpMap.get(k);
        e = {
          platform: "xbox",
          id: gpTreffer ? gpTreffer.productId : "xbox-" + k,
          title: titel,
          image: gpTreffer ? gpTreffer.image : null,
          bannerImage: gpTreffer ? gpTreffer.bannerImage : null,
          productId: gpTreffer ? gpTreffer.productId : null,
          installPath: null,
          owned: true,
          gekauft: false,
          gespielt: false,
          imAbo: !!gpTreffer && !!(abo && abo.pcKatalog),
          installiert: instSet.has(k),
          quellen: []
        };
        map.set(k, e);
      }
      Object.assign(e, Object.fromEntries(Object.entries(felder).filter(([, v]) => v !== undefined && v !== null)));
      return e;
    };
    for (const g of gespielt) {
      const e = eintrag(g.title, { lastPlayed: g.lastPlayed, titleId: g.id, gespielt: true });
      if (e) {
        if (!e.image && g.image) e.image = g.image;
        e.quellen.push("verlauf");
      }
    }
    for (const t of (app_ && app_.titel) || []) {
      const e = eintrag(t, {});
      if (e) {
        e.quellen.push("xbox-app");
        // In der Xbox-App gelistet und nicht im Abo-Katalog -> gekauft.
        if (!e.imAbo) e.gekauft = true;
      }
    }
    const besitz = [...map.values()];
    const aboSpiele = abo && abo.pcKatalog ? (gp.spiele || []).filter(g => !map.has(normTitel(g.title))).map(g => ({
      platform: "xbox",
      id: g.productId,
      productId: g.productId,
      title: g.title,
      image: g.image,
      bannerImage: g.bannerImage,
      installPath: null,
      owned: false,
      imAbo: true,
      installiert: instSet.has(normTitel(g.title)),
      quellen: ["gamepass"]
    })) : [];
    return {
      ok: true,
      abo,
      appScan: app_ ? { ts: app_.ts, quelle: app_.quelle, anzahl: (app_.titel || []).length } : null,
      gamePassAnzahl: (gp.spiele || []).length,
      games: besitz.sort((a, b) => a.title.localeCompare(b.title, "de")),
      aboGames: aboSpiele.sort((a, b) => a.title.localeCompare(b.title, "de"))
    };
  }

  return { gamePassKatalog, aboStatus, appScan, kiScan, kiStatus, kiModellLaden, bibliothekKomplett, normTitel };
};
