"use strict";
// Externes AI-Scan-Fenster: Screenshot → Library-Wort (mehrsprachig) →
// Klick per Koordinaten → prüfen ob man in der Bibliothek sitzt → scrollen
// → alles eintragen. Bei Fehler: Code + Launcher-Name automatisch an Vystra.

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const LIB_WORDS = [
  "bibliothek", "library", "libreria", "librería", "biblioteca", "bibliothèque",
  "biblioteka", "bibliotek", "kirjasto", "könyvtár", "konyvtar",
  "библиотека", "бібліотека", "kütüphane", "kutuphane",
  "ライブラリ", "ライブラリー", "游戏库", "遊戲庫", "库", "庫", "라이브러리",
  "mediathek", "spielbibliothek", "game library", "my games", "meine spiele",
  "mes jeux", "mis juegos", "giochi", "ludothèque", "ludotheque",
  "collection", "sammlung", "games"
];

const ERRORS = {
  E01: "Launcher nicht gefunden / startet nicht",
  E02: "Screenshot fehlgeschlagen",
  E03: "Library-Wort nicht gefunden",
  E04: "Klick hat die Bibliothek nicht getroffen",
  E05: "Bereichsklick ohne Spiel hat nicht geholfen",
  E06: "Scroll funktioniert nicht",
  E07: "OCR nicht verfügbar",
  E08: "Fenster der Dritt-App nicht sichtbar"
};

const TARGETS = [
  { id: "steam", name: "Steam", title: "Steam", protocol: "steam://open/games" },
  { id: "epic", name: "Epic Games", title: "Epic Games", protocol: "com.epicgames.launcher://apps" },
  { id: "itch", name: "itch.io", title: "itch", protocol: null }
];

let deps = null;
let scanWin = null;
let running = false;

function findItchExe() {
  const roots = [
    path.join(process.env.LOCALAPPDATA || "", "itch"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "itch")
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const direct = path.join(root, "itch.exe");
    if (fs.existsSync(direct)) return direct;
    try {
      for (const ent of fs.readdirSync(root)) {
        if (!/^app-/i.test(ent)) continue;
        const p = path.join(root, ent, "itch.exe");
        if (fs.existsSync(p)) return p;
      }
    } catch {}
  }
  return null;
}

function emit(payload) {
  try {
    if (scanWin && !scanWin.isDestroyed()) scanWin.webContents.send("ai-scan:event", payload);
  } catch {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function tmpPng(tag) {
  return path.join(os.tmpdir(), "vystra-aiscan-" + tag + "-" + Date.now() + ".png");
}

function runPs(args, timeoutMs) {
  const script = path.join(__dirname, "win.ps1");
  const argv = ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script].concat(args);
  return new Promise(resolve => {
    execFile("powershell.exe", argv, {
      timeout: timeoutMs || 25000,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024
    }, (err, stdout) => {
      let data = null;
      try { data = JSON.parse(String(stdout || "").trim().split("\n").pop()); } catch {}
      resolve({ ok: !err && !!(data && data.ok !== false), data, raw: String(stdout || ""), err });
    });
  });
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
}

function isLibWord(text) {
  const n = norm(text);
  if (!n) return false;
  return LIB_WORDS.some(w => n === w || n.includes(w) || w.includes(n));
}

function fileToDataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    return "data:image/png;base64," + buf.toString("base64");
  } catch {
    return "";
  }
}

function pixelDiff(a, b) {
  try {
    const A = fs.readFileSync(a);
    const B = fs.readFileSync(b);
    if (A.length !== B.length) return 1;
    let d = 0;
    const step = Math.max(1, Math.floor(A.length / 4000));
    let n = 0;
    for (let i = 0; i < A.length; i += step) {
      n++;
      if (A[i] !== B[i]) d++;
    }
    return n ? d / n : 1;
  } catch {
    return 0;
  }
}

function findLibHits(words) {
  const hits = [];
  for (const w of words || []) {
    if (isLibWord(w.text)) hits.push(w);
  }
  return hits;
}

function sidebarGuess(win) {
  return {
    x: win.x + Math.round(Math.min(120, win.w * 0.09)),
    y: win.y + Math.round(win.h * 0.20),
    w: 80,
    h: 22,
    text: "(sidebar-guess)"
  };
}

function contentSafeClick(win) {
  // Rechts neben der Sidebar, Mitte — nicht auf die erste Spielzeile oben.
  return {
    x: win.x + Math.round(win.w * 0.62),
    y: win.y + Math.round(win.h * 0.42)
  };
}

async function shotWindow(win, tag) {
  const file = tmpPng(tag);
  const r = await runPs(["-Action", "shot", "-X", String(win.x), "-Y", String(win.y), "-W", String(win.w), "-H", String(win.h), "-Path", file]);
  if (!r.ok || !fs.existsSync(file)) return null;
  return file;
}

async function ocrFile(file) {
  const r = await runPs(["-Action", "ocr", "-Path", file], 40000);
  if (!r.ok || !r.data) return { ok: false, words: [], text: "" };
  return { ok: true, words: r.data.words || [], text: r.data.text || "" };
}

function persistError(entry) {
  try {
    const dir = deps.app.getPath("userData");
    const file = path.join(dir, "ai-scan-errors.json");
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    if (!Array.isArray(arr)) arr = [];
    arr.unshift(entry);
    fs.writeFileSync(file, JSON.stringify(arr.slice(0, 80), null, 2), "utf8");
  } catch {}
}

async function reportError(launcher, code, detail) {
  const message = ERRORS[code] || "Unbekannter Fehler";
  const entry = {
    ok: false,
    type: "ai-scan-error",
    launcher: launcher && launcher.name || "unbekannt",
    launcherId: launcher && launcher.id || "",
    code: "VY-AISCAN-" + code,
    message,
    detail: String(detail || "").slice(0, 800),
    launcherVersion: deps.app.getVersion(),
    os: process.platform,
    at: new Date().toISOString()
  };
  persistError(entry);
  let sent = false;
  try {
    const s = deps.loadSettings();
    const base = String(s.apiBaseUrl || "https://api.vis-code.com").replace(/\/$/, "");
    const body = JSON.stringify(entry);
    const headers = {
      "Content-Type": "application/json",
      "X-Launcher-Version": deps.app.getVersion(),
      "X-Vystra-Device": "pc"
    };
    const dedicated = await fetch(base + "/api/launcher/ai-scan-error", {
      method: "POST",
      headers,
      body
    }).catch(() => null);
    if (dedicated && dedicated.ok) sent = true;
    if (!sent) {
      const fb = await deps.socialApi("POST", "/api/feedback", {
        rating: 1,
        comment: "[AI-SCAN " + entry.code + "] " + entry.launcher + " — " + message + " — " + entry.detail,
        type: "ai-scan-error"
      }).catch(() => null);
      if (fb && fb.ok) sent = true;
    }
  } catch {}
  entry.sent = sent;
  emit({ type: "error", ...entry, text: "Leider nicht möglich. " + entry.code + " · " + entry.launcher + (sent ? " · an Vystra gesendet" : " · lokal gespeichert, Sendung fehlgeschlagen") });
  return entry;
}

async function openTarget(t) {
  if (t.id === "steam") {
    const steam = await deps.findSteamPath();
    if (!steam) return false;
    deps.spawn(path.join(steam, "steam.exe"), [], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => { deps.shell.openExternal(t.protocol).catch(() => {}); }, 1200);
    return true;
  }
  if (t.id === "epic") {
    const exe = await deps.findEpicLauncherExe();
    if (!exe) return false;
    deps.spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => { deps.shell.openExternal(t.protocol).catch(() => {}); }, 1200);
    return true;
  }
  if (t.id === "itch") {
    const exe = findItchExe();
    if (!exe) return false;
    deps.spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  return false;
}

async function waitWindow(t) {
  for (let i = 0; i < 18; i++) {
    const r = await runPs(["-Action", "focus", "-TitleMatch", t.title]);
    if (r.ok && r.data && r.data.w) return r.data;
    await sleep(700);
  }
  return null;
}

async function processImage(file, win, label, extra) {
  const ocr = await ocrFile(file);
  const hits = findLibHits(ocr.words);
  emit({
    type: "image",
    label,
    dataUrl: fileToDataUrl(file),
    win,
    words: ocr.words,
    hits,
    ocrOk: ocr.ok,
    ocrText: (ocr.text || "").slice(0, 400),
    ...(extra || {})
  });
  return { ocr, hits };
}

async function clickHit(win, hit) {
  const cx = win.x + Math.round(hit.x + (hit.w || 20) / 2);
  const cy = win.y + Math.round(hit.y + (hit.h || 16) / 2);
  emit({ type: "step", phase: "click", text: "Klick auf „" + (hit.text || "Library") + "“ bei " + cx + "," + cy });
  await runPs(["-Action", "click", "-X", String(cx), "-Y", String(cy)]);
  return { x: cx, y: cy };
}

async function tryScroll(win) {
  const p = contentSafeClick(win);
  const before = await shotWindow(win, "pre-scroll");
  await runPs(["-Action", "scroll", "-X", String(p.x), "-Y", String(p.y), "-Delta", "-900"]);
  await sleep(450);
  const after = await shotWindow(win, "post-scroll");
  if (!before || !after) return { ok: false, before, after };
  const diff = pixelDiff(before, after);
  const ok = diff > 0.012;
  emit({
    type: "step",
    phase: "scroll",
    text: ok ? "Scroll bewegt die Ansicht (" + Math.round(diff * 100) + " % geändert)." : "Scroll hat nichts bewegt.",
    diff
  });
  if (after) {
    await processImage(after, win, "nach Scroll", { click: p });
  }
  return { ok, before, after, diff };
}

async function collectGames(t) {
  try {
    const all = await deps.launcherScan.scanAll({});
    const block = (all.launchers || []).find(l => l && l.id === t.id);
    const games = (block && block.games) || [];
    emit({ type: "games", launcher: t, games, count: games.length });
    return games;
  } catch {
    emit({ type: "games", launcher: t, games: [], count: 0 });
    return [];
  }
}

async function runOne(t) {
  emit({ type: "step", phase: "start", text: t.name + " starten …", launcher: t });
  const started = await openTarget(t);
  if (!started) {
    await reportError(t, "E01", "exe/pfad fehlt");
    return;
  }
  await sleep(1600);
  const win = await waitWindow(t);
  if (!win) {
    await reportError(t, "E08", "kein Fenster mit Titel " + t.title);
    return;
  }
  emit({ type: "step", phase: "window", text: "Fenster: " + win.title + " · " + win.w + "×" + win.h, win });

  const img1 = await shotWindow(win, "bild1");
  if (!img1) {
    await reportError(t, "E02", "bild 1");
    return;
  }
  emit({ type: "step", phase: "image1", text: "Bild 1 wird verarbeitet (OCR + Koordinatensystem) …" });
  let { ocr, hits } = await processImage(img1, win, "Bild 1");
  if (!ocr.ok && !hits.length) {
    await reportError(t, "E07", "Windows-OCR");
    hits = [sidebarGuess(win)];
    emit({ type: "step", phase: "guess", text: "OCR fehlt — klicke den Sidebar-Bereich (Library-Verdacht)." });
  } else if (!hits.length) {
    await reportError(t, "E03", (ocr.text || "").slice(0, 200));
    hits = [sidebarGuess(win)];
    emit({ type: "step", phase: "guess", text: "Kein Library-Wort — Sidebar-Klick als Fallback." });
  }

  await clickHit(win, hits[0]);
  await sleep(700);
  await runPs(["-Action", "focus", "-TitleMatch", t.title]);
  const img2 = await shotWindow(win, "bild2");
  if (!img2) {
    await reportError(t, "E02", "bild 2");
    return;
  }
  const second = await processImage(img2, win, "Nach Library-Klick", { click: hits[0] });
  const onLib = second.hits.length > 0 || /library|bibliothek|games|spiele|giochi|jeux/i.test(second.ocr.text || "");

  if (onLib) {
    emit({ type: "step", phase: "onlib", text: "Ja — sitzt in der Bibliothek. Scrolle und trage ein." });
    const sc = await tryScroll(win);
    if (!sc.ok) {
      await reportError(t, "E06", "diff=" + (sc.diff || 0));
      return;
    }
    emit({ type: "step", phase: "scan", text: "Scroll ok — trage alle lokalen Spiele von " + t.name + " ein." });
    await collectGames(t);
    return;
  }

  emit({ type: "step", phase: "miss", text: "Nicht in der Bibliothek. Klick in den Bereich, nicht auf ein Spiel." });
  const safe = contentSafeClick(win);
  await runPs(["-Action", "click", "-X", String(safe.x), "-Y", String(safe.y)]);
  emit({ type: "step", phase: "click", text: "Bereichsklick bei " + safe.x + "," + safe.y });
  await sleep(500);
  const img3 = await shotWindow(win, "bild3");
  if (img3) await processImage(img3, win, "Nach Bereichsklick", { click: safe });
  const sc2 = await tryScroll(win);
  if (sc2.ok) {
    emit({ type: "step", phase: "scan", text: "Scroll geht — scanne " + t.name + "." });
    await collectGames(t);
    return;
  }
  await reportError(t, "E05", "Bereichsklick + Scroll gescheitert");
}

async function runAll() {
  if (running) return;
  running = true;
  emit({ type: "step", phase: "boot", text: "AI-Scan startet. Nur Dritt-Launcher, nicht die Vystra-Bibliothek." });
  try {
    for (const t of TARGETS) {
      if (!running) break;
      await runOne(t);
    }
    emit({ type: "done", text: "Durchlauf fertig." });
  } catch (e) {
    emit({ type: "step", phase: "crash", text: String(e && e.message || e) });
  }
  running = false;
}

function openWindow() {
  if (scanWin && !scanWin.isDestroyed()) {
    scanWin.show();
    scanWin.focus();
    return scanWin;
  }
  const { BrowserWindow } = deps;
  scanWin = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: "Vystra AI-Scan",
    autoHideMenuBar: true,
    backgroundColor: "#0b0d14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  scanWin.loadFile(path.join(__dirname, "window.html"));
  scanWin.on("closed", () => { scanWin = null; running = false; });
  return scanWin;
}

function register(d) {
  deps = d;
  d.ipcMain.handle("ai-scan:open", () => {
    openWindow();
    return { ok: true };
  });
  d.ipcMain.handle("ai-scan:start", async () => {
    openWindow();
    setTimeout(() => { runAll().catch(() => {}); }, 400);
    return { ok: true };
  });
  d.ipcMain.handle("ai-scan:stop", () => {
    running = false;
    emit({ type: "step", phase: "stop", text: "Gestoppt." });
    return { ok: true };
  });
}

function openAndStart() {
  openWindow();
  setTimeout(() => { runAll().catch(() => {}); }, 800);
}

module.exports = { register, openAndStart, openWindow };
