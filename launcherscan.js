/**
 * Vystra Launcher — public review source
 * Copyright (c) 2026 Stefan Reibnegger (Vystra)
 * Author: Stefan Reibnegger
 * License: Polyform Noncommercial 1.0.0 — commercial use is forbidden.
 * Official binaries: https://github.com/Stefan2010byte/viscode-launcher
 * This copy has Vystra server APIs and the Vystra shop backend removed.
 */
// launcherscan.js
// Grüner, rein LOKALER Multi-Launcher-Scanner für den Vystra Launcher.
// - Liest ausschließlich lokale Dateien + Registry (reg query). KEINE Netzwerkaufrufe,
//   KEINE Zugangsdaten, KEIN IPC-Sniffing, KEINE Prozess-Injektion.
// - Reine Node-Funktionen (keine Electron-Abhängigkeit) => per `node` testbar.
// - Jeder Adapter ist defensiv: ein Fehler ergibt installed:false, wirft NIE.
//
// Ergebnis-Shape (Phase 1):
// { ok:true, scannedAt, launchers:[
//    { id, name, installed, account:{name,id}|null,
//      games:[ { id, name, installDir, launchUri } ] } ] }

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const IS_WIN = process.platform === "win32";

// ── kleine Helfer ────────────────────────────────────────────────────────────

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

// Registry-Einzelwert lesen (nur Windows). Gibt String oder null.
function regQuery(key, value) {
  if (!IS_WIN) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      execFile("reg", ["query", key, "/v", value], { windowsHide: true }, (err, out) => {
        if (err || !out) return resolve(null);
        const m = out.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
        resolve(m ? m[1].trim() : null);
      });
    } catch {
      resolve(null);
    }
  });
}

// Registry-Teilbaum lesen (reg query /s). Gibt Liste von { key, name, values }.
function regQueryTree(key) {
  if (!IS_WIN) return Promise.resolve([]);
  return new Promise(resolve => {
    try {
      execFile("reg", ["query", key, "/s"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        if (err || !out) return resolve([]);
        const blocks = [];
        let cur = null;
        for (const line of String(out).split(/\r?\n/)) {
          if (/^HKEY_/i.test(line)) {
            const k = line.trim();
            cur = { key: k, name: k.split("\\").pop(), values: {} };
            blocks.push(cur);
            continue;
          }
          const tr = line.match(/^\s+(.+?)\s{2,}REG_(?:SZ|EXPAND_SZ|MULTI_SZ|DWORD|QWORD|BINARY|NONE)\s{2,}(.*)$/);
          if (tr && cur) cur.values[tr[1].trim()] = tr[2].trim();
        }
        resolve(blocks);
      });
    } catch {
      resolve([]);
    }
  });
}

// PowerShell best-effort (nur Windows). Gibt stdout-String oder "".
function powershell(script, timeoutMs = 8000) {
  if (!IS_WIN) return Promise.resolve("");
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const child = execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs },
        (err, out) => finish(err || !out ? "" : String(out))
      );
      child.on("error", () => finish(""));
    } catch {
      finish("");
    }
  });
}

// VDF-Wert (Steam-Format: "key"  "value")
function vdfValue(text, key) {
  const re = new RegExp('"' + key + '"\\s+"((?:[^"\\\\]|\\\\.)*)"', "i");
  const m = text.match(re);
  return m ? m[1].replace(/\\\\/g, "\\") : null;
}

// ── Steam ────────────────────────────────────────────────────────────────────

// Bekannte Nicht-Spiele (Redistributables/Runtimes) ausblenden.
const STEAM_IGNORE = new Set(["228980", "1070560", "1391110", "1826330", "2348590"]);

async function findSteamPath() {
  const cands = [];
  const regs = [
    ["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"],
    ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]
  ];
  for (const [k, v] of regs) {
    const r = await regQuery(k, v);
    if (r) cands.push(r.replace(/\//g, "\\"));
  }
  if (IS_WIN) {
    for (const d of ["C", "D", "E", "F", "G", "H"]) {
      cands.push(d + ":\\Program Files (x86)\\Steam");
      cands.push(d + ":\\Program Files\\Steam");
      cands.push(d + ":\\Steam");
    }
  }
  const seen = new Set();
  for (const c of cands) {
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    if (exists(path.join(c, "steam.exe")) || exists(path.join(c, "steamapps"))) return c;
  }
  return null;
}

function steamLibraryFolders(steamPath) {
  const out = new Set([steamPath]);
  const vdf = safeReadFile(path.join(steamPath, "steamapps", "libraryfolders.vdf"));
  if (vdf) {
    const re = /"path"\s+"((?:[^"\\]|\\.)*)"/gi;
    let m;
    while ((m = re.exec(vdf)) !== null) out.add(m[1].replace(/\\\\/g, "\\"));
  }
  return [...out].filter(exists);
}

function steamAccount(steamPath) {
  const raw = safeReadFile(path.join(steamPath, "config", "loginusers.vdf"));
  if (!raw) return null;
  const re = /"(7656\d{13})"\s*\{([\s\S]*?)\}/g;
  let m, best = null;
  while ((m = re.exec(raw)) !== null) {
    const body = m[2];
    const persona = (body.match(/"PersonaName"\s+"([^"]*)"/i) || [])[1] || "";
    const accountName = (body.match(/"AccountName"\s+"([^"]*)"/i) || [])[1] || "";
    const mostRecent = /"MostRecent"\s+"1"/i.test(body);
    const timestamp = parseInt((body.match(/"Timestamp"\s+"(\d+)"/i) || [])[1] || "0", 10);
    const rec = { steamId: m[1], persona, accountName, mostRecent, timestamp };
    if (!best || rec.mostRecent || (!best.mostRecent && rec.timestamp > best.timestamp)) best = rec;
  }
  if (!best) return null;
  return { name: best.persona || best.accountName || best.steamId, id: best.steamId };
}

async function scanSteam() {
  const out = { id: "steam", name: "Steam", installed: false, account: null, games: [] };
  try {
    const steamPath = await findSteamPath();
    if (!steamPath) return out;
    out.installed = true;
    out.account = steamAccount(steamPath);
    const seen = new Set();
    for (const lib of steamLibraryFolders(steamPath)) {
      const apps = path.join(lib, "steamapps");
      for (const ent of safeReadDir(apps)) {
        if (!ent.isFile() || !/^appmanifest_\d+\.acf$/i.test(ent.name)) continue;
        const raw = safeReadFile(path.join(apps, ent.name));
        if (!raw) continue;
        const appid = vdfValue(raw, "appid");
        const name = vdfValue(raw, "name");
        if (!appid || !name || STEAM_IGNORE.has(appid) || seen.has(appid)) continue;
        seen.add(appid);
        const installdir = vdfValue(raw, "installdir");
        const dir = installdir ? path.join(apps, "common", installdir) : null;
        out.games.push({
          id: appid,
          name,
          installDir: dir,
          launchUri: "steam://rungameid/" + appid
        });
      }
    }
    out.games.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  } catch {}
  return out;
}

// ── Epic Games ───────────────────────────────────────────────────────────────

function epicManifestDir() {
  const pd = process.env.ProgramData || "C:\\ProgramData";
  return path.join(pd, "Epic", "EpicGamesLauncher", "Data", "Manifests");
}

// Account best-effort aus lokalem Config-Cache (kein Login, keine Credentials).
function epicAccount() {
  try {
    const local = process.env.LOCALAPPDATA || "";
    if (!local) return null;
    // GameUserSettings.ini enthält gelegentlich einen zwischengespeicherten Anzeigenamen.
    const ini = safeReadFile(
      path.join(local, "EpicGamesLauncher", "Saved", "Config", "Windows", "GameUserSettings.ini")
    );
    if (ini) {
      const name = (ini.match(/^\s*(?:LastUsedUsername|DisplayName|Username)\s*=\s*(.+?)\s*$/im) || [])[1];
      if (name) return { name: name.trim(), id: null };
    }
  } catch {}
  return null;
}

async function scanEpic() {
  const out = { id: "epic", name: "Epic Games", installed: false, account: null, games: [] };
  try {
    const dir = epicManifestDir();
    if (!exists(dir)) return out;
    out.installed = true;
    out.account = epicAccount();
    const seen = new Set();
    for (const ent of safeReadDir(dir)) {
      if (!ent.isFile() || !/\.item$/i.test(ent.name)) continue;
      const raw = safeReadFile(path.join(dir, ent.name));
      if (!raw) continue;
      let j;
      try { j = JSON.parse(raw); } catch { continue; }
      const appName = j.AppName || j.MainGameAppName || "";
      const name = j.DisplayName || j.AppName || "";
      if (!appName || seen.has(appName)) continue;
      // DLC/Plugins ohne eigene InstallLocation überspringen.
      if (!name) continue;
      seen.add(appName);
      out.games.push({
        id: appName,
        name,
        installDir: j.InstallLocation || null,
        launchUri:
          "com.epicgames.launcher://apps/" + encodeURIComponent(appName) + "?action=launch&silent=true"
      });
    }
    out.games.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  } catch {}
  return out;
}

// ── EA / Origin ──────────────────────────────────────────────────────────────

function eaAccount() {
  // Best-effort: EA/Origin legen Profildaten nur binär/verschlüsselt ab.
  // Ohne Netzwerk/Credentials ist hier zuverlässig nichts lesbar => null.
  return null;
}

// Origin .mfst-Dateien enthalten eine Query-Zeile mit ?id=<OfferId>&...
function parseOriginMfst(raw) {
  if (!raw) return null;
  const id = (raw.match(/[?&]id=([^&\s]+)/) || [])[1];
  const dip = (raw.match(/[?&]dipinstallpath=([^&\s]+)/i) || [])[1];
  let installDir = null;
  if (dip) {
    try { installDir = decodeURIComponent(dip); } catch { installDir = dip; }
  }
  return id ? { id: decodeURIComponent(id), installDir } : null;
}

async function scanEA() {
  const out = { id: "ea", name: "EA / Origin", installed: false, account: null, games: [] };
  try {
    const pd = process.env.ProgramData || "C:\\ProgramData";
    const seen = new Set();

    // 1) Origin LocalContent: <ProgramData>\Origin\LocalContent\<Game>\*.mfst
    const originRoot = path.join(pd, "Origin", "LocalContent");
    if (exists(originRoot)) {
      out.installed = true;
      for (const sub of safeReadDir(originRoot)) {
        if (!sub.isDirectory()) continue;
        const gameDir = path.join(originRoot, sub.name);
        for (const f of safeReadDir(gameDir)) {
          if (!f.isFile() || !/\.mfst$/i.test(f.name)) continue;
          const info = parseOriginMfst(safeReadFile(path.join(gameDir, f.name)));
          if (!info || seen.has(info.id)) continue;
          seen.add(info.id);
          out.games.push({
            id: info.id,
            name: sub.name,
            installDir: info.installDir || null,
            launchUri: "origin://launchgame/" + info.id
          });
        }
      }
    }

    // 2) EA Desktop: <ProgramData>\EA Desktop\InstallData\<offerId>\...
    const eaRoot = path.join(pd, "EA Desktop");
    if (exists(eaRoot)) {
      out.installed = true;
      const installData = path.join(eaRoot, "InstallData");
      for (const sub of safeReadDir(installData)) {
        if (!sub.isDirectory()) continue;
        const id = sub.name;
        if (seen.has(id)) continue;
        // installerdata.xml enthält evtl. einen lesbaren Titel + Pfad.
        let name = id;
        let installDir = null;
        const xml =
          safeReadFile(path.join(installData, id, "installerdata.xml")) ||
          safeReadFile(path.join(installData, id, "InstallerData.xml"));
        if (xml) {
          const t =
            (xml.match(/<gameTitle[^>]*>([^<]+)<\/gameTitle>/i) || [])[1] ||
            (xml.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
          if (t) name = t.trim();
          const p = (xml.match(/<installPath[^>]*>([^<]+)<\/installPath>/i) || [])[1];
          if (p) installDir = p.trim();
        }
        seen.add(id);
        out.games.push({
          id,
          name,
          installDir,
          launchUri: "ea://launchgame/" + id
        });
      }
    }

    out.games.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  } catch {}
  return out;
}

// ── Ubisoft Connect ──────────────────────────────────────────────────────────

// Kleines pflegbares Titel-Wörterbuch (uplay_install.state ist binär).
const UBI_TITLES = {
  "205": "Far Cry 4",
  "274": "Far Cry Primal",
  "413": "Far Cry 5",
  "461": "Assassin's Creed Syndicate",
  "857": "Anno 1800",
  "1253": "The Division 2",
  "1843": "Rainbow Six Siege",
  "3539": "Watch Dogs: Legion",
  "3624": "Assassin's Creed Odyssey",
  "5175": "Assassin's Creed Valhalla",
  "5405": "Far Cry 6"
};

function ubisoftAccount() {
  // Best-effort: %LOCALAPPDATA%\Ubisoft Game Launcher\ – Login liegt binär/verschlüsselt.
  // Ohne Entschlüsselung kein verlässlicher Name => null.
  return null;
}

async function scanUbisoft() {
  const out = { id: "ubisoft", name: "Ubisoft Connect", installed: false, account: null, games: [] };
  try {
    if (!IS_WIN) return out;
    // Installiert? Launcher-InstallDir oder Installs-Zweig vorhanden.
    const launcherDir = await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher", "InstallDir");
    const blocks = await regQueryTree("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs");
    if (!launcherDir && (!blocks || !blocks.length)) return out;
    out.installed = true;
    out.account = ubisoftAccount();
    const seen = new Set();
    for (const b of blocks) {
      const id = String(b.name || "").trim();
      if (!/^\d+$/.test(id) || seen.has(id)) continue;
      const v = b.values || {};
      const dir = String(v.InstallDir || v.installdir || v.Installdir || "").trim().replace(/\//g, "\\");
      let name = UBI_TITLES[id] || "";
      if (!name && dir) name = path.basename(dir.replace(/[\\/]+$/, ""));
      if (!name) name = "Ubisoft-Spiel (ID: " + id + ")";
      seen.add(id);
      out.games.push({
        id,
        name,
        installDir: dir || null,
        launchUri: "uplay://launch/" + id + "/0"
      });
    }
    out.games.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  } catch {}
  return out;
}

// ── GOG Galaxy ───────────────────────────────────────────────────────────────

// ── GOG Galaxy 2.0: lokale Datenbank lesen (galaxy-2.0.db) ───────────────────
// Rein lokal, KEIN Login: Galaxy fuehrt unter %ProgramData%\GOG.com\Galaxy\storage\
// galaxy-2.0.db die komplette Bibliothek - Titel, Bilder, Meta, Spielzeit - und
// zwar auch fuer besessene, NICHT installierte Spiele. Gelesen wird mit sql.js
// (reines WASM, kein nativer Build) aus einer KOPIE der Datei, weil Galaxy das
// Original waehrend es laeuft offen haelt.
//
// Tabellen (geprueft 13.09.2026 an Stefans DB):
//   ReleaseProperties  releaseKey ("gog_<id>"), isDlc, isVisibleInLibrary
//   GamePieces         releaseKey, gamePieceTypeId, value (JSON)
//   GamePieceTypes     id -> "title" | "originalImages" | "meta" | "summary" ...
//   GameTimes          releaseKey, minutesInGame
//   InstalledBaseProducts productId, installationPath   (nur GOG-Installationen)
let _sqlJs = null;
async function _sqlJsLaden() {
  if (_sqlJs) return _sqlJs;
  const initSqlJs = require("sql.js");
  // Die .wasm liegt neben sql-wasm.js; im gepackten Launcher (asar) explizit
  // aufloesen, sonst sucht sql.js relativ zum Arbeitsverzeichnis.
  const distDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  _sqlJs = await initSqlJs({ locateFile: f => path.join(distDir, f) });
  return _sqlJs;
}
function _gogDbPfad() {
  return path.join(process.env.ProgramData || "C:\\ProgramData", "GOG.com", "Galaxy", "storage", "galaxy-2.0.db");
}
function _jsonSicher(s) {
  try { return JSON.parse(s); } catch { return null; }
}
async function scanGogGalaxyDb() {
  const out = { ok: false, games: [], installedCount: 0, quelle: null };
  try {
    if (!IS_WIN) return out;
    const dbPfad = _gogDbPfad();
    if (!exists(dbPfad)) return out;
    // Kopie nach temp, dann in den Speicher; die Kopie danach sofort weg.
    const tmp = path.join(os.tmpdir(), "vystra-galaxy-" + process.pid + "-" + Date.now() + ".db");
    fs.copyFileSync(dbPfad, tmp);
    let buf;
    try { buf = fs.readFileSync(tmp); } finally { try { fs.unlinkSync(tmp); } catch {} }
    const SQL = await _sqlJsLaden();
    const db = new SQL.Database(buf);
    try {
      // sql.js liefert {columns, values}; hier zu Objekten je Zeile umbauen.
      const q = sql => {
        const r = db.exec(sql);
        if (!r.length) return [];
        const { columns, values } = r[0];
        return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
      };
      const releases = q("SELECT releaseKey FROM ReleaseProperties WHERE isVisibleInLibrary=1 AND isDlc=0");
      const pieces = q("SELECT g.releaseKey AS rk, t.type AS typ, g.value AS val FROM GamePieces g JOIN GamePieceTypes t ON t.id=g.gamePieceTypeId WHERE t.type IN ('title','originalTitle','originalImages','meta','summary')");
      const nachRk = new Map();
      for (const p of pieces) {
        if (!nachRk.has(p.rk)) nachRk.set(p.rk, {});
        nachRk.get(p.rk)[p.typ] = p.val;
      }
      const zeiten = new Map(q("SELECT releaseKey, minutesInGame FROM GameTimes").map(r => [r.releaseKey, Number(r.minutesInGame) || 0]));
      const inst = new Map(q("SELECT productId, installationPath FROM InstalledBaseProducts").map(r => ["gog_" + r.productId, r.installationPath || null]));
      for (const rel of releases) {
        const rk = String(rel.releaseKey || "");
        const p = nachRk.get(rk) || {};
        const titel = ((_jsonSicher(p.title) || {}).title) || ((_jsonSicher(p.originalTitle) || {}).title) || "";
        if (!titel) continue; // ohne Titel ist der Eintrag nicht darstellbar
        const bilder = _jsonSicher(p.originalImages) || {};
        const meta = _jsonSicher(p.meta) || {};
        const summ = (_jsonSicher(p.summary) || {}).summary || "";
        const plattform = rk.split("_")[0];
        const pid = rk.slice(plattform.length + 1);
        out.games.push({
          id: pid,
          releaseKey: rk,
          plattform,
          name: titel,
          image: bilder.verticalCover || bilder.squareIcon || bilder.background || null,
          background: bilder.background || null,
          developers: Array.isArray(meta.developers) ? meta.developers : [],
          genres: Array.isArray(meta.genres) ? meta.genres : [],
          releaseDate: meta.releaseDate || null,
          summary: summ,
          minutes: zeiten.get(rk) || 0,
          installed: inst.has(rk),
          installDir: inst.get(rk) || null,
          // Galaxy oeffnet die Spiel-Ansicht; von dort installieren/starten.
          launchUri: plattform === "gog" ? "goggalaxy://openGameView/" + pid : ""
        });
      }
      out.installedCount = out.games.filter(g => g.installed).length;
      out.ok = true;
      out.quelle = dbPfad;
    } finally {
      db.close();
    }
  } catch (e) {
    out.fehler = e && e.message ? e.message : String(e);
  }
  return out;
}

// ── itch.io: lokale butler.db lesen (%APPDATA%\itch\db\butler.db) ────────────
// Rein lokal, KEIN Login noetig fuer installierte Spiele. Die itch-App/butler
// fuehren dort eine SQLite-DB: caves = installiert (mit install_folder_name +
// install_location_id -> install_locations.path), games = Titel/Cover,
// download_keys = besessen (nur wenn angemeldet). Gelesen mit sql.js aus einer
// KOPIE (die App haelt das Original offen). Defensiv: fehlt eine Tabelle/Spalte
// (frisch installiertes itch legt das Schema erst spaeter an), kommt [] zurueck -
// KEIN Fehler.
function _itchDbPfad() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "itch", "db", "butler.db");
}
function _tabellen(db) {
  try {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    if (!r.length) return new Set();
    return new Set(r[0].values.map(v => String(v[0])));
  } catch { return new Set(); }
}
function _spalten(db, tabelle) {
  try {
    const r = db.exec("PRAGMA table_info(" + tabelle + ")");
    if (!r.length) return new Set();
    const iName = r[0].columns.indexOf("name");
    return new Set(r[0].values.map(v => String(v[iName])));
  } catch { return new Set(); }
}
async function scanItchDb() {
  const out = { ok: false, games: [], installedCount: 0, quelle: null };
  try {
    if (!IS_WIN && !process.env.APPDATA) return out;
    const dbPfad = _itchDbPfad();
    if (!exists(dbPfad)) return out;
    const tmp = path.join(os.tmpdir(), "vystra-itch-" + process.pid + "-" + Date.now() + ".db");
    fs.copyFileSync(dbPfad, tmp);
    let buf;
    try { buf = fs.readFileSync(tmp); } finally { try { fs.unlinkSync(tmp); } catch {} }
    const SQL = await _sqlJsLaden();
    const db = new SQL.Database(buf);
    try {
      out.ok = true; // DB lesbar; leeres Schema ist ein gueltiges "keine Spiele"
      out.quelle = dbPfad;
      const tabs = _tabellen(db);
      if (!tabs.has("games")) return out; // frisch/leer -> keine Spiele, kein Fehler
      const q = sql => {
        try {
          const r = db.exec(sql);
          if (!r.length) return [];
          const { columns, values } = r[0];
          return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
        } catch { return []; }
      };
      const gCols = _spalten(db, "games");
      const cover = gCols.has("cover_url") ? "g.cover_url" : gCols.has("still_cover_url") ? "g.still_cover_url" : "NULL";
      const titel = gCols.has("title") ? "g.title" : "NULL";
      const gesehen = new Set();
      const merke = (gid, name, image, installed, installDir, launchUri) => {
        const key = "itch_" + gid + "|" + (installDir || "");
        if (!gid || gesehen.has(key)) return;
        gesehen.add(key);
        out.games.push({
          id: String(gid),
          name: name || ("itch-Spiel " + gid),
          image: image || null,
          installed: !!installed,
          installDir: installDir || null,
          launchUri: launchUri || ("itch://games/" + gid)
        });
      };
      // Installierte Spiele (caves + install_locations).
      if (tabs.has("caves")) {
        const cCols = _spalten(db, "caves");
        const folder = cCols.has("install_folder_name") ? "c.install_folder_name" : "NULL";
        const locId = cCols.has("install_location_id") ? "c.install_location_id" : "NULL";
        const hatLoc = tabs.has("install_locations");
        const sql = "SELECT c.game_id AS gid, " + folder + " AS folder, " + (hatLoc ? "il.path" : "NULL") + " AS locpath, " + titel + " AS title, " + cover + " AS cover " +
          "FROM caves c LEFT JOIN games g ON g.id=c.game_id " + (hatLoc ? "LEFT JOIN install_locations il ON il.id=" + locId + " " : "") + "";
        for (const r of q(sql)) {
          let installDir = null;
          if (r.locpath && r.folder) { try { installDir = path.join(String(r.locpath), String(r.folder)); } catch {} }
          // Startbare .exe im Install-Ordner suchen; sonst itch-App oeffnen.
          let launchUri = "";
          if (installDir && exists(installDir)) {
            const exe = findGameExe(installDir);
            if (exe) launchUri = exe; // nackter Pfad -> game:launch nutzt shell.openPath
          }
          merke(r.gid, r.title, r.cover, true, installDir, launchUri || "itch://games/" + r.gid);
        }
      }
      out.installedCount = out.games.filter(g => g.installed).length;
      // Besessene (nicht installierte) Spiele: download_keys (nur bei Login).
      if (tabs.has("download_keys")) {
        const sql = "SELECT dk.game_id AS gid, " + titel + " AS title, " + cover + " AS cover " +
          "FROM download_keys dk LEFT JOIN games g ON g.id=dk.game_id";
        for (const r of q(sql)) merke(r.gid, r.title, r.cover, false, null, "itch://games/" + r.gid);
      }
    } finally {
      db.close();
    }
  } catch (e) {
    out.fehler = e && e.message ? e.message : String(e);
  }
  return out;
}
// itch als (nativer) Scan-Launcher: liefert die butler.db-Spiele. installed=true,
// sobald die itch-DB existiert (itch ist dann installiert), auch wenn 0 Spiele.
async function scanItch() {
  const out = { id: "itch", name: "itch", installed: false, account: null, games: [], launchScheme: "itch://" };
  try {
    const db = await scanItchDb();
    if (!db.ok) return out;
    out.installed = true;
    out.bibliothek = { anzahl: db.games.length, installiert: db.installedCount, quelle: db.quelle };
    out.games = db.games;
    if (db.fehler) out.dbFehler = db.fehler;
  } catch {}
  return out;
}

async function scanGOG() {
  const out = { id: "gog", name: "GOG Galaxy", installed: false, account: null, games: [] };
  try {
    if (!IS_WIN) return out;
    // 1) Installierte GOG-Spiele aus der Registry (wie bisher).
    let blocks = [];
    for (const root of ["HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games", "HKLM\\SOFTWARE\\GOG.com\\Games"]) {
      const part = await regQueryTree(root);
      if (part.length) blocks = blocks.concat(part);
    }
    const seen = new Set();
    if (blocks.length) out.installed = true;
    for (const b of blocks) {
      const v = b.values || {};
      const id = String(v.gameID || b.name || "").trim();
      if (!/^\d+$/.test(id) || seen.has(id)) continue;
      const dir = String(v.path || v.PATH || "").trim();
      const name =
        String(v.gameName || v.startMenu || "").trim() ||
        (dir ? path.basename(dir.replace(/[\\/]+$/, "")) : "GOG-Spiel (ID: " + id + ")");
      seen.add(id);
      out.games.push({
        id,
        name,
        installed: true,
        installDir: dir || null,
        launchUri: "goggalaxy://openGameView/" + id
      });
    }
    // 2) Die volle Bibliothek (auch nicht installiert, mit Bild/Meta/Spielzeit)
    //    aus der lokalen Galaxy-DB dazumischen. Existiert die DB, ist Galaxy da.
    const dbErg = await scanGogGalaxyDb();
    if (dbErg.ok) {
      out.installed = true;
      out.bibliothek = { anzahl: dbErg.games.length, installiert: dbErg.installedCount, quelle: dbErg.quelle };
      for (const g of dbErg.games) {
        if (g.plattform !== "gog") continue; // Fremdplattformen kommen ueber ihre eigenen Adapter
        if (seen.has(g.id)) {
          // Registry-Eintrag mit Bild/Meta/Spielzeit anreichern.
          const vorh = out.games.find(x => x.id === g.id);
          if (vorh) Object.assign(vorh, { image: g.image, background: g.background, minutes: g.minutes, genres: g.genres, developers: g.developers, summary: g.summary });
          continue;
        }
        seen.add(g.id);
        out.games.push(g);
      }
    } else if (dbErg.fehler) {
      out.dbFehler = dbErg.fehler;
    }
    out.games.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  } catch {}
  return out;
}

// ── Xbox / Microsoft Store (best-effort, darf leer sein) ─────────────────────

async function scanXbox() {
  const out = { id: "xbox", name: "Xbox / Microsoft Store", installed: false, account: null, games: [] };
  try {
    if (!IS_WIN) return out;
    const seen = new Set();

    // Best-effort über Get-AppxPackage. Um NICHT jede Store-App (Wetter, News,
    // Video-Extensions …) zu erwischen, wird pro Paket geprüft, ob im
    // InstallLocation eine "MicrosoftGame.config" liegt – die gibt es nur bei
    // echten Xbox/GDK-Spielen. Alles in PowerShell, damit ACL-geschützte Pfade
    // im User-Kontext getestet werden können.
    const ps = await powershell(
      "$out=@(); " +
      "Get-AppxPackage | Where-Object { $_.SignatureKind -eq 'Store' -and -not $_.IsFramework -and $_.InstallLocation } | ForEach-Object { " +
      "  $cfg = Join-Path $_.InstallLocation 'MicrosoftGame.config'; " +
      "  if (Test-Path -LiteralPath $cfg) { " +
      "    $out += [pscustomobject]@{ Name=$_.Name; Family=$_.PackageFamilyName; Loc=$_.InstallLocation } " +
      "  } " +
      "}; " +
      "$out | ConvertTo-Json -Compress",
      12000
    );
    if (ps) {
      let arr = [];
      try {
        const parsed = JSON.parse(ps);
        arr = Array.isArray(parsed) ? parsed : [parsed];
      } catch {}
      for (const p of arr) {
        if (!p || !p.Name || seen.has(p.Name)) continue;
        seen.add(p.Name);
        out.installed = true;
        // Anzeigename: möglichst aus MicrosoftGame.config lesen, sonst Paketname.
        let name = null;
        try {
          const cfg = safeReadFile(path.join(p.Loc, "MicrosoftGame.config"));
          if (cfg) {
            name =
              (cfg.match(/<ShellVisuals[^>]*\bDefaultDisplayName="([^"]+)"/i) || [])[1] ||
              (cfg.match(/<DisplayName>\s*([^<]+?)\s*<\/DisplayName>/i) || [])[1] ||
              null;
          }
        } catch {}
        if (!name) name = p.Name.replace(/^.*\./, "").replace(/([a-z])([A-Z])/g, "$1 $2");
        out.games.push({
          id: p.Name,
          name: name.trim(),
          installDir: p.Loc || null,
          // Startbar über das Shell-AppsFolder-Ziel des Family-Namens.
          launchUri: p.Family ? "shell:AppsFolder\\" + p.Family : null
        });
      }
    }

    out.games.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  } catch {}
  return out;
}

// ── Phase 1: schneller Scan aller Fixpunkte ──────────────────────────────────

async function scanAll(opts) {
  const onLauncher = opts && typeof opts.onLauncher === "function" ? opts.onLauncher : null;
  const launchers = [];
  // Nacheinander, damit die Bibliothek live füllen kann (Steam zuerst, Xbox zuletzt).
  for (const fn of [scanSteam, scanEpic, scanEA, scanUbisoft, scanGOG, scanXbox, scanItch]) {
    const l = await fn();
    launchers.push(l);
    if (onLauncher) {
      try { onLauncher(l); } catch {}
    }
  }
  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    launchers
  };
}

// ── Phase 2: optionaler Tiefen-Scan (nur Verzeichnisnamen) ───────────────────

// Pflegbares Wörterbuch: Launcher-/typische Spielordner + dynamisch die in
// Phase 1 gefundenen Titel.
const BASE_DICTIONARY = [
  "Steam", "steamapps", "Epic Games", "EpicGames", "Ubisoft", "Ubisoft Game Launcher",
  "EA Games", "EA Desktop", "Origin Games", "Origin", "GOG Galaxy", "GOG Games",
  "Games", "Rockstar Games", "Battle.net", "Riot Games", "Xbox Games", "WindowsApps",
  "ModifiableWindowsApps", "Amazon Games", "Bethesda.net", "Minecraft"
];

const SKIP_DIR_NAMES = new Set(
  [
    "windows", "$recycle.bin", "system volume information", "node_modules",
    "appdata", "programdata", "recovery", "perflogs", "$windows.~bt", "$windows.~ws",
    "msocache", "config.msi", "intel", "amd", "nvidia", "boot", "documents and settings"
  ].map(s => s.toLowerCase())
);

function driveRoots() {
  if (!IS_WIN) return ["/"];
  const roots = [];
  for (const d of ["C", "D", "E", "F", "G", "H", "I", "J"]) {
    const r = d + ":\\";
    if (exists(r)) roots.push(r);
  }
  return roots;
}

function fuzzyMatch(name, dict) {
  const n = name.toLowerCase();
  for (const w of dict) {
    const t = w.toLowerCase();
    if (n === t || n.includes(t) || t.includes(n)) return w;
  }
  return null;
}

// deepScan: läuft von den Laufwerks-Wurzeln, liest NUR Verzeichnisnamen und
// steigt nur bei Wörterbuch-Treffer ab. Fortschritt via onProgress-Callback.
// Ergebnis wird (falls cacheFile gesetzt) als JSON gecacht.
async function deepScan(opts = {}) {
  const {
    roots = driveRoots(),
    extraTitles = [],
    maxDepth = 4,
    onProgress = null,
    cacheFile = null
  } = opts;

  const dictionary = BASE_DICTIONARY.concat(extraTitles).filter(Boolean);
  const started = Date.now();
  let checked = 0;
  const hits = [];
  const HARD_LIMIT = 200000; // Sicherheitsnetz gegen Endlos-Scans

  // grobe ETA anhand der bisherigen Rate.
  function emitProgress(currentPath) {
    if (typeof onProgress !== "function") return;
    const elapsed = Date.now() - started;
    const rate = checked / Math.max(1, elapsed); // Ordner/ms
    onProgress({
      checked,
      hits: hits.length,
      currentPath,
      elapsedMs: elapsed,
      // Ohne bekannte Gesamtmenge nur grobe Laufzeit-Info statt harter ETA.
      etaMs: null,
      rateHint: rate > 0 ? Math.round(rate * 1000) + " Ordner/s" : ""
    });
  }

  function walk(dir, depth) {
    if (depth > maxDepth || checked > HARD_LIMIT) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      const low = name.toLowerCase();
      if (SKIP_DIR_NAMES.has(low)) continue;
      if (low.startsWith("$") || low.startsWith(".")) continue;
      checked++;
      if (checked % 250 === 0) emitProgress(dir);
      const matched = fuzzyMatch(name, dictionary);
      if (matched) {
        const full = path.join(dir, name);
        hits.push({ path: full, matched, name });
        // Nur bei Treffer eine Ebene tiefer schauen (Spiele-Unterordner).
        walk(full, depth + 1);
      } else if (depth < 1) {
        // Auf der Laufwerks-Wurzel eine Ebene generisch abtasten, um Container
        // wie "Program Files" / "Games" zu erreichen, ohne alles zu durchlaufen.
        if (/^(program files|program files \(x86\)|games|spiele|program|xboxgames)/i.test(low)) {
          walk(path.join(dir, name), depth + 1);
        }
      }
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }
  emitProgress(null);

  const result = {
    ok: true,
    scannedAt: new Date().toISOString(),
    checked,
    roots,
    hits
  };

  if (cacheFile) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), "utf8");
    } catch {}
  }
  return result;
}

// ── Crowd-Detection (Community-Signaturen vom Server, LOKAL erkannt) ─────────
// Rein lokale Erkennung: prüft nur, ob Ordner/Registry-Keys/exe-Dateien auf
// diesem Rechner existieren. KEINE Credentials, KEINE Netzwerkaufrufe hier.

// %VAR% (inkl. %ProgramFiles(x86)%, %LOCALAPPDATA%, %ProgramData%, %APPDATA%,
// %ProgramFiles%) durch process.env-Werte ersetzen. Unbekannte Var bleibt stehen.
function expandEnv(p) {
  if (!p || typeof p !== "string") return p || "";
  return p.replace(/%([^%]+)%/g, (whole, name) => {
    const v = process.env[name];
    return v === undefined || v === null ? whole : v;
  });
}

// Robuste "Registry-Key existiert?"-Prüfung (nur Windows).
async function regKeyExists(key) {
  try {
    if (!IS_WIN || !key) return false;
    const blocks = await regQueryTree(key);
    return Array.isArray(blocks) && blocks.length > 0;
  } catch {
    return false;
  }
}

// exe rekursiv (1-2 Ebenen) in einem Wurzelordner suchen. Best-effort.
function findExeInDir(dir, exeNames, depth, maxDepth) {
  if (depth > maxDepth) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const subdirs = [];
  for (const ent of entries) {
    try {
      if (ent.isFile()) {
        if (exeNames.has(String(ent.name).toLowerCase())) return true;
      } else if (ent.isDirectory()) {
        const low = String(ent.name).toLowerCase();
        if (low.startsWith("$") || low.startsWith(".")) continue;
        subdirs.push(path.join(dir, ent.name));
      }
    } catch {}
  }
  if (depth < maxDepth) {
    for (const sd of subdirs) {
      if (findExeInDir(sd, exeNames, depth + 1, maxDepth)) return true;
    }
  }
  return false;
}

// Wie findExeInDir, liefert aber den PFAD der ersten passenden exe (oder null).
// Warum extra: "Synchronisieren" muss aus einem erkannten Launcher einen
// verknuepften Launcher bauen koennen - dafuer braucht es den echten exe-Pfad,
// nicht nur ein Ja/Nein.
function findExePathInDir(dir, exeNames, depth, maxDepth) {
  if (depth > maxDepth) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const subdirs = [];
  for (const ent of entries) {
    try {
      if (ent.isFile()) {
        if (exeNames.has(String(ent.name).toLowerCase())) return path.join(dir, ent.name);
      } else if (ent.isDirectory()) {
        const low = String(ent.name).toLowerCase();
        if (low.startsWith("$") || low.startsWith(".")) continue;
        subdirs.push(path.join(dir, ent.name));
      }
    } catch {}
  }
  if (depth < maxDepth) {
    for (const sd of subdirs) {
      const hit = findExePathInDir(sd, exeNames, depth + 1, maxDepth);
      if (hit) return hit;
    }
  }
  return null;
}
// Pfad der Launcher-exe in typischen Programm-Verzeichnissen (oder null).
// Sucht die gleichen Wurzeln wie findExeInCommonLocations, nur mit Ergebnis-Pfad.
// maxDepth 4 statt 2: Epic liegt z. B. unter ...\Launcher\Portal\Binaries\Win32\.
async function findExePathInCommonLocations(exes, maxDepth = 4) {
  try {
    if (!IS_WIN) return null;
    const exeNames = _exeNamenSet(exes);
    if (!exeNames.size) return null;
    const roots = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["LOCALAPPDATA"],
      process.env["ProgramData"]
    ].filter(Boolean);
    for (const root of roots) {
      try {
        const hit = findExePathInDir(root, exeNames, 0, maxDepth);
        if (hit) return hit;
      } catch {}
    }
  } catch {}
  return null;
}
function _exeNamenSet(exes) {
  return new Set(
    (Array.isArray(exes) ? exes : [])
      .map(e => String(path.basename(String(e || ""))).toLowerCase())
      .filter(Boolean)
  );
}

// ── Uninstall-Registry als Quelle fuer echte Install-Orte ────────────────────
// Warum: Launcher liegen oft NICHT in Program Files (bei Stefan: GOG Galaxy auf
// F:\GOG Galaxy\, itch auf F:\). Die Uninstall-Eintraege kennen den echten Ort
// (InstallLocation) - von dort ist die exe mit einer kurzen Suche sicher zu
// finden. Wird je Aufruf-Batch nur EINMAL gelesen (reg query /s ist teuer).
const _UNINSTALL_WURZELN = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
];
let _uninstallCache = null;
let _uninstallCacheZeit = 0;
async function uninstallEintraegeLesen() {
  const jetzt = Date.now();
  if (_uninstallCache && jetzt - _uninstallCacheZeit < 60 * 1000) return _uninstallCache;
  const out = [];
  if (IS_WIN) {
    for (const wurzel of _UNINSTALL_WURZELN) {
      try {
        const blocks = await regQueryTree(wurzel);
        for (const b of blocks) {
          const v = b.values || {};
          const name = String(v.DisplayName || "").trim();
          if (!name) continue;
          // Formen in der Praxis: "C:\x\y.exe",0  |  C:\x\y.exe,0  |  %ProgramFiles%\x
          // (REG_EXPAND_SZ). Erst Quotes MIT Suffix als Ganzes, dann nacktes Suffix,
          // dann Umgebungsvariablen aufloesen - sonst bleibt ein '"' am Ende haengen.
          const icon = expandEnv(String(v.DisplayIcon || "").trim().replace(/^"(.*?)"(?:,-?\d+)?$/, "$1").replace(/,-?\d+$/, ""));
          const loc = expandEnv(String(v.InstallLocation || "").trim().replace(/^"(.*?)"$/, "$1"));
          out.push({ name, nameLow: name.toLowerCase(), loc, icon });
        }
      } catch {}
    }
  }
  _uninstallCache = out;
  _uninstallCacheZeit = jetzt;
  return out;
}
// Namens-Tokens, an denen wir einen Launcher im Uninstall-Eintrag wiedererkennen.
// Bekannte ids fest, unbekannte ueber ihren Namen. Reihenfolge = Praeferenz.
const _LAUNCHER_NAMEN = {
  steam: ["steam"],
  epic: ["epic games launcher", "epic games"],
  ea: ["ea app", "origin"],
  ubisoft: ["ubisoft connect", "ubisoft"],
  gog: ["gog galaxy", "galaxy"],
  itch: ["itch"],
  battlenet: ["battle.net"],
  riot: ["riot client", "riot"],
  rockstar: ["rockstar games launcher", "rockstar"]
};
function _launcherNamenTokens(sig) {
  const id = String(sig && sig.id || "").toLowerCase();
  const fest = _LAUNCHER_NAMEN[id];
  const eigener = String(sig && sig.name || "").toLowerCase().trim();
  const tokens = [];
  if (fest) tokens.push(...fest);
  if (eigener && !tokens.includes(eigener)) tokens.push(eigener);
  return tokens;
}
function _istLaufwerkswurzel(p) {
  return /^[a-z]:[\\/]*$/i.test(String(p || "").trim());
}
// Native Launcher haben im Renderer eigene Adapter - ihr exePath wird nie zum
// Verknuepfen benutzt. Fuer sie die (teure) Aufloesung ganz sparen.
const _NATIVE_LAUNCHER_IDS = new Set(["steam", "epic", "xbox", "ea", "ubisoft", "gog"]);
// exe-Namen, die es in vielen Programmen gibt: NIE per Standardordner-Fallback
// suchen, sonst wird aus einem fremden "Launcher.exe" ein falscher Launcher.
const _GENERISCHE_EXE = new Set(["launcher.exe", "start.exe", "game.exe", "app.exe", "client.exe", "setup.exe", "run.exe", "main.exe"]);
// Mehrere exe-Namen in EINEM Durchlauf ueber die Standardordner suchen (Map
// name -> Pfad). Bricht ab, sobald alle gefunden sind. Warum: der Fallback kostet
// ~1 s je Durchlauf - einmal pro Batch statt einmal je Signatur.
function _findExePathsInDir(dir, wanted, depth, maxDepth, out) {
  if (depth > maxDepth || out.size >= wanted.size) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const subdirs = [];
  for (const ent of entries) {
    try {
      const low = String(ent.name).toLowerCase();
      if (ent.isFile()) {
        if (wanted.has(low) && !out.has(low)) out.set(low, path.join(dir, ent.name));
      } else if (ent.isDirectory()) {
        if (low.startsWith("$") || low.startsWith(".")) continue;
        subdirs.push(path.join(dir, ent.name));
      }
    } catch {}
  }
  if (depth < maxDepth) {
    for (const sd of subdirs) {
      if (out.size >= wanted.size) return;
      _findExePathsInDir(sd, wanted, depth + 1, maxDepth, out);
    }
  }
}
function findExePathsInCommonLocations(wanted, maxDepth = 4) {
  const out = new Map();
  if (!IS_WIN || !wanted || !wanted.size) return out;
  const roots = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
    process.env["LOCALAPPDATA"],
    process.env["ProgramData"]
  ].filter(Boolean);
  for (const root of roots) {
    if (out.size >= wanted.size) break;
    try { _findExePathsInDir(root, wanted, 0, maxDepth, out); } catch {}
  }
  return out;
}
// Echten exe-Pfad eines (Crowd-)Launchers aufloesen. Reihenfolge:
//  1) Uninstall-Eintrag mit passendem DisplayName -> DisplayIcon ist die exe?
//     sonst InstallLocation begrenzt durchsuchen (Tiefe 5; Laufwerkswurzel: 2).
//  2) Standard-Programmordner (Tiefe 4).
// Liefert null, wenn nichts Sicheres gefunden wurde - lieber nichts als Raten.
async function launcherExePfadAufloesen(sig, uninstall, opts = {}) {
  try {
    if (!IS_WIN || !sig) return null;
    const detect = sig.detect && typeof sig.detect === "object" ? sig.detect : {};
    const exeNames = _exeNamenSet(detect.exe);
    if (!exeNames.size) return null;
    // 0) Signatur-Ordner (detect.folders) zuerst: Crowd-Signaturen aus "Launcher
    //    hinzufuegen" tragen genau den exe-Ordner - schnellste und sicherste Quelle.
    for (const roh of Array.isArray(detect.folders) ? detect.folders : []) {
      const ordner = expandEnv(String(roh || "").trim().replace(/^"(.*?)"$/, "$1"));
      if (!ordner || !exists(ordner)) continue;
      for (const n of exeNames) {
        const direkt = path.join(ordner, n);
        if (exists(direkt)) return direkt;
      }
      const hit = findExePathInDir(ordner, exeNames, 0, _istLaufwerkswurzel(ordner) ? 1 : 3);
      if (hit) return hit;
    }
    const eintraege = Array.isArray(uninstall) ? uninstall : await uninstallEintraegeLesen();
    const fest = new Set(_LAUNCHER_NAMEN[String(sig.id || "").toLowerCase()] || []);
    const tokens = _launcherNamenTokens(sig);
    // Kandidaten nach Guete: exakter Name > beginnt mit (>=4 Zeichen, an
    // Wortgrenze) > enthaelt (NUR feste Tokens, an Wortgrenze). Wortgrenze, damit
    // "itch" nicht "Twitch"/"Switch" und "origin" nicht "Original" trifft. Je
    // Eintrag nur der beste Rang (kein Doppel-Durchsuchen desselben Ordners).
    const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const besterRang = new Map();
    for (const t of tokens) {
      if (t.length < 3) continue;
      const wort = new RegExp("(^|[^a-z0-9])" + escRe(t) + "($|[^a-z0-9])");
      for (const e of eintraege) {
        let rang = -1;
        if (e.nameLow === t) rang = 0;
        else if (t.length >= 4 && e.nameLow.startsWith(t) && wort.test(e.nameLow)) rang = 1;
        else if (fest.has(t) && t.length >= 4 && wort.test(e.nameLow)) rang = 2;
        if (rang >= 0 && (!besterRang.has(e) || besterRang.get(e) > rang)) besterRang.set(e, rang);
      }
    }
    const kandidaten = Array.from(besterRang, ([e, rang]) => ({ e, rang })).sort((a, b) => a.rang - b.rang);
    for (const { e } of kandidaten) {
      // DisplayIcon zeigt manchmal direkt auf die Launcher-exe.
      if (e.icon && exeNames.has(path.basename(e.icon).toLowerCase()) && exists(e.icon)) return e.icon;
      const orte = [];
      if (e.loc) orte.push(e.loc);
      if (e.icon) orte.push(path.dirname(e.icon));
      for (const ort of orte) {
        if (!ort || !exists(ort)) continue;
        const tiefe = _istLaufwerkswurzel(ort) ? 2 : 5;
        const hit = findExePathInDir(ort, exeNames, 0, tiefe);
        if (hit) return hit;
      }
    }
    // Fallback nur bei EINDEUTIGEN exe-Namen (siehe _GENERISCHE_EXE) - und nur,
    // wenn der Aufrufer ihn nicht selbst gebuendelt macht (detectCrowdLaunchers).
    if (opts.ohneFallback) return null;
    const spezifisch = Array.from(exeNames).filter(n => !_GENERISCHE_EXE.has(n));
    if (!spezifisch.length) return null;
    return await findExePathInCommonLocations(spezifisch, 4);
  } catch {
    return null;
  }
}

// exe in typischen Programm-Verzeichnissen finden. Best-effort, darf leer sein.
async function findExeInCommonLocations(exes) {
  try {
    if (!IS_WIN) return false;
    const exeNames = new Set(
      (Array.isArray(exes) ? exes : [])
        .map(e => String(path.basename(String(e || ""))).toLowerCase())
        .filter(Boolean)
    );
    if (!exeNames.size) return false;
    const roots = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["LOCALAPPDATA"],
      process.env["ProgramData"]
    ].filter(Boolean);
    for (const root of roots) {
      try {
        if (findExeInDir(root, exeNames, 0, 2)) return true;
      } catch {}
    }
  } catch {}
  return false;
}

// true, wenn EINE der Signatur-Bedingungen (folders/registry/exe) zutrifft.
async function detectSignature(sig) {
  try {
    if (!sig || typeof sig !== "object") return false;
    const detect = sig.detect && typeof sig.detect === "object" ? sig.detect : sig;

    // folders: irgendein expandEnv(folder) existiert
    const folders = Array.isArray(detect.folders) ? detect.folders : [];
    for (const f of folders) {
      try {
        const ex = expandEnv(f);
        if (ex && exists(ex)) return true;
      } catch {}
    }

    // registry: irgendein Key existiert
    const registry = Array.isArray(detect.registry) ? detect.registry : [];
    for (const key of registry) {
      try {
        if (await regKeyExists(key)) return true;
      } catch {}
    }

    // exe: irgendeine exe in typischen Orten gefunden
    const exes = Array.isArray(detect.exe) ? detect.exe : [];
    if (exes.length) {
      try {
        if (await findExeInCommonLocations(exes)) return true;
      } catch {}
    }

    return false;
  } catch {
    return false;
  }
}

// Über die Server-Signaturen mappen, nur die lokal erkannten zurückgeben.
async function detectCrowdLaunchers(signatures) {
  const list = Array.isArray(signatures) ? signatures : [];
  // Uninstall-Registry EINMAL fuer alle Signaturen lesen (teuer).
  const uninstall = await uninstallEintraegeLesen();
  const results = await Promise.all(
    list.map(async sig => {
      try {
        const ok = await detectSignature(sig);
        if (!ok) return null;
        const detect = sig.detect && typeof sig.detect === "object"
          ? sig.detect
          : { registry: [], exe: [], folders: [] };
        // Echten exe-Pfad aufloesen (Best-effort): damit "Synchronisieren" den
        // Launcher als verknuepften Launcher anlegen kann. Native Launcher
        // ueberspringen (unbenutzt), der teure Standardordner-Fallback kommt
        // unten EINMAL fuer alle noch offenen Signaturen.
        let exePath = null;
        if (!_NATIVE_LAUNCHER_IDS.has(String(sig.id || "").toLowerCase())) {
          try {
            exePath = await launcherExePfadAufloesen({ id: sig.id, name: sig.name, detect }, uninstall, { ohneFallback: true });
          } catch {}
        }
        return {
          id: sig.id,
          name: sig.name,
          launchScheme: sig.launchScheme || sig.launchscheme || "",
          detect,
          installed: true,
          exePath: exePath || null,
          ordner: exePath ? path.dirname(exePath) : null
        };
      } catch {
        return null;
      }
    })
  );
  const erkannt = results.filter(Boolean);
  // Gebuendelter Fallback: alle noch offenen, nicht-nativen Signaturen mit
  // spezifischen exe-Namen in EINEM Durchlauf ueber die Standardordner.
  const offen = erkannt.filter(r => !r.exePath && !_NATIVE_LAUNCHER_IDS.has(String(r.id || "").toLowerCase()));
  if (offen.length) {
    const gesucht = new Set();
    for (const r of offen) for (const n of _exeNamenSet(r.detect.exe)) if (!_GENERISCHE_EXE.has(n)) gesucht.add(n);
    if (gesucht.size) {
      let treffer = new Map();
      try { treffer = findExePathsInCommonLocations(gesucht, 4); } catch {}
      for (const r of offen) {
        for (const n of _exeNamenSet(r.detect.exe)) {
          const p = treffer.get(n);
          if (p) { r.exePath = p; r.ordner = path.dirname(p); break; }
        }
      }
    }
  }
  return erkannt;
}

// ── Voll-Scan aller Platten nach installierten Spielen ──────────────────────
// Fuer verknuepfte Launcher: der Nutzer will, dass ALLE Laufwerke durchstoebert
// werden. Ein Ordner gilt als Spiel, wenn er direkt eine startbare .exe enthaelt
// UND einen Spiel-Marker (Engine-Datei/Steam-DLL) hat oder unter einem typischen
// Spiele-Pfad liegt. Der Marker verhindert, dass jedes Programm in "Program Files"
// faelschlich als Spiel auftaucht. Asynchron mit Fortschritt + hartem Limit, damit
// die App nicht einfriert.
const VL_NON_GAME_EXE = new Set([
  "steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "epicwebhelper.exe",
  "upc.exe", "uplay.exe", "ubisoftconnect.exe", "eadesktop.exe", "easteamproxy.exe",
  "origin.exe", "battle.net.exe", "galaxyclient.exe", "galaxyclienthelper.exe",
  "itch.exe", "riotclientservices.exe", "vystra launcher.exe",
  "unins000.exe", "uninstall.exe", "uninstaller.exe", "setup.exe", "vc_redist.x64.exe",
  "vc_redist.x86.exe", "vcredist_x64.exe", "vcredist_x86.exe", "dxsetup.exe",
  "dxwebsetup.exe", "unitycrashhandler64.exe", "unitycrashhandler32.exe",
  "crashpad_handler.exe", "crashreportclient.exe", "ue4prereqsetup_x64.exe",
  "ueprereqsetup_x64.exe", "notification_helper.exe", "chrome.exe", "firefox.exe",
  "msedge.exe", "notepad.exe", "notepad++.exe", "code.exe", "discord.exe",
  "spotify.exe", "obs64.exe", "vlc.exe", "7zfm.exe", "winrar.exe", "python.exe",
  "pythonw.exe", "node.exe", "electron.exe",
  // Dienste/Overlays/Werkzeuge, die sonst als "Spiel" durchrutschen.
  "cloudflared.exe", "epiconlineserviceshost.exe", "eosoverlayrenderer-win64-shipping.exe",
  "protoc.exe", "flac-win32.exe", "ffmpeg.exe", "git.exe"
]);
function istSpielExe(_0xname) {
  const low = String(_0xname).toLowerCase();
  if (!low.endsWith(".exe")) return false;
  if (VL_NON_GAME_EXE.has(low)) return false;
  // Offensichtliche Hilfs-/Installer-Programme raus. "launcher" bleibt drin, weil
  // viele Spiele mit <Spiel>Launcher.exe starten.
  if (/^(unins|setup|install|uninstall|vc_?redist|vcredist|dxsetup|dxwebsetup|dotnet)/.test(low)) return false;
  if (/(crashhandler|crashpad|crashreport|prereqsetup|webhelper|helper|updater|update|redist|dwsetup)/.test(low)) return false;
  return true;
}
// Ordnernamen, deren DIREKTE Kinder je ein Spiel sind (Bibliotheks-Wurzeln).
// So wird "XboxGames\obs-studio" als EIN Eintrag behandelt statt in seine
// Helfer-Exes zu zerfasern - und Spiele, deren .exe erst im Unterordner liegt
// (z. B. "Minecraft Launcher\Content\Minecraft.exe"), werden trotzdem gefunden.
const _VL_GAMES_ROOT = new Set([
  "games", "spiele", "xboxgames", "apps",
  "gog games", "amazon games", "rockstar games"
]);
// "common" ist nur im Steam-Kontext eine Spiele-Wurzel (steamapps\common\<Spiel>) -
// sonst faengt es z. B. Visual Studios "Shared\Common\...". "epic games" nur, wenn
// es NICHT der Service-Ordner ist (den blenden wir per Name aus).
function _vlIstGamesRoot(_0xdir) {
  const eltern = path.basename(path.dirname(_0xdir)).toLowerCase();
  if (_VL_GAMES_ROOT.has(eltern)) return true;
  if (eltern === "common") {
    return path.basename(path.dirname(path.dirname(_0xdir))).toLowerCase() === "steamapps";
  }
  return false;
}
// Marker im Ordner (aus bereits gelesenen Dirents): sieht der Ordner selbst nach
// einer Spiel-Installation aus (Engine-Datei / Steam-DLL / Godot-Paket)?
function _vlHatMarker(_0xentries) {
  for (const ent of _0xentries) {
    const n = ent.name.toLowerCase();
    if (ent.isFile()) {
      if (n === "unityplayer.dll" || n === "gameassembly.dll" || n === "steam_api.dll" || n === "steam_api64.dll" || n.endsWith(".pck") || n.endsWith(".uproject")) {
        return true;
      }
    } else if (ent.isDirectory()) {
      if (n.endsWith("_data") || n === "engine" || n === "il2cpp_data") {
        return true;
      }
    }
  }
  return false;
}
// Beste startbare Spiel-.exe in einem Ordner (bis 2 Ebenen tief). Bevorzugt die
// .exe, die so heisst wie der Ordner (typische Haupt-Exe), sonst die groesste.
function _vlBesteExeIn(_0xdir, _0xentries, _0xtiefe) {
  let best = null;
  let score = -1;
  const _0xbasis = path.basename(_0xdir).toLowerCase();
  for (const ent of _0xentries) {
    if (!ent.isFile() || !istSpielExe(ent.name)) continue;
    const full = path.join(_0xdir, ent.name);
    let sz = 0;
    try { sz = fs.statSync(full).size; } catch {}
    const passt = ent.name.toLowerCase().replace(/\.exe$/, "") === _0xbasis;
    const s = sz + (passt ? 1e12 : 0);
    if (s > score) { score = s; best = full; }
  }
  if (best) return best;
  if (_0xtiefe >= 2) return null;
  for (const ent of _0xentries) {
    if (!ent.isDirectory()) continue;
    const low = ent.name.toLowerCase();
    if (SKIP_DIR_NAMES.has(low) || low.startsWith("$") || low.startsWith(".")) continue;
    const sub = path.join(_0xdir, ent.name);
    const r = _vlBesteExeIn(sub, safeReadDir(sub), _0xtiefe + 1);
    if (r) {
      let sz = 0;
      try { sz = fs.statSync(r).size; } catch {}
      if (sz > score) { score = sz; best = r; }
    }
  }
  return best;
}
// Programme, die KEINE Spiele sind, auch wenn sie in einem Spiele-Ordner liegen
// (z. B. OBS im XboxGames-Ordner). Teilstring-Abgleich gegen Ordner- + exe-Name.
// Engines (unity/unreal/godot) stehen hier BEWUSST NICHT drin - die sind Spiel-Marker.
const VL_SOFTWARE_TOKEN = [
  "obs", "voicemod", "cloudflared", "discord", "spotify", "ffmpeg", "handbrake",
  "audacity", "vlc", "zoom", "teams", "skype", "gimp", "krita", "inkscape",
  "blender", "obs-studio", "streamlabs", "nvidia", "geforce", "afterburner",
  "wallpaper_engine", "wallpaper", "rivatuner", "msi", "logitech", "razer",
  "corsair", "python", "nodejs", "mysql", "xampp", "wamp", "docker", "putty",
  "filezilla", "notepad", "vscode", "sublime", "postman", "wireshark",
  "online services", "eosoverlay", "redistributable", "directx", "vcredist",
  "prerequisites", "dotnet", "crashhandler", "launcher helper"
];
// Art eines gefundenen Eintrags bestimmen: "spiel" oder "software".
// - Engine-/Store-Marker (hatMarker) => klar Spiel.
// - sonst App-Namen pruefen => Software, wenn ein Token passt.
// - Rest bleibt "spiel" (unter einer Spiele-Wurzel ist das die sichere Annahme;
//   der Nutzer kann einzelne Eintraege spaeter selbst umsortieren).
function _vlArtBestimmen(_0xdir, _0xexePath, _0xhatMarker) {
  const _0xtext = (path.basename(_0xdir) + " " + path.basename(_0xexePath)).toLowerCase();
  for (const _0xt of VL_SOFTWARE_TOKEN) {
    if (_0xtext.includes(_0xt)) {
      return "software";
    }
  }
  return "spiel";
}
function _vlHash(_0xs) {
  let h = 0;
  const s = String(_0xs).toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
// Anzeigename fuer ein gefundenes Spiel: liegt die .exe in einem generischen
// Unterordner (Content, bin, win64 …), waere dessen Name nichtssagend - dann den
// naechsten aussagekraeftigen Elternordner nehmen (z. B. "Minecraft Launcher"
// statt "Content").
const _VL_GENERIC_DIR = new Set(["content", "bin", "binaries", "win64", "win32", "win", "x64", "x86", "release", "debug", "game", "app", "application", "data", "build", "builds", "dist"]);
function _vlSpielName(_0xdir) {
  let cur = _0xdir;
  for (let i = 0; i < 3; i++) {
    const base = path.basename(cur);
    if (!base || /^[a-z]:[\\/]?$/i.test(cur)) break;
    if (!_VL_GENERIC_DIR.has(base.toLowerCase())) return base;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.basename(_0xdir);
}
function _vlTick() {
  return new Promise(r => setImmediate(r));
}
async function spieleTiefenScan(opts = {}) {
  const {
    roots = driveRoots(),
    extraRoots = [],
    maxDepth = 6,
    hardLimit = 260000,
    onProgress = null
  } = opts;
  const started = Date.now();
  let checked = 0;
  const spiele = [];
  const gesehen = new Set();
  const stapel = [];
  // Vom Nutzer/Launcher konfigurierte Ordner: deren DIREKTE Kinder sind Spiele -
  // egal ob Engine-Marker da ist. Das ist der Fix fuer "selbst installierte Spiele
  // werden nicht erkannt": zeigt Vystra auf den Install-Ordner des Launchers (den
  // dieser LOKAL speichert), gilt dort jeder Unterordner als Spiel.
  const _0xextraLower = new Set((extraRoots || []).map(r => String(r).toLowerCase().replace(/[\\/]+$/, "")));
  // extraRoots zuerst: sie liegen oft unter AppData, das der generische Scan meidet.
  for (const r of extraRoots) if (exists(r)) stapel.push({ dir: r, depth: 1 });
  for (const r of roots) if (exists(r)) stapel.push({ dir: r, depth: 0 });
  const emit = cur => {
    if (typeof onProgress !== "function") return;
    onProgress({ checked, hits: spiele.length, currentPath: cur, elapsedMs: Date.now() - started });
  };
  const merkeSpiel = (_0xordner, _0xexe, _0xart) => {
    // PyInstaller/Electron-Interna ("_internal" o. Ae.) sind keine Spiele.
    if (path.basename(_0xordner).toLowerCase().startsWith("_")) return;
    const key = String(_0xexe).toLowerCase();
    if (gesehen.has(key)) return;
    gesehen.add(key);
    spiele.push({ id: "vlg-" + _vlHash(_0xexe), name: _vlSpielName(_0xordner), exePath: _0xexe, ordner: _0xordner, art: _0xart || "spiel" });
  };
  while (stapel.length) {
    if (checked > hardLimit) break;
    const { dir, depth } = stapel.pop();
    const entries = safeReadDir(dir);
    checked++;
    if (checked % 300 === 0) {
      emit(dir);
      await _vlTick();
    }
    // Fall 1: Dieser Ordner ist ein DIREKTES Kind einer Bibliotheks-Wurzel
    // (z. B. "XboxGames\<X>", "steamapps\common\<X>", "itch\apps\<X>"). Dann ist der
    // GANZE Ordner ein Spiel: eine Haupt-.exe drin (auch in Unterordnern) genuegt,
    // und wir steigen NICHT weiter hinein - so bleibt ein Spiel EIN Eintrag.
    const _0xelternLower = path.dirname(dir).toLowerCase().replace(/[\\/]+$/, "");
    if (depth >= 1 && (_vlIstGamesRoot(dir) || _0xextraLower.has(_0xelternLower))) {
      const exe = _vlBesteExeIn(dir, entries, 0);
      // In einer Spiele-Wurzel entscheidet der App-Name (Marker bestaetigt Spiel).
      if (exe) merkeSpiel(dir, exe, _vlArtBestimmen(dir, exe, _vlHatMarker(entries)));
      continue;
    }
    // Fall 2: Der Ordner selbst traegt einen Engine-/Spiel-Marker und hat direkt
    // eine startbare .exe (faengt Spiele ausserhalb von Bibliotheks-Wurzeln, z. B.
    // ein Unity-Spiel irgendwo auf der Platte). Marker => Spiel, aber App-Namen
    // (z. B. "voicemod" mit einer .pck) trotzdem als Software fuehren.
    if (depth >= 1 && _vlHatMarker(entries)) {
      const exe = _vlBesteExeIn(dir, entries, 0);
      if (exe) {
        merkeSpiel(dir, exe, _vlArtBestimmen(dir, exe, true));
        continue;
      }
    }
    if (depth >= maxDepth) continue;
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const low = ent.name.toLowerCase();
      if (SKIP_DIR_NAMES.has(low)) continue;
      if (low.startsWith("$") || low.startsWith(".")) continue;
      stapel.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
    }
  }
  emit(null);
  spiele.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  return { ok: true, scannedAt: new Date().toISOString(), checked, spiele, abgebrochen: checked > hardLimit };
}

module.exports = {
  scanAll,
  deepScan,
  spieleTiefenScan,
  klassifiziereArt: _vlArtBestimmen,
  // Crowd-Detection
  expandEnv,
  detectSignature,
  detectCrowdLaunchers,
  findExePathInCommonLocations,
  launcherExePfadAufloesen,
  uninstallEintraegeLesen,
  // Adapter einzeln exportiert (Test / gezielte Nutzung)
  scanSteam,
  scanEpic,
  scanEA,
  scanUbisoft,
  scanGOG,
  scanGogGalaxyDb,
  scanItch,
  scanItchDb,
  scanXbox,
  // Helfer
  regQuery,
  regQueryTree,
  driveRoots,
  BASE_DICTIONARY
};
