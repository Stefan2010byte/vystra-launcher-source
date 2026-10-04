/**
 * Vystra Launcher — public review source
 * Copyright (c) 2026 Stefan Reibnegger (Vystra)
 * Author: Stefan Reibnegger
 * License: FSL-1.1-ALv2 (Functional Source License) — no competing commercial product.
 * Official binaries: https://github.com/Stefan2010byte/viscode-launcher
 * This copy has Vystra server APIs and the Vystra shop backend removed.
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  safeStorage,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  Notification,
  session,
  desktopCapturer,
  protocol,
  webContents,
  nativeTheme,
  screen
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
// Fuer die VR-LAN-Suche: UDP-Rundruf, damit die Quest den PC ohne IP-Eingabe findet.
const dgram = require("dgram");
const https = require("https");
// Fuer den lokalen Vystra-Launch-Handshake (127.0.0.1): sprachneutrale
// Bestaetigung an ein gestartetes Spiel/eine App, dass Vystra es gestartet hat.
const http = require("http");
const {
  execFile,
  spawn
} = require("child_process");
const IS_WIN = process.platform === "win32";
// ── Mini-Musik-Player: eigenes Protokoll für lokale Audiodateien ────────────
// Lokale Dateien lassen sich unter der CSP/webSecurity nicht per file:// abspielen.
// Deshalb ein privilegiertes Schema "vystra-audio://<absoluter Pfad>", das der
// Protokoll-Handler (in app.whenReady) auf die echte Datei mappt. MUSS vor
// app-ready registriert werden.
try {
  protocol.registerSchemesAsPrivileged([{
    scheme: "vystra-audio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false
    }
  }]);
} catch (_0xschemeErr) {
  console.log("[Music] Schema-Registrierung fehlgeschlagen:", _0xschemeErr && _0xschemeErr.message);
}
// Rein lokaler Multi-Launcher-Scanner (eigene Datei, keine Electron-Abhängigkeit).
const launcherScan = require("./launcherscan");
let _xboxScannerInst = null;
function xboxScanner() {
  if (!_xboxScannerInst) {
    _xboxScannerInst = require("./xboxscan")({ fetchJson, app, BrowserWindow, loadSettings, saveSettings });
  }
  return _xboxScannerInst;
}
let hardwareInfo = {
  totalRamGB: 0,
  gpuName: "",
  hasDedicated: false,
  aiCapable: true,
  checked: false
};
let geoCountryCache = null;
let mainWindow = null;
let steamLinkWindow = null;
let currentLinkPlatform = "steam";
let pendingDeepLink = null;
let tray = null;
let isQuitting = false;
// ── Sicherheits-Härtung ─────────────────────────────────────────────────────
// Feste Host-Allowlist für Auto-Updater-Downloads (NICHT aus Settings ableitbar!).
// PUBLIC REVIEW BUILD — by Stefan Reibnegger (2026)
// Vystra-eigene Server, Konto-API, Wallet und der eigene Shop sind hier entfernt.
// Offizielle Builds: https://github.com/Stefan2010byte/viscode-launcher
const PUBLIC_REVIEW_BUILD = true;
function vystraServerGesperrt(_0xurl) {
  const _0xu = String(_0xurl || "").toLowerCase();
  return !_0xu || _0xu.includes("removed.invalid");
}
const UPDATE_HOST_ALLOWLIST = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
// Sicherheitskritische Settings-Keys, die der Renderer NICHT überschreiben darf.
const PROTECTED_SETTINGS_KEYS = ["updateServerUrl", "apiBaseUrl", "gameBridgePort", "turnUrl", "turnUsername", "turnCredential"];
// ── Vystra Musik-Player: Download-Quellen ───────────────────────────────────
// Über settings.musicPlayerUrl überschreibbar; MUSIC_PLAYER_URL_FALLBACK greift,
// wenn die feste Version (404) nicht mehr existiert.
const MUSIC_PLAYER_URL_DEFAULT = "https://github.com/Stefan2010byte/viscode-launcher/releases/download/v2.1.2/VystraPlayer.zip";
const MUSIC_PLAYER_URL_FALLBACK = "https://github.com/Stefan2010byte/viscode-launcher/releases/latest/download/VystraPlayer.zip";
function hostAllowed(_0xurl, _0xlist) {
  try {
    const _0xh = new URL(String(_0xurl || "")).hostname.toLowerCase().replace(/\.$/, "");
    return _0xlist.some(_0xa => _0xh === _0xa || _0xh.endsWith("." + _0xa));
  } catch {
    return false;
  }
}
// Prüft, dass ein IPC-Aufruf von der eigenen Renderer-Seite (file://.../renderer/index.html) kommt.
function istEigenerRenderer(_0xevent) {
  try {
    let _0xu = "";
    if (_0xevent && _0xevent.senderFrame && _0xevent.senderFrame.url) {
      _0xu = _0xevent.senderFrame.url;
    } else if (_0xevent && _0xevent.sender && typeof _0xevent.sender.getURL === "function") {
      _0xu = _0xevent.sender.getURL();
    }
    if (!/^file:\/\//i.test(_0xu)) {
      return false;
    }
    const _0xp = decodeURIComponent(_0xu.split(/[?#]/)[0]).replace(/\\/g, "/").toLowerCase();
    return _0xp.endsWith("/renderer/index.html");
  } catch {
    return false;
  }
}
// Normalisiert einen Pfad für Vergleiche (absolut, forward-slashes, lowercase).
function normPathForCompare(_0xp) {
  try {
    return path.resolve(String(_0xp || "")).replace(/\\/g, "/").toLowerCase();
  } catch {
    return "";
  }
}
// Prüft, ob ein exePath zu einem bekannten (gespeicherten) Spiel gehört.
function istBekannterExePfad(_0xexe) {
  const _0xtarget = normPathForCompare(_0xexe);
  if (!_0xtarget) {
    return false;
  }
  const _0xexes = new Set();
  const _0xdirs = new Set();
  try {
    const _0xstore = loadManualStore();
    (_0xstore.games || []).forEach(_0xg => {
      if (_0xg && _0xg.exePath) {
        _0xexes.add(normPathForCompare(_0xg.exePath));
      }
      if (_0xg && _0xg.installPath) {
        _0xdirs.add(normPathForCompare(_0xg.installPath));
      }
    });
  } catch {}
  try {
    const _0xvc = loadSettings().vcInstalled || {};
    Object.values(_0xvc).forEach(_0xe => {
      if (_0xe && _0xe.exe) {
        _0xexes.add(normPathForCompare(_0xe.exe));
      }
      if (_0xe && _0xe.dir) {
        _0xdirs.add(normPathForCompare(_0xe.dir));
      }
    });
  } catch {}
  if (_0xexes.has(_0xtarget)) {
    return true;
  }
  for (const _0xd of _0xdirs) {
    if (_0xd && (_0xtarget === _0xd || _0xtarget.startsWith(_0xd.endsWith("/") ? _0xd : _0xd + "/"))) {
      return true;
    }
  }
  return false;
}
// SSRF-Schutz: private/loopback/link-local Ziele erkennen.
function istPrivaterHost(_0xhost) {
  const _0xh = String(_0xhost || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!_0xh) {
    return true;
  }
  if (_0xh === "localhost" || _0xh.endsWith(".localhost")) {
    return true;
  }
  if (_0xh === "::1" || _0xh === "::") {
    return true;
  }
  if (/^fe80:/i.test(_0xh) || /^f[cd][0-9a-f]{2}:/i.test(_0xh)) {
    return true;
  }
  const _0xm = _0xh.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (_0xm) {
    const _0xa = +_0xm[1];
    const _0xb = +_0xm[2];
    if (_0xa === 10 || _0xa === 127 || _0xa === 0) {
      return true;
    }
    if (_0xa === 169 && _0xb === 254) {
      return true;
    }
    if (_0xa === 172 && _0xb >= 16 && _0xb <= 31) {
      return true;
    }
    if (_0xa === 192 && _0xb === 168) {
      return true;
    }
    if (_0xa === 100 && _0xb >= 64 && _0xb <= 127) {
      return true;
    }
  }
  return false;
}
function createTray() {
  if (tray) {
    return;
  }
  try {
    let _0x408f08 = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
    if (!_0x408f08.isEmpty()) {
      _0x408f08 = _0x408f08.resize({
        width: 16,
        height: 16
      });
    }
    tray = new Tray(_0x408f08.isEmpty() ? nativeImage.createEmpty() : _0x408f08);
    tray.setToolTip("VisCode Launcher – läuft im Hintergrund");
    tray.setContextMenu(Menu.buildFromTemplate([{
      label: "VisCode Launcher öffnen",
      click: () => hauptfensterZeigen()
    }, {
      type: "separator"
    }, {
      label: "Beenden",
      click: () => {
        isQuitting = true;
        try {
          setPresence(false);
        } catch {}
        app.quit();
      }
    }]));
    tray.on("click", () => hauptfensterZeigen());
    tray.on("double-click", () => hauptfensterZeigen());
  } catch (_0x33ade0) {
    console.error("Tray konnte nicht erstellt werden:", _0x33ade0.message);
  }
}
function parseDeepLink(_0x240b6b) {
  if (!_0x240b6b || typeof _0x240b6b !== "string") {
    return null;
  }
  const _0x536cc4 = _0x240b6b.match(/viscode:\/\/([^\s"']+)/i);
  if (!_0x536cc4) {
    return null;
  }
  const _0x31933b = _0x536cc4[1].replace(/\/+$/, "").split("/").filter(Boolean);
  // Nativer Spielstart: viscode://launch/<gameId> -> loest die bestehende
  // Vystra-Start-Logik (launchVcGame) im Renderer aus. Zusaetzlicher Zweig,
  // der die vorhandenen game/-Faelle unangetastet laesst.
  if (_0x31933b[0] === "launch" && _0x31933b.length >= 2) {
    return {
      action: "launch",
      platform: "viscode",
      id: decodeURIComponent(_0x31933b[1])
    };
  }
  if (_0x31933b[0] !== "game") {
    return null;
  }
  if (_0x31933b.length >= 3) {
    return {
      platform: decodeURIComponent(_0x31933b[1]),
      id: decodeURIComponent(_0x31933b[2])
    };
  }
  if (_0x31933b.length === 2) {
    return {
      platform: "viscode",
      id: decodeURIComponent(_0x31933b[1])
    };
  }
  return null;
}
function findDeepLinkInArgv(_0x384524) {
  return (_0x384524 || []).find(_0x1e3b91 => typeof _0x1e3b91 === "string" && /^viscode:\/\//i.test(_0x1e3b91)) || null;
}
function dispatchDeepLink(_0x4aab28) {
  const _0x53f5b0 = parseDeepLink(_0x4aab28);
  if (!_0x53f5b0) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    try {
      mainWindow.webContents.send("deep-link", _0x53f5b0);
    } catch {}
  } else {
    pendingDeepLink = _0x53f5b0;
  }
  hauptfensterZeigen();
}
// Nach dem Schliessen bleibt mainWindow als zerstoertes Objekt stehen; jeder
// Methodenaufruf darauf wirft "Object has been destroyed" (z. B. Tray-Klick oder
// zweiter Start ueber die Verknuepfung). Dann das Fenster neu aufbauen.
function hauptfensterZeigen() {
  if (!app.isReady()) {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createWindow();
    return;
  }
  try {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  } catch {}
}
const defaultSettings = {
  apiBaseUrl: "https://removed.invalid",
  user: null,
  autoStartPlatforms: false,
  steamId64: "",
  steamApiKey: "",
  connectSteam: true,
  connectEpic: true,
  connectUbisoft: false,
  connectEA: false,
  epicClientId: "",
  epicClientSecret: "",
  epicDeploymentId: "",
  epicAccountId: "",
  epicDisplayName: "",
  epicAccessToken: "",
  epicRefreshToken: "",
  epicTokenExpiresAt: 0,
  connectGOG: false,
  gogAccessToken: "",
  gogRefreshToken: "",
  gogExpiresAt: 0,
  gogUserId: "",
  gogUsername: "",
  gogAvatar: "",
  gogGamesCache: null,
  ubisoftTicket: "",
  ubisoftProfileId: "",
  ubisoftName: "",
  ubisoftTicketAt: 0,
  firstRun: true,
  language: "de",
  fluxEnabled: false,
  fluxUrl: "http://127.0.0.1:7860",
  llamaEnabled: false,
  llamaUrl: "http://127.0.0.1:11434",
  llamaModel: "llama3.2-vision",
  gameBridgePort: 8448,
  turnUrl: "",
  turnUsername: "",
  turnCredential: "",
  updateServerUrl: "https://github.com/Stefan2010byte/viscode-launcher/releases/latest/download",
  autoUpdate: false,
  viscodeInfoUrl: "https://removed.invalid",
  viscodePublishers: ["pub_000009"],
  paymentUrl: "",
  publisherPortal: false,
  pubShowDevDetails: false,
  pubShowTestBuilds: false,
  libLandscape: false,
  dailyRewards: false,
  zwsoBanner: true,
  // Bewertungs-Popup: standardmäßig NUR ein einziges Mal (nach dem 2. Öffnen, nur neue Konten).
  // Mit feedbackAskOnUpdate=true fragt es zusätzlich nach jedem Update erneut.
  feedbackAskOnUpdate: false,
  // Spiele automatisch im Hintergrund aktualisieren (VisCode-Helper). Aus = manuell über den Button.
  vcAutoUpdate: true,
  // Quelle für die automatische Mitinstallation des Vystra Musik-Players (ZIP).
  musicPlayerUrl: MUSIC_PLAYER_URL_DEFAULT
};
async function checkHardware() {
  const _0x2493d = os.totalmem() / 1073741824;
  let _0x203961 = "";
  try {
    const _0x586948 = await psJson("Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name } | ConvertTo-Json -Compress");
    const _0x1adf68 = (_0x586948 || []).map(_0x518dcd => typeof _0x518dcd === "string" ? _0x518dcd : _0x518dcd && _0x518dcd.value || "").filter(Boolean);
    _0x203961 = _0x1adf68.find(_0x273990 => /nvidia|geforce|rtx|gtx|radeon|\bamd\b|arc/i.test(_0x273990)) || _0x1adf68[0] || "";
  } catch {}
  const _0x2a84ed = /nvidia|geforce|rtx|gtx|radeon|\bamd\b|arc/i.test(_0x203961);
  const _0x1dcccc = _0x2493d >= 15.5 && _0x2a84ed;
  hardwareInfo = {
    totalRamGB: Math.round(_0x2493d * 10) / 10,
    gpuName: _0x203961,
    hasDedicated: _0x2a84ed,
    aiCapable: _0x1dcccc,
    checked: true
  };
  return hardwareInfo;
}
function bannersDir() {
  const _0x2a050a = path.join(app.getPath("userData"), "banners");
  try {
    if (!fs.existsSync(_0x2a050a)) {
      fs.mkdirSync(_0x2a050a, {
        recursive: true
      });
    }
  } catch {}
  return _0x2a050a;
}
function bannerFile(_0x50faf7) {
  const _0x8ef911 = String(_0x50faf7).replace(/[^a-z0-9_-]/gi, "_").slice(0, 90);
  return path.join(bannersDir(), _0x8ef911 + ".png");
}
function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}
function socialPath() {
  return path.join(app.getPath("userData"), "viscode-social.enc");
}
function socialPathLegacy() {
  return path.join(app.getPath("userData"), "viscode-social.json");
}
const EMPTY_SOCIAL = {
  friends: [],
  requests: {
    incoming: [],
    outgoing: []
  },
  chats: {},
  groups: {}
};
function loadSocial() {
  try {
    if (fs.existsSync(socialPath()) && safeStorage.isEncryptionAvailable()) {
      const _0x4c182a = safeStorage.decryptString(fs.readFileSync(socialPath()));
      return JSON.parse(_0x4c182a);
    }
  } catch {}
  try {
    const _0x3b9702 = JSON.parse(fs.readFileSync(socialPathLegacy(), "utf8"));
    saveSocial(_0x3b9702);
    try {
      fs.unlinkSync(socialPathLegacy());
    } catch {}
    return _0x3b9702;
  } catch {
    return EMPTY_SOCIAL;
  }
}
function saveSocial(_0x3e6e72) {
  try {
    const _0x574538 = JSON.stringify(_0x3e6e72 || {});
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(socialPath(), safeStorage.encryptString(_0x574538));
      try {
        if (fs.existsSync(socialPathLegacy())) {
          fs.unlinkSync(socialPathLegacy());
        }
      } catch {}
    } else {
      fs.writeFileSync(socialPathLegacy(), JSON.stringify(_0x3e6e72 || {}, null, 2), "utf8");
    }
    return {
      ok: true
    };
  } catch (_0x1f1287) {
    return {
      ok: false,
      error: _0x1f1287.message
    };
  }
}
async function socialApi(_0x170667, _0x18834a, _0x5aac38) {
  if (typeof PUBLIC_REVIEW_BUILD !== "undefined" && PUBLIC_REVIEW_BUILD) {
    return { ok: false, offline: true, error: "Vystra server removed in public review source." };
  }
  const _0x49677f = loadSettings();
  const _0x10ef2e = (_0x49677f.apiBaseUrl || "").replace(/\/$/, "");
  // Auth-Endpoints, die absichtlich OHNE Token laufen (Pre-Login: Code prüfen, Passwort zurücksetzen).
  const _tokenlosOk = /^\/removed\b/.test(_0x18834a || "");
  if (!_0x10ef2e || !_0x49677f.sessionToken && !_tokenlosOk) {
    return {
      ok: false,
      offline: true
    };
  }
  try {
    const _0x2c138d = _0x10ef2e + _0x18834a;
    const _0x276d0a = await fetch(_0x2c138d, {
      method: _0x170667 || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(_0x49677f.sessionToken ? {
          Authorization: "Bearer " + _0x49677f.sessionToken
        } : {}),
        "X-Launcher-Version": app.getVersion(),
        "X-Vystra-Device": "pc",
        ...watermarkHeaders(_0x2c138d)
      },
      body: _0x5aac38 ? JSON.stringify(_0x5aac38) : undefined
    });
    if (_0x276d0a.status === 426) {
      notifyForceUpdate();
      return {
        ok: false,
        status: 426,
        upgradeRequired: true
      };
    }
    const _0x3ffc84 = await _0x276d0a.json().catch(() => null);
    return {
      ok: _0x276d0a.ok,
      status: _0x276d0a.status,
      data: _0x3ffc84
    };
  } catch {
    return {
      ok: false,
      offline: true
    };
  }
}
function familyStatusText(_0x370fb1) {
  if (_0x370fb1 === 401) {
    return "Nicht angemeldet – bitte neu anmelden.";
  }
  if (_0x370fb1 === 403) {
    return "Dazu bist du nicht berechtigt.";
  }
  if (_0x370fb1 === 404) {
    return "Familie oder Mitglied nicht gefunden.";
  }
  if (_0x370fb1 === 409) {
    return "Nicht möglich – die Familie ist voll oder der Platz ist schon belegt.";
  }
  return "Server-Fehler (HTTP " + (_0x370fb1 || 0) + ").";
}
async function familyApi(_0xa079fb, _0x38773b, _0x486335) {
  if (typeof PUBLIC_REVIEW_BUILD !== "undefined" && PUBLIC_REVIEW_BUILD) {
    return { ok: false, error: "Vystra server removed in public review source." };
  }
  let _0xc10408 = null;
  try {
    _0xc10408 = await socialApi(_0xa079fb, _0x38773b, _0x486335);
  } catch (_0x3196fa) {
    return {
      ok: false,
      error: _0x3196fa && _0x3196fa.message || "Anfrage fehlgeschlagen."
    };
  }
  if (!_0xc10408) {
    return {
      ok: false,
      error: "Keine Antwort vom Server."
    };
  }
  if (_0xc10408.offline) {
    return {
      ok: false,
      offline: true,
      error: "Server nicht erreichbar oder nicht angemeldet."
    };
  }
  if (_0xc10408.upgradeRequired) {
    return {
      ok: false,
      status: 426,
      error: "Launcher zu alt – bitte aktualisieren."
    };
  }
  const _0x24f8c3 = _0xc10408.data || null;
  if (!_0xc10408.ok || _0x24f8c3 && _0x24f8c3.ok === false) {
    return {
      ok: false,
      status: _0xc10408.status || 0,
      data: _0x24f8c3,
      error: _0x24f8c3 && (_0x24f8c3.error || _0x24f8c3.message) || familyStatusText(_0xc10408.status)
    };
  }
  return {
    ok: true,
    status: _0xc10408.status,
    data: _0x24f8c3
  };
}
let forceUpdateSent = false;
function notifyForceUpdate() {
  if (forceUpdateSent) {
    return;
  }
  forceUpdateSent = true;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("launcher:force-update");
    }
  } catch {}
}
const VIS_KEY = "VisCodeSeal·2026·Lizenz";
function visScramble(_0x62c787) {
  const _0x4fce9b = Buffer.from(_0x62c787, "utf8");
  const _0xd5dab1 = Buffer.alloc(_0x4fce9b.length);
  for (let _0x3b4214 = 0; _0x3b4214 < _0x4fce9b.length; _0x3b4214++) {
    _0xd5dab1[_0x3b4214] = _0x4fce9b[_0x3b4214] ^ VIS_KEY.charCodeAt(_0x3b4214 % VIS_KEY.length);
  }
  return _0xd5dab1.toString("base64").split("").reverse().join("");
}
function visUnscramble(_0x4219b9) {
  const _0x2bee16 = String(_0x4219b9).split("").reverse().join("");
  const _0x3d917b = Buffer.from(_0x2bee16, "base64");
  const _0x53e4e5 = Buffer.alloc(_0x3d917b.length);
  for (let _0x2d2a23 = 0; _0x2d2a23 < _0x3d917b.length; _0x2d2a23++) {
    _0x53e4e5[_0x2d2a23] = _0x3d917b[_0x2d2a23] ^ VIS_KEY.charCodeAt(_0x2d2a23 % VIS_KEY.length);
  }
  return _0x53e4e5.toString("utf8");
}
function visSeal(_0x4c753b) {
  return crypto.createHash("sha256").update((_0x4c753b.licenseKey || "") + "|" + (_0x4c753b.userId || "")).digest("hex");
}
function visEncode(_0x4f9f61) {
  const _0x54d7fe = visScramble(JSON.stringify(_0x4f9f61));
  const _0x1144e0 = _0x54d7fe.match(/.{1,72}/g) || [_0x54d7fe];
  return [";; VisLang Lizenz-Zertifikat — automatisch erzeugt, NICHT bearbeiten", "@vis 1", "@owner " + (_0x4f9f61.userId || ""), "@game " + (_0x4f9f61.gameId || ""), "@license " + (_0x4f9f61.licenseId || ""), "@seal " + visSeal(_0x4f9f61), "@ts " + Date.now(), ":body", ..._0x1144e0, ":end", ""].join("\n");
}
function visDecode(_0x40b802) {
  const _0x153a64 = String(_0x40b802).match(/:body\r?\n([\s\S]*?)\r?\n:end/);
  if (!_0x153a64) {
    return null;
  }
  try {
    return JSON.parse(visUnscramble(_0x153a64[1].replace(/\s+/g, "")));
  } catch {
    return null;
  }
}
function licensesDir() {
  const _0x1f8dae = path.join(app.getPath("userData"), "licenses");
  try {
    fs.mkdirSync(_0x1f8dae, {
      recursive: true
    });
  } catch {}
  return _0x1f8dae;
}
function loadSettings() {
  try {
    const _0x4cd092 = fs.readFileSync(settingsPath(), "utf8");
    const _0x195d07 = JSON.parse(_0x4cd092);
    if (_0x195d07.apiBaseUrl === "http://localhost:3000" || _0x195d07.apiBaseUrl === "https://viscode-ferryfy.ai.studio" || _0x195d07.apiBaseUrl === "https://sijuhguzrh848854drujifngiur888845hb830032022.ai.studio" || /player-admin-dashboard.*run\.app/.test(_0x195d07.apiBaseUrl || "")) {
      _0x195d07.apiBaseUrl = defaultSettings.apiBaseUrl;
    }
    if (!_0x195d07.updateServerUrl || _0x195d07.updateServerUrl === "http://127.0.0.1:8449") {
      _0x195d07.updateServerUrl = defaultSettings.updateServerUrl;
    }
    return {
      ...defaultSettings,
      ..._0x195d07
    };
  } catch {
    return {
      ...defaultSettings
    };
  }
}
function saveSettings(_0x177708) {
  fs.writeFileSync(settingsPath(), JSON.stringify(_0x177708, null, 2), "utf8");
}
let cachedHwid = null;
async function computeHwid() {
  if (cachedHwid) {
    return cachedHwid;
  }
  const _0x193167 = loadSettings();
  if (_0x193167.hwid) {
    cachedHwid = _0x193167.hwid;
    return cachedHwid;
  }
  let _0x3efdb7 = [];
  try {
    const _0x2889a5 = await psJson("$b=(Get-CimInstance Win32_BaseBoard).SerialNumber; $u=(Get-CimInstance Win32_ComputerSystemProduct).UUID; $c=(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId; [pscustomobject]@{b=$b;u=$u;c=$c} | ConvertTo-Json -Compress");
    const _0x3c0dc5 = _0x2889a5[0] || {};
    _0x3efdb7 = [_0x3c0dc5.b, _0x3c0dc5.u, _0x3c0dc5.c].filter(_0x5b0cbd => _0x5b0cbd && String(_0x5b0cbd).trim() && !/^0+$/.test(String(_0x5b0cbd)));
  } catch {}
  if (!_0x3efdb7.length) {
    const _0x16b68a = os.networkInterfaces();
    for (const _0x281d23 of Object.keys(_0x16b68a)) {
      for (const _0x5b5fc6 of _0x16b68a[_0x281d23]) {
        if (_0x5b5fc6.mac && _0x5b5fc6.mac !== "00:00:00:00:00:00") {
          _0x3efdb7.push(_0x5b5fc6.mac);
        }
      }
    }
    _0x3efdb7.push(os.hostname());
  }
  const _0x4c07e0 = crypto.createHash("sha256").update(_0x3efdb7.join("|")).digest("hex").slice(0, 32).toUpperCase();
  cachedHwid = "HWID_" + _0x4c07e0;
  _0x193167.hwid = cachedHwid;
  saveSettings(_0x193167);
  return cachedHwid;
}
let watermarkHwid = "";
function initWatermarkHwid() {
  computeHwid().then(_0x4707e9 => {
    watermarkHwid = String(_0x4707e9 || "").replace(/^HWID_/, "").slice(0, 16);
  }).catch(() => {});
}
function clientWatermark(_0x575e6f) {
  const _0x134ae9 = loadSettings();
  const _0x13f924 = {
    c: "VisCodeLauncher",
    v: app.getVersion()
  };
  const _0x23a6fe = _0x134ae9.user && (_0x134ae9.user.id || _0x134ae9.user.user_id);
  if (_0x23a6fe) {
    _0x13f924.u = String(_0x23a6fe);
  }
  const _0x2fdecd = _0x134ae9.user && (_0x134ae9.user.username || _0x134ae9.user.displayName);
  if (_0x2fdecd) {
    _0x13f924.n = String(_0x2fdecd);
  }
  if (watermarkHwid) {
    _0x13f924.h = watermarkHwid;
  }
  _0x13f924.o = currentPlatformId();
  _0x13f924.t = Math.floor(Date.now() / 1000);
  const _0x1e4828 = Object.keys(_0x134ae9.vcInstalled || {});
  if (_0x1e4828.length) {
    _0x13f924.g = _0x1e4828.length;
    _0x13f924.gh = crypto.createHash("sha256").update(_0x1e4828.slice().sort().join(",")).digest("hex").slice(0, 16);
  }
  if (_0x575e6f && _0x575e6f.k) {
    _0x13f924.k = String(_0x575e6f.k);
  }
  if (_0x575e6f && _0x575e6f.gid) {
    _0x13f924.gid = String(_0x575e6f.gid);
  }
  return Buffer.from(JSON.stringify(_0x13f924), "utf8").toString("base64url");
}
function isOwnApi(_0x4e5082) {
  try {
    const _0x2bb124 = new URL(String(loadSettings().apiBaseUrl || ""));
    const _0x150611 = new URL(String(_0x4e5082 || ""));
    return _0x150611.protocol === _0x2bb124.protocol && _0x150611.host === _0x2bb124.host;
  } catch {
    return false;
  }
}
function watermarkHeaders(_0x144081, _0x32356b) {
  if (typeof PUBLIC_REVIEW_BUILD !== "undefined" && PUBLIC_REVIEW_BUILD) {
    return {};
  }
  if (!isOwnApi(_0x144081)) {
    return {};
  }
  try {
    return {
      "X-VisCode-Client": clientWatermark(_0x32356b)
    };
  } catch {
    return {};
  }
}
function compareVersions(_0x29ee6d, _0x3eb3f9) {
  const _0x2da2d4 = String(_0x29ee6d || "0").split(".").map(_0x159a7e => parseInt(_0x159a7e, 10) || 0);
  const _0x2a652d = String(_0x3eb3f9 || "0").split(".").map(_0x2d608c => parseInt(_0x2d608c, 10) || 0);
  for (let _0xdc6c59 = 0; _0xdc6c59 < Math.max(_0x2da2d4.length, _0x2a652d.length); _0xdc6c59++) {
    const _0x26fdee = _0x2da2d4[_0xdc6c59] || 0;
    const _0x3f90c4 = _0x2a652d[_0xdc6c59] || 0;
    if (_0x26fdee > _0x3f90c4) {
      return 1;
    }
    if (_0x26fdee < _0x3f90c4) {
      return -1;
    }
  }
  return 0;
}
async function checkForUpdate() {
  const _0x5439ad = loadSettings();
  const _0x2fc760 = (_0x5439ad.updateServerUrl || "").replace(/\/$/, "");
  const _0x457cd2 = app.getVersion();
  if (!_0x2fc760) {
    return {
      available: false,
      current: _0x457cd2
    };
  }
  try {
    const _0x354eef = await fetchJson(_0x2fc760 + "/latest.json", {}, 6000);
    if (!_0x354eef || !_0x354eef.version || !_0x354eef.url) {
      return {
        available: false,
        current: _0x457cd2
      };
    }
    const _0x59fae7 = compareVersions(_0x354eef.version, _0x457cd2) > 0;
    const _0x5eb607 = _0x354eef.minVersion || _0x354eef.min_version || _0x354eef.minimumVersion || null;
    const _0x2d6e77 = !!_0x354eef.mandatory || !!_0x354eef.required || !!_0x354eef.force || !!_0x354eef.forceUpdate;
    const _0x2a69d2 = _0x5eb607 ? compareVersions(_0x457cd2, _0x5eb607) < 0 : _0x2d6e77;
    return {
      available: _0x59fae7,
      version: _0x354eef.version,
      url: _0x354eef.url,
      zipUrl: _0x354eef.zipUrl || "",
      notes: _0x354eef.notes || "",
      current: _0x457cd2,
      mandatory: _0x2a69d2,
      minVersion: _0x5eb607
    };
  } catch {
    return {
      available: false,
      current: _0x457cd2
    };
  }
}
// ── Vystra Musik-Player: Suche + Auto-Installation ──────────────────────────
// Alle Datei-Zugriffe laufen über original-fs (Electrons ungepatchtes fs), damit
// Pfade mit ".asar" im Namen nicht als Archiv behandelt werden.
function musicFs() {
  try {
    return require("original-fs");
  } catch {
    return fs;
  }
}
// Zielordner der automatisch mitinstallierten Fassung.
function musicInstallDir() {
  return path.join(app.getPath("userData"), "musik-player");
}
function musicExists(_0xp) {
  try {
    return !!_0xp && musicFs().existsSync(_0xp);
  } catch {
    return false;
  }
}
// Neueste Datei in einem Ordner, die auf das Muster passt.
function musicNewestIn(_0xdir, _0xrx) {
  try {
    const _0xofs = musicFs();
    const _0xhits = _0xofs.readdirSync(_0xdir).filter(_0xf => _0xrx.test(_0xf)).map(_0xf => {
      const _0xfull = path.join(_0xdir, _0xf);
      try {
        return {
          p: _0xfull,
          m: _0xofs.statSync(_0xfull).mtimeMs
        };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((_0xa, _0xb) => _0xb.m - _0xa.m);
    return _0xhits.length ? _0xhits[0].p : null;
  } catch {
    return null;
  }
}
// Sucht rekursiv (max. 2 Ebenen) nach einer .exe; "Vystra"/"Player" im Namen gewinnt,
// Deinstaller/Setup-Dateien werden abgewertet.
function musicFindExeInTree(_0xroot, _0xmaxDepth = 2) {
  const _0xofs = musicFs();
  const _0xhits = [];
  const _0xwalk = (_0xdir, _0xdepth) => {
    let _0xents = [];
    try {
      _0xents = _0xofs.readdirSync(_0xdir, {
        withFileTypes: true
      });
    } catch {
      return;
    }
    for (const _0xe of _0xents) {
      const _0xfull = path.join(_0xdir, _0xe.name);
      try {
        if (_0xe.isDirectory()) {
          if (_0xdepth < _0xmaxDepth) {
            _0xwalk(_0xfull, _0xdepth + 1);
          }
        } else if (/\.exe$/i.test(_0xe.name)) {
          const _0xn = _0xe.name.toLowerCase();
          let _0xscore = 0;
          if (_0xn.indexOf("vystra") >= 0) {
            _0xscore += 2;
          }
          if (_0xn.indexOf("player") >= 0) {
            _0xscore += 2;
          }
          if (/(unins|setup|install|crash|vcredist|elevate|squirrel)/i.test(_0xn)) {
            _0xscore -= 6;
          }
          _0xhits.push({
            p: _0xfull,
            s: _0xscore,
            d: _0xdepth
          });
        }
      } catch {}
    }
  };
  _0xwalk(_0xroot, 0);
  if (!_0xhits.length) {
    return null;
  }
  _0xhits.sort((_0xa, _0xb) => _0xb.s - _0xa.s || _0xa.d - _0xb.d || _0xa.p.length - _0xb.p.length);
  // Reine Deinstaller nie starten – sonst gewinnt der beste Treffer (auch ein Setup/Installer).
  if (/unins/i.test(path.basename(_0xhits[0].p))) {
    return null;
  }
  return _0xhits[0].p;
}
// Einzige Quelle der Wahrheit für "wo liegt der Player?" – von music:open und music:status genutzt.
function findMusicPlayerExe() {
  try {
    const _0xcfg = loadSettings();
    // 1) Vom Nutzer festgelegter / bei der Installation gemerkter Pfad
    if (musicExists(_0xcfg.musicPlayerPath)) {
      return _0xcfg.musicPlayerPath;
    }
    // 2) Klassisch installierte Fassung
    const _0xinst = [path.join(process.env.LOCALAPPDATA || "", "Programs", "Vystra Player", "Vystra Player.exe"), path.join(process.env.PROGRAMFILES || "", "Vystra Player", "Vystra Player.exe")];
    for (const _0xi of _0xinst) {
      if (_0xi && musicExists(_0xi)) {
        return _0xi;
      }
    }
    // 3) Portable/Build-Ordner (neueste Datei gewinnt)
    const _0xdirs = ["F:\\VystraMusik2\\fertig", "E:\\VystraMusik2\\fertig"];
    for (const _0xd of _0xdirs) {
      const _0xport = musicNewestIn(_0xd, /^VystraPlayer.*\.exe$/i);
      if (_0xport) {
        return _0xport;
      }
      const _0xunp = path.join(_0xd, "win-unpacked", "Vystra Player.exe");
      if (musicExists(_0xunp)) {
        return _0xunp;
      }
    }
    // 4) Automatisch mitinstallierte Fassung in userData/musik-player
    try {
      const _0xauto = musicFindExeInTree(musicInstallDir(), 2);
      if (_0xauto && musicExists(_0xauto)) {
        return _0xauto;
      }
    } catch {}
  } catch {}
  return null;
}
// Versionsangabe aus einer Release-URL ziehen ("…/download/v2.1.2/…" → "2.1.2").
function musicVersionFromUrl(_0xurl) {
  try {
    const _0xm = /\/download\/v?([0-9][\w.\-]*)\//i.exec(String(_0xurl || ""));
    return _0xm ? _0xm[1] : "";
  } catch {
    return "";
  }
}
// Fortschritt an den Renderer melden (gleiches Muster wie "update:progress").
function musicSendProgress(_0xdata) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("music:progress", _0xdata);
    }
  } catch {}
}
// ZIP herunterladen (mit Redirects, Host-Allowlist, Fortschritt in Bytes).
function musicDownloadZip(_0xurl, _0xdest, _0xonProgress) {
  const _0xofs = musicFs();
  return new Promise((_0xres, _0xrej) => {
    let _0xws = null;
    let _0xdone = false;
    const _0xcleanup = () => {
      try {
        if (_0xws) {
          _0xws.destroy();
        }
      } catch {}
      try {
        _0xofs.unlinkSync(_0xdest);
      } catch {}
    };
    const _0xfail = _0xerr => {
      if (_0xdone) {
        return;
      }
      _0xdone = true;
      _0xcleanup();
      _0xrej(_0xerr instanceof Error ? _0xerr : new Error(String(_0xerr)));
    };
    const _0xgo = (_0xu, _0xhop) => {
      let _0xreq = null;
      try {
        _0xreq = https.get(_0xu, {
          headers: {
            "User-Agent": "VisCodeLauncher",
            Accept: "application/octet-stream"
          }
        }, _0xresp => {
          if ([301, 302, 303, 307, 308].includes(_0xresp.statusCode) && _0xresp.headers.location && _0xhop < 6) {
            _0xresp.resume();
            let _0xnext = "";
            try {
              _0xnext = new URL(_0xresp.headers.location, _0xu).toString();
            } catch {
              return _0xfail(new Error("Ungültige Weiterleitung"));
            }
            if (!hostAllowed(_0xnext, UPDATE_HOST_ALLOWLIST)) {
              return _0xfail(new Error("Weiterleitung nicht erlaubt (Host nicht auf der Allowlist)"));
            }
            return _0xgo(_0xnext, _0xhop + 1);
          }
          if (_0xresp.statusCode !== 200) {
            const _0xe = new Error("HTTP " + _0xresp.statusCode);
            _0xe.status = _0xresp.statusCode;
            _0xresp.resume();
            return _0xfail(_0xe);
          }
          const _0xtotal = parseInt(_0xresp.headers["content-length"] || "0", 10) || 0;
          let _0xgot = 0;
          try {
            _0xws = _0xofs.createWriteStream(_0xdest);
          } catch (_0xwsErr) {
            _0xresp.resume();
            return _0xfail(_0xwsErr);
          }
          _0xws.on("error", _0xfail);
          _0xresp.on("error", _0xfail);
          _0xresp.on("data", _0xch => {
            _0xgot += _0xch.length;
            if (_0xonProgress) {
              try {
                _0xonProgress(_0xgot, _0xtotal);
              } catch {}
            }
          });
          _0xresp.pipe(_0xws);
          _0xws.on("finish", () => {
            if (_0xdone) {
              return;
            }
            _0xdone = true;
            try {
              _0xws.close(() => _0xres({
                bytes: _0xgot,
                total: _0xtotal
              }));
            } catch {
              _0xres({
                bytes: _0xgot,
                total: _0xtotal
              });
            }
          });
        });
      } catch (_0xgErr) {
        return _0xfail(_0xgErr);
      }
      try {
        _0xreq.setTimeout(90000, () => {
          try {
            _0xreq.destroy(new Error("Zeitüberschreitung beim Download"));
          } catch {}
        });
      } catch {}
      _0xreq.on("error", _0xfail);
    };
    _0xgo(_0xurl, 0);
  });
}
// ZIP entpacken – Windows via PowerShell Expand-Archive, sonst unzip/tar.
function musicExtractZip(_0xzip, _0xziel) {
  return new Promise((_0xres, _0xrej) => {
    if (IS_WIN) {
      // Einfache Anführungszeichen verdoppeln (PowerShell-Literal).
      const _0xq = _0xs => "'" + String(_0xs).replace(/'/g, "''") + "'";
      const _0xcmd = "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath " + _0xq(_0xzip) + " -DestinationPath " + _0xq(_0xziel) + " -Force";
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", _0xcmd], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      }, (_0xerr, _0xso, _0xse) => {
        if (_0xerr) {
          const _0xmsg = String(_0xse || _0xerr.message || _0xerr).trim().replace(/\s+/g, " ").slice(0, 220);
          return _0xrej(new Error(_0xmsg || "Entpacken fehlgeschlagen"));
        }
        _0xres();
      });
      return;
    }
    execFile("unzip", ["-o", _0xzip, "-d", _0xziel], _0xe1 => {
      if (!_0xe1) {
        return _0xres();
      }
      execFile("tar", ["-xf", _0xzip, "-C", _0xziel], _0xe2 => {
        if (!_0xe2) {
          return _0xres();
        }
        _0xrej(new Error("Entpacken wird auf diesem System nicht unterstützt"));
      });
    });
  });
}
let musicInstallLauft = null;
// Lädt die Player-ZIP, entpackt sie nach userData/musik-player und merkt die exe.
async function installMusicPlayer() {
  const _0xofs = musicFs();
  const _0xcfg = loadSettings();
  // Kandidaten-URLs: eigene Einstellung → Default → latest-Fallback
  const _0xurls = [];
  const _0xpush = _0xu => {
    const _0xs = String(_0xu || "").trim();
    if (_0xs && _0xurls.indexOf(_0xs) < 0) {
      _0xurls.push(_0xs);
    }
  };
  _0xpush(_0xcfg.musicPlayerUrl);
  _0xpush(MUSIC_PLAYER_URL_DEFAULT);
  _0xpush(MUSIC_PLAYER_URL_FALLBACK);
  const _0xerlaubt = _0xurls.filter(_0xu => hostAllowed(_0xu, UPDATE_HOST_ALLOWLIST));
  if (!_0xerlaubt.length) {
    return {
      ok: false,
      error: "Download-Quelle nicht erlaubt (Host nicht auf der Allowlist)."
    };
  }
  const _0xzip = path.join(app.getPath("temp"), "vystra-player.zip");
  const _0xziel = musicInstallDir();
  try {
    _0xofs.unlinkSync(_0xzip);
  } catch {}
  let _0xletzterFehler = "";
  let _0xgenutzt = "";
  let _0xok = false;
  for (const _0xu of _0xerlaubt) {
    try {
      let _0xlast = 0;
      musicSendProgress({
        phase: "download",
        pct: 0,
        done: 0,
        total: 0
      });
      await musicDownloadZip(_0xu, _0xzip, (_0xdone, _0xtotal) => {
        const _0xnow = Date.now();
        if (_0xnow - _0xlast < 300 && _0xtotal && _0xdone < _0xtotal) {
          return;
        }
        _0xlast = _0xnow;
        musicSendProgress({
          phase: "download",
          pct: _0xtotal ? Math.min(99, Math.floor(_0xdone / _0xtotal * 100)) : 0,
          done: _0xdone,
          total: _0xtotal
        });
      });
      _0xgenutzt = _0xu;
      _0xok = true;
      break;
    } catch (_0xdlErr) {
      _0xletzterFehler = _0xdlErr && _0xdlErr.message ? _0xdlErr.message : String(_0xdlErr);
      try {
        _0xofs.unlinkSync(_0xzip);
      } catch {}
    }
  }
  if (!_0xok) {
    return {
      ok: false,
      error: "Download fehlgeschlagen (" + (_0xletzterFehler || "unbekannt") + ")."
    };
  }
  // Zielordner leeren und neu anlegen
  try {
    _0xofs.rmSync(_0xziel, {
      recursive: true,
      force: true
    });
  } catch {}
  try {
    _0xofs.mkdirSync(_0xziel, {
      recursive: true
    });
  } catch (_0xmkErr) {
    try {
      _0xofs.unlinkSync(_0xzip);
    } catch {}
    return {
      ok: false,
      error: "Zielordner konnte nicht angelegt werden (" + (_0xmkErr && _0xmkErr.message || "keine Rechte") + ")."
    };
  }
  musicSendProgress({
    phase: "entpacken",
    pct: 100,
    done: 0,
    total: 0
  });
  try {
    await musicExtractZip(_0xzip, _0xziel);
  } catch (_0xexErr) {
    try {
      _0xofs.unlinkSync(_0xzip);
    } catch {}
    return {
      ok: false,
      error: _0xexErr && _0xexErr.message ? _0xexErr.message : "Entpacken fehlgeschlagen."
    };
  }
  try {
    _0xofs.unlinkSync(_0xzip);
  } catch {}
  const _0xexe = musicFindExeInTree(_0xziel, 2);
  if (!_0xexe) {
    return {
      ok: false,
      error: "Im Archiv wurde keine Player-Datei (.exe) gefunden."
    };
  }
  try {
    const _0xneu = loadSettings();
    _0xneu.musicPlayerPath = _0xexe;
    _0xneu.musicPlayerInstalledUrl = _0xgenutzt;
    _0xneu.musicPlayerInstalledAt = Date.now();
    saveSettings(_0xneu);
  } catch {}
  musicSendProgress({
    phase: "fertig",
    pct: 100,
    done: 0,
    total: 0
  });
  return {
    ok: true,
    exe: _0xexe,
    url: _0xgenutzt,
    version: musicVersionFromUrl(_0xgenutzt)
  };
}
function downloadFile(_0x497c33, _0x100064, _0x283199) {
  return new Promise((_0x1fcc62, _0x1cd827) => {
    const _0x41d432 = fs.createWriteStream(_0x100064);
    const _0x1c234a = (_0x1e9215, _0x254118 = 0) => {
      https.get(_0x1e9215, {
        headers: {
          "User-Agent": "VisCodeLauncher"
        }
      }, _0x156f98 => {
        if ([301, 302, 303, 307, 308].includes(_0x156f98.statusCode) && _0x156f98.headers.location && _0x254118 < 6) {
          _0x156f98.resume();
          return _0x1c234a(_0x156f98.headers.location, _0x254118 + 1);
        }
        if (_0x156f98.statusCode !== 200) {
          _0x41d432.close();
          try {
            fs.unlinkSync(_0x100064);
          } catch {}
          return _0x1cd827(new Error("HTTP " + _0x156f98.statusCode));
        }
        const _0x50d421 = parseInt(_0x156f98.headers["content-length"] || "0", 10);
        let _0x215da5 = 0;
        _0x156f98.on("data", _0x8ad097 => {
          _0x215da5 += _0x8ad097.length;
          if (_0x283199 && _0x50d421) {
            _0x283199(Math.round(_0x215da5 / _0x50d421 * 100));
          }
        });
        _0x156f98.pipe(_0x41d432);
        _0x41d432.on("finish", () => _0x41d432.close(() => _0x1fcc62(_0x100064)));
      }).on("error", _0x13652f => {
        try {
          fs.unlinkSync(_0x100064);
        } catch {}
        _0x1cd827(_0x13652f);
      });
    };
    _0x1c234a(_0x497c33);
  });
}
async function runZipUpdate(_0x1608ad) {
  if (!IS_WIN) {
    return runManualUpdateNotice();
  }
  if (!hostAllowed(_0x1608ad, UPDATE_HOST_ALLOWLIST)) {
    return {
      ok: false,
      error: "Update-Quelle nicht erlaubt (Host nicht auf der Allowlist)."
    };
  }
  const _0x3aecfc = app.getPath("temp");
  const _0x526f62 = Date.now();
  const _0x5a26d4 = path.join(_0x3aecfc, "viscode-update-" + _0x526f62 + ".zip");
  await downloadFile(_0x1608ad, _0x5a26d4, _0x391f3f => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:progress", _0x391f3f);
    }
  });
  const _0x50d3ce = app.getPath("exe");
  const _0x348c78 = path.dirname(_0x50d3ce);
  const _0x214f6c = path.basename(_0x50d3ce);
  const _0x369aa2 = path.join(_0x3aecfc, "viscode-update-" + _0x526f62 + ".bat");
  const _0x2962a7 = path.join(_0x3aecfc, "viscode-update-" + _0x526f62 + ".vbs");
  const _0x14880f = ["@echo off", ":wait", "tasklist /FI \"IMAGENAME eq " + _0x214f6c + "\" 2>nul | find /I \"" + _0x214f6c + "\" >nul", "if not errorlevel 1 (", "  ping -n 2 127.0.0.1 >nul", "  goto wait", ")", "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath '" + _0x5a26d4 + "' -DestinationPath '" + _0x348c78 + "' -Force\"", "start \"\" \"" + _0x50d3ce + "\"", "del \"" + _0x5a26d4 + "\" >nul 2>&1", "del \"" + _0x2962a7 + "\" >nul 2>&1", "(goto) 2>nul & del \"%~f0\""].join("\r\n");
  const _0x22d56f = "CreateObject(\"Wscript.Shell\").Run \"cmd /c \"\"" + _0x369aa2 + "\"\"\", 0, False\r\n";
  fs.writeFileSync(_0x369aa2, _0x14880f, "utf8");
  fs.writeFileSync(_0x2962a7, _0x22d56f, "utf8");
  spawn("wscript.exe", [_0x2962a7], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();
  setTimeout(() => app.quit(), 800);
  return {
    ok: true
  };
}
function runManualUpdateNotice() {
  try {
    shell.openExternal("https://github.com/Stefan2010byte/viscode-launcher/releases/latest");
  } catch {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:progress", {
        manual: true,
        done: true,
        message: "Automatisches Update unter Linux nicht verfügbar – bitte manuell aktualisieren."
      });
    }
  } catch {}
  return {
    ok: false,
    manual: true
  };
}
async function runUpdate(_0xe60c3c) {
  if (!IS_WIN) {
    return runManualUpdateNotice();
  }
  if (!hostAllowed(_0xe60c3c, UPDATE_HOST_ALLOWLIST)) {
    return {
      ok: false,
      error: "Update-Quelle nicht erlaubt (Host nicht auf der Allowlist)."
    };
  }
  try {
    if (/\.zip(\?|$)/i.test(_0xe60c3c || "")) {
      return await runZipUpdate(_0xe60c3c);
    }
    const _0x1324ca = path.join(app.getPath("temp"), "VisCode-Launcher-Update-Setup.exe");
    try {
      if (fs.existsSync(_0x1324ca)) {
        fs.unlinkSync(_0x1324ca);
      }
    } catch {}
    await downloadFile(_0xe60c3c, _0x1324ca, _0x3adf91 => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update:progress", _0x3adf91);
      }
    });
    spawn(_0x1324ca, [], {
      detached: true,
      stdio: "ignore"
    }).unref();
    setTimeout(() => app.quit(), 1200);
    return {
      ok: true
    };
  } catch (_0xcfc089) {
    return {
      ok: false,
      error: _0xcfc089.message
    };
  }
}
async function isGameRunning(_0x1f2da8) {
  if (!_0x1f2da8) {
    return {
      running: false
    };
  }
  const _0x1b56cb = (_0x1f2da8.exePath || "").toLowerCase();
  let _0x61d06e = (_0x1f2da8.installPath || "").toLowerCase();
  if (_0x61d06e && !_0x61d06e.endsWith("\\")) {
    _0x61d06e += "\\";
  }
  if (!_0x1b56cb && !_0x61d06e) {
    return {
      running: false
    };
  }
  if (!IS_WIN) {
    const _0x4c1a2b = path.basename(_0x1f2da8.exePath || _0x1f2da8.installPath || "");
    if (!_0x4c1a2b) {
      return {
        running: false
      };
    }
    return await new Promise(_0x2f8d10 => {
      execFile("pgrep", ["-f", _0x4c1a2b], (_0x1c9e44, _0x3b7a21) => {
        if (_0x1c9e44 || !_0x3b7a21 || !_0x3b7a21.trim()) {
          return _0x2f8d10({
            running: false
          });
        }
        const _0x51d0c2 = parseInt(_0x3b7a21.trim().split(/\s+/)[0], 10);
        _0x2f8d10({
          running: true,
          pid: _0x51d0c2 || undefined
        });
      });
    });
  }
  try {
    const _0x39050c = await psJson("Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress", 12000);
    for (const _0x16a92a of _0x39050c) {
      const _0x556676 = (_0x16a92a.ExecutablePath || "").toLowerCase();
      if (!_0x556676) {
        continue;
      }
      if (_0x1b56cb && _0x556676 === _0x1b56cb) {
        return {
          running: true,
          pid: _0x16a92a.ProcessId
        };
      }
      if (_0x61d06e && _0x556676.startsWith(_0x61d06e)) {
        return {
          running: true,
          pid: _0x16a92a.ProcessId
        };
      }
    }
  } catch {}
  return {
    running: false
  };
}
async function killGame(_0x30ccf7) {
  if (!_0x30ccf7) {
    return {
      ok: false
    };
  }
  const _0x312fb7 = (_0x30ccf7.exePath || "").toLowerCase();
  let _0x28b425 = (_0x30ccf7.installPath || "").toLowerCase();
  if (_0x28b425 && !_0x28b425.endsWith("\\")) {
    _0x28b425 += "\\";
  }
  if (!IS_WIN) {
    const _0x7e2c9d = path.basename(_0x30ccf7.exePath || _0x30ccf7.installPath || "");
    if (!_0x7e2c9d) {
      return {
        ok: false
      };
    }
    return await new Promise(_0x9a41f6 => {
      execFile("pkill", ["-f", _0x7e2c9d], _0x3d8e77 => {
        _0x9a41f6({
          ok: !_0x3d8e77
        });
      });
    });
  }
  try {
    const _0x4f7877 = await psJson("Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress", 12000);
    const _0x5b2717 = [];
    for (const _0x50f4d3 of _0x4f7877) {
      const _0x5a1f2d = (_0x50f4d3.ExecutablePath || "").toLowerCase();
      if (!_0x5a1f2d) {
        continue;
      }
      if (_0x312fb7 && _0x5a1f2d === _0x312fb7 || _0x28b425 && _0x5a1f2d.startsWith(_0x28b425)) {
        _0x5b2717.push(_0x50f4d3.ProcessId);
      }
    }
    for (const _0x495801 of _0x5b2717) {
      try {
        process.kill(_0x495801);
      } catch {}
    }
    return {
      ok: true,
      killed: _0x5b2717.length
    };
  } catch {
    return {
      ok: false
    };
  }
}
async function deviceInfo() {
  return {
    name: os.hostname() + " (" + os.platform() + " " + os.release() + ")",
    os: process.platform,
    hostname: os.hostname(),
    hwid: await computeHwid(),
    launcherVersion: app.getVersion(),
    // Geraetetyp fuer den Server: Desktop-Launcher = immer "pc"
    deviceType: "pc"
  };
}
const VISCODE_OAUTH_CLIENT = "viscode-launcher";
async function viscodeOauthLogin() {
  const _0x31536b = loadSettings();
  const _0x457ec1 = (_0x31536b.apiBaseUrl || "").replace(/\/$/, "");
  const _0x4bad1b = _0x457ec1 + "/oauth/done";
  const _0x5e99a4 = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const _0x463a26 = _0x457ec1 + "/oauth/authorize?" + new URLSearchParams({
    client_id: VISCODE_OAUTH_CLIENT,
    response_type: "code",
    redirect_uri: _0x4bad1b,
    state: _0x5e99a4
  }).toString();
  return await echterBrowserLogin({
    url: _0x463a26,
    titel: "Mit VisCode anmelden",
    trefferPruefung: _0xu => _0xu.startsWith(_0x4bad1b),
    codeHolen: async _0x48f870 => {
      let _0x19c92c = null;
      let _0x1359b1 = null;
      let _0xstate = null;
      try {
        const _0x2fd8dc = new URL(_0x48f870);
        _0x19c92c = _0x2fd8dc.searchParams.get("code");
        _0xstate = _0x2fd8dc.searchParams.get("state");
        _0x1359b1 = _0x2fd8dc.searchParams.get("error_description") || _0x2fd8dc.searchParams.get("error");
      } catch {}
      if (_0x1359b1 && !_0x19c92c) {
        throw new Error(_0x1359b1);
      }
      // Im echten Browser kann ein alter /oauth/done-Tab offen sein: nur der Code
      // aus DIESEM Anmeldevorgang (gleiches state) zaehlt.
      if (!_0x19c92c || _0xstate && _0xstate !== _0x5e99a4) {
        return null;
      }
      {
        const _0x4edd09 = await fetch(_0x457ec1 + "/removed", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...watermarkHeaders(_0x457ec1 + "/removed")
          },
          body: JSON.stringify({
            client_id: VISCODE_OAUTH_CLIENT,
            grant_type: "authorization_code",
            code: _0x19c92c,
            redirect_uri: _0x4bad1b
          })
        });
        const _0x3c848b = await _0x4edd09.json().catch(() => null);
        const _0x3f1273 = _0x3c848b && (_0x3c848b.token || _0x3c848b.session_token || _0x3c848b.access_token);
        if (!_0x3f1273) {
          throw new Error(_0x3c848b && (_0x3c848b.error || _0x3c848b.message) || "Kein Token vom Server erhalten.");
        }
        const _0x328c22 = loadSettings();
        _0x328c22.sessionToken = _0x3f1273;
        _0x328c22.user = _0x3c848b.user || _0x328c22.user;
        saveSettings(_0x328c22);
        if (!_0x328c22.user || !_0x328c22.user.id) {
          try {
            const _0x4081ed = await fetchJson(_0x457ec1 + "/removed", {
              headers: {
                Authorization: "Bearer " + _0x3f1273
              }
            }, 10000);
            if (_0x4081ed && (_0x4081ed.id || _0x4081ed.username)) {
              _0x328c22.user = _0x4081ed;
              saveSettings(_0x328c22);
            }
          } catch {}
        }
        return {
          ok: true,
          user: loadSettings().user
        };
      }
    }
  });
}
// Öffnet eine URL im ECHTEN Browser (Edge/Chrome) im App-Modus mit eigenem, dauerhaftem
// Profil – für Google-Dienste (YouTube/Gmail …), die eingebettete Webviews beim Login blocken.
function findAppBrowser() {
  if (IS_WIN) {
    const _0xpf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const _0xpf = process.env["ProgramFiles"] || "C:\\Program Files";
    const _0xlad = process.env["LOCALAPPDATA"] || "";
    const _0xcands = [path.join(_0xpf86, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(_0xpf, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(_0xpf86, "Google", "Chrome", "Application", "chrome.exe"), path.join(_0xpf, "Google", "Chrome", "Application", "chrome.exe"), _0xlad ? path.join(_0xlad, "Google", "Chrome", "Application", "chrome.exe") : ""];
    for (const _0xc of _0xcands) {
      try {
        if (_0xc && fs.existsSync(_0xc)) {
          return _0xc;
        }
      } catch (_0xe) {}
    }
    return null;
  }
  for (const _0xb of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"]) {
    try {
      if (fs.existsSync(_0xb)) {
        return _0xb;
      }
    } catch (_0xe2) {}
  }
  return null;
}
function openAppBrowser(_0xurl) {
  if (typeof _0xurl !== "string" || !/^https?:\/\//i.test(_0xurl)) {
    return { ok: false, error: "Ungültige URL" };
  }
  const _0xexe = findAppBrowser();
  const _0xprofile = path.join(app.getPath("userData"), "webprofiles", "google");
  try {
    fs.mkdirSync(_0xprofile, { recursive: true });
  } catch (_0xe3) {}
  if (!_0xexe) {
    shell.openExternal(_0xurl);
    return { ok: true, appMode: false };
  }
  try {
    spawn(_0xexe, ["--app=" + _0xurl, "--user-data-dir=" + _0xprofile], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return { ok: true, appMode: true };
  } catch (_0xe4) {
    shell.openExternal(_0xurl);
    return { ok: false, appMode: false, error: _0xe4 && _0xe4.message };
  }
}
// ── Web zu App ───────────────────────────────────────────────────────────────
// Öffnet eine URL in einem eigenen, app-artigen Electron-Fenster (pro URL wiederverwendet).
const webAppWindows = new Map();
function parseWebAppArg(_0xargv) {
  const _0xhit = (_0xargv || []).find(_0xa => typeof _0xa === "string" && /^--webapp=/i.test(_0xa));
  if (!_0xhit) {
    return null;
  }
  let _0xurl = _0xhit.slice(_0xhit.indexOf("=") + 1).trim();
  if (_0xurl.length >= 2 && _0xurl.startsWith("\"") && _0xurl.endsWith("\"")) {
    _0xurl = _0xurl.slice(1, -1);
  }
  return /^https?:\/\//i.test(_0xurl) ? _0xurl : null;
}
// .vybg-Datei (Vystra-Hintergrund) aus den Startargumenten holen
function parseVybgArg(_0xargv) {
  const _0xlist = _0xargv || [];
  for (const _0xa of _0xlist) {
    if (typeof _0xa !== "string" || _0xa.startsWith("--")) {
      continue;
    }
    let _0xpth = _0xa.trim();
    if (_0xpth.length >= 2 && _0xpth.startsWith("\"") && _0xpth.endsWith("\"")) {
      _0xpth = _0xpth.slice(1, -1);
    }
    if (!/.vybg$/i.test(_0xpth)) {
      continue;
    }
    try {
      if (fs.existsSync(_0xpth) && fs.statSync(_0xpth).isFile()) {
        return _0xpth;
      }
    } catch {}
  }
  return null;
}
// Wartet, bis der Renderer bereit ist, und schiebt die Datei dann rueber
let _pendingVybg = null;
function deliverVybg(_0xfile) {
  if (!_0xfile) {
    return;
  }
  let _0xdata;
  try {
    if (fs.statSync(_0xfile).size > 40 * 1024 * 1024) {
      return;
    }
    _0xdata = {
      content: fs.readFileSync(_0xfile, "utf8"),
      filename: path.basename(_0xfile)
    };
  } catch {
    return;
  }
  const _0xsend = () => {
    try {
      mainWindow.webContents.send("bg:open-vybg", _0xdata);
    } catch {}
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", () => setTimeout(_0xsend, 800));
    } else {
      setTimeout(_0xsend, 300);
    }
    try {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    } catch {}
  } else {
    _pendingVybg = _0xdata;
  }
}
function openWebAppWindow(_0xurl, _0xname, _0xicon) {
  if (typeof _0xurl !== "string" || !/^https?:\/\//i.test(_0xurl)) {
    return {
      ok: false,
      error: "Ungültige URL"
    };
  }
  const _0xkey = _0xurl;
  const _0xexist = webAppWindows.get(_0xkey);
  if (_0xexist && !_0xexist.isDestroyed()) {
    if (_0xexist.isMinimized()) {
      _0xexist.restore();
    }
    _0xexist.show();
    _0xexist.focus();
    return {
      ok: true,
      reused: true
    };
  }
  let _0xicoImg = null;
  try {
    if (_0xicon && /^data:image\//i.test(_0xicon)) {
      const _0ximg = nativeImage.createFromDataURL(_0xicon);
      if (_0ximg && !_0ximg.isEmpty()) {
        _0xicoImg = _0ximg;
      }
    }
  } catch {
    _0xicoImg = null;
  }
  let _0xwin;
  try {
    _0xwin = new BrowserWindow({
      width: 1200,
      height: 800,
      title: _0xname || _0xurl,
      autoHideMenuBar: true,
      backgroundColor: "#0d1117",
      ...(_0xicoImg ? {
        icon: _0xicoImg
      } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: "persist:webapps"
      }
    });
  } catch (_0xe) {
    return {
      ok: false,
      error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
    };
  }
  webAppWindows.set(_0xkey, _0xwin);
  _0xwin.on("closed", () => {
    if (webAppWindows.get(_0xkey) === _0xwin) {
      webAppWindows.delete(_0xkey);
    }
  });
  if (_0xname) {
    _0xwin.on("page-title-updated", _0xev => {
      _0xev.preventDefault();
      try {
        _0xwin.setTitle(_0xname);
      } catch {}
    });
  }
  try {
    _0xwin.webContents.setWindowOpenHandler(({
      url: _0xu
    }) => {
      if (/^https?:\/\//i.test(_0xu)) {
        shell.openExternal(_0xu);
      }
      return {
        action: "deny"
      };
    });
  } catch {}
  _0xwin.loadURL(_0xurl);
  return {
    ok: true
  };
}
// Baut aus einem PNG-Buffer eine gültige .ico-Datei (PNG eingebettet, Windows Vista+).
function pngBufferToIco(_0xpng) {
  let _0xw = 0;
  let _0xh = 0;
  try {
    if (_0xpng.length > 24 && _0xpng.readUInt32BE(0) === 0x89504e47) {
      _0xw = _0xpng.readUInt32BE(16);
      _0xh = _0xpng.readUInt32BE(20);
    }
  } catch {}
  const _0xhdr = Buffer.alloc(6);
  _0xhdr.writeUInt16LE(0, 0);
  _0xhdr.writeUInt16LE(1, 2);
  _0xhdr.writeUInt16LE(1, 4);
  const _0xentry = Buffer.alloc(16);
  _0xentry.writeUInt8(_0xw >= 256 ? 0 : _0xw, 0);
  _0xentry.writeUInt8(_0xh >= 256 ? 0 : _0xh, 1);
  _0xentry.writeUInt8(0, 2);
  _0xentry.writeUInt8(0, 3);
  _0xentry.writeUInt16LE(1, 4);
  _0xentry.writeUInt16LE(32, 6);
  _0xentry.writeUInt32LE(_0xpng.length, 8);
  _0xentry.writeUInt32LE(22, 12);
  return Buffer.concat([_0xhdr, _0xentry, _0xpng]);
}
function _0xwebAppAttr(_0xtag, _0xname) {
  const _0xm = _0xtag.match(new RegExp(_0xname + "\\s*=\\s*[\"']([^\"']+)[\"']", "i"));
  return _0xm ? _0xm[1] : "";
}
function _0xwebAppMeta(_0xhtml, _0xprop) {
  let _0xm = _0xhtml.match(new RegExp("<meta[^>]+(?:property|name)\\s*=\\s*[\"']" + _0xprop + "[\"'][^>]*content\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
  if (_0xm) {
    return _0xm[1];
  }
  _0xm = _0xhtml.match(new RegExp("<meta[^>]+content\\s*=\\s*[\"']([^\"']*)[\"'][^>]*(?:property|name)\\s*=\\s*[\"']" + _0xprop + "[\"']", "i"));
  return _0xm ? _0xm[1] : "";
}
function _0xdecodeEntities(_0xs) {
  return String(_0xs || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0*39;/g, "'").replace(/&#x27;/gi, "'").replace(/&#(\d+);/g, (_0x0, _0xn) => {
    try {
      return String.fromCodePoint(parseInt(_0xn, 10));
    } catch {
      return _0x0;
    }
  }).trim();
}
const WEBAPP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
async function fetchWebAppIcon(_0xcands, _0xbase) {
  for (const _0xc of _0xcands) {
    let _0xabs = "";
    try {
      _0xabs = new URL(_0xc, _0xbase).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(_0xabs)) {
      continue;
    }
    try {
      const _0xic = new AbortController();
      const _0xit = setTimeout(() => _0xic.abort(), 6000);
      let _0xir;
      try {
        _0xir = await fetch(_0xabs, {
          redirect: "follow",
          signal: _0xic.signal,
          headers: {
            "User-Agent": WEBAPP_UA
          }
        });
      } finally {
        clearTimeout(_0xit);
      }
      if (!_0xir || !_0xir.ok) {
        continue;
      }
      const _0xct = (_0xir.headers.get("content-type") || "").toLowerCase();
      const _0xbuf = Buffer.from(await _0xir.arrayBuffer());
      if (!_0xbuf.length || _0xbuf.length > 2 * 1024 * 1024) {
        continue;
      }
      let _0xmime = (_0xct.split(";")[0] || "").trim();
      if (!/^image\//.test(_0xmime)) {
        const _0xext = (_0xabs.split("?")[0].match(/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i) || [])[1];
        if (!_0xext) {
          continue;
        }
        const _0xl = _0xext.toLowerCase();
        _0xmime = "image/" + (_0xl === "svg" ? "svg+xml" : _0xl === "jpg" ? "jpeg" : _0xl === "ico" ? "x-icon" : _0xl);
      }
      return "data:" + _0xmime + ";base64," + _0xbuf.toString("base64");
    } catch {
      continue;
    }
  }
  return "";
}
// ── Web-App-Standalone: Pfad zur Template-.exe auflösen ─────────────────────
// Der fertige Stub liegt im Repo unter webapp-template/VystraWebApp.exe. Im
// gepackten Build muss webapp-template via extraResources mitgeliefert werden
// (KEINE Build-Config hier ändern – nur dieser Hinweis). Fallback = resources.
function webAppTemplateExe() {
  const _0xc = [];
  try {
    _0xc.push(path.join(app.getAppPath(), "webapp-template", "VystraWebApp.exe"));
  } catch {}
  try {
    if (process.resourcesPath) {
      _0xc.push(path.join(process.resourcesPath, "webapp-template", "VystraWebApp.exe"));
    }
  } catch {}
  try {
    _0xc.push(path.join(path.dirname(process.execPath), "webapp-template", "VystraWebApp.exe"));
  } catch {}
  try {
    _0xc.push(path.join(__dirname, "webapp-template", "VystraWebApp.exe"));
  } catch {}
  for (const _0xp of _0xc) {
    try {
      if (_0xp && fs.existsSync(_0xp)) {
        return _0xp;
      }
    } catch {}
  }
  try {
    const _0xcs = path.join(__dirname, "webapp-template", "VystraWebApp.cs");
    const _0xout = path.join(__dirname, "webapp-template", "VystraWebApp.exe");
    if (fs.existsSync(_0xcs) && !fs.existsSync(_0xout)) {
      const _0xcsc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
      if (fs.existsSync(_0xcsc)) {
        const { spawnSync } = require("child_process");
        spawnSync(_0xcsc, ["/nologo", "/t:winexe", "/out:" + _0xout, _0xcs], {
          windowsHide: true,
          timeout: 20000
        });
        if (fs.existsSync(_0xout)) {
          return _0xout;
        }
      }
    }
  } catch {}
  return "";
}
function copyWebStubToDesktop(_0xname, _0xurl, _0xicon) {
  const _0xtpl = webAppTemplateExe();
  if (!_0xtpl) {
    return {
      ok: false,
      error: "Vorlage VystraWebApp.exe nicht gefunden."
    };
  }
  const _0xsafe = String(_0xname || "WebApp").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "WebApp";
  const _0xdir = path.join(app.getPath("desktop"), _0xsafe);
  try {
    fs.mkdirSync(_0xdir, {
      recursive: true
    });
  } catch (_0xe) {
    return {
      ok: false,
      error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
    };
  }
  const _0xexePath = path.join(_0xdir, _0xsafe + ".exe");
  try {
    fs.copyFileSync(_0xtpl, _0xexePath);
    fs.writeFileSync(path.join(_0xdir, "url.txt"), String(_0xurl || "").trim() + "\n", "utf8");
  } catch (_0xe) {
    return {
      ok: false,
      error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
    };
  }
  try {
    const _0xadbSrc = path.join(path.dirname(_0xtpl), "adblock");
    if (fs.existsSync(_0xadbSrc)) {
      fs.cpSync(_0xadbSrc, path.join(_0xdir, "adblock"), {
        recursive: true
      });
    }
  } catch {}
  return {
    ok: true,
    path: _0xexePath,
    folder: _0xdir
  };
}
// ── Ad-Blocker fuer interne <webview>-Websites ──────────────────────────────
// Blockt Werbe-/Tracker-Requests direkt auf Session-Ebene (webRequest); Muster
// aus der mitgelieferten adblock/rules.json (Fallback: eingebaute Top-Domains).
// Chrome-UA (Login-Kompatibilitaet) + Marker "Vystra" am Ende, damit der Server
// die Launcher-Webview erkennt (UA-Gate fuer /app/*-Seiten, sucht electron/vystra/viscode).
const WEBVIEW_CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Vystra";
// YouTube-Ad-Skip: laeuft in der eingebetteten Webview (Domain-Block geht bei YT
// nicht, weil Ads von denselben Servern wie das Video kommen). Klickt "Ueberspringen",
// spult unueberspringbare Ads ans Ende, blendet Werbe-Elemente aus.
const YT_ADSKIP_JS = "(function(){if(window.__vystraYtAdskip)return;window.__vystraYtAdskip=true;window.__vystraYtmLast=0;" +
  "try{var s=document.createElement('style');s.textContent='#player-ads,#masthead-ad,.ytp-ad-overlay-container,.ytp-ad-overlay-slot,.ytd-display-ad-renderer,.ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-banner-promo-renderer,.ytp-featured-product{display:none!important;}';(document.head||document.documentElement).appendChild(s);}catch(e){}" +
  "var isMusic=location.hostname.indexOf('music.youtube.com')!==-1;" +
  // YT Music: Werbung laesst sich NICHT ans Ende spulen (server-gated). Trick:
  // bei laufender Werbung 'Weiter' -> kurz warten -> 'Zurueck' klicken. Der Song
  // wird dann ohne Ad neu geladen (Ads sind client-seitig zwischen Tracks).
  "function ytmSkip(){try{var now=Date.now();if(now-window.__vystraYtmLast<1800)return;window.__vystraYtmLast=now;" +
  "var nx=document.querySelector('.ytmusic-player-bar .next-button,tp-yt-paper-icon-button.next-button,ytmusic-player-bar .next-button');" +
  "var pv=document.querySelector('.ytmusic-player-bar .previous-button,tp-yt-paper-icon-button.previous-button,ytmusic-player-bar .previous-button');" +
  "if(nx){nx.click();if(pv){setTimeout(function(){try{pv.click();}catch(e){}},350);}}}catch(e){}}" +
  "function tick(){try{var b=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button');if(b){b.click();}" +
  "var p=document.querySelector('.html5-video-player');var adOn=p&&p.classList.contains('ad-showing');" +
  "if(adOn){if(isMusic){ytmSkip();}else{var v=document.querySelector('video');if(v&&isFinite(v.duration)&&v.duration>0){v.currentTime=v.duration;try{v.play();}catch(e){}}}}}catch(e){}}" +
  "setInterval(tick,400);tick();})();";
let _adBlockDomainsCache = null;
function adBlockDomains() {
  if (_adBlockDomainsCache) return _adBlockDomainsCache;
  let _0xdoms = [];
  try {
    const _0xtpl = webAppTemplateExe();
    if (_0xtpl) {
      const _0xrf = path.join(path.dirname(_0xtpl), "adblock", "rules.json");
      if (fs.existsSync(_0xrf)) {
        const _0xrules = JSON.parse(fs.readFileSync(_0xrf, "utf8"));
        for (const _0xr of _0xrules) {
          const _0xuf = _0xr && _0xr.condition && _0xr.condition.urlFilter;
          if (typeof _0xuf === "string") {
            const _0xm = _0xuf.match(/^\|\|([^\^\/]+)/);
            if (_0xm) _0xdoms.push(_0xm[1].toLowerCase());
          }
        }
      }
    }
  } catch {}
  // Zusaetzliche haeufige Ad-/SSP-Domains (auch fuer Browsergame-Portale wie 1001spiele).
  const _0xextra = ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com", "googletagmanager.com", "google-analytics.com", "adnxs.com", "adnxs-simple.com", "rubiconproject.com", "pubmatic.com", "openx.net", "criteo.com", "criteo.net", "taboola.com", "outbrain.com", "smartadserver.com", "adform.net", "casalemedia.com", "contextweb.com", "3lift.com", "sharethrough.com", "indexww.com", "yieldmo.com", "amazon-adsystem.com", "adsafeprotected.com", "moatads.com", "doubleverify.com", "adsrvr.org", "bidswitch.net", "serving-sys.com", "teads.tv", "media.net", "adservice.google.com", "adservice.google.de", "prebid.org", "id5-sync.com", " adsystem.com", "onetag-sys.com", "adtelligent.com", "gumgum.com", "improvedigital.com", "smartclip.net", "stroeerdigitalgroup.de", "stroeer.de", "yieldlab.net", "emetriq.de", "adition.com", "theadex.com", "meetrics.net", "ad-srv.net", "quantcount.com", "quantserve.com", "scorecardresearch.com", "propellerads.com", "popads.net", "adsterra.com", "exoclick.com"];
  for (const _0xe of _0xextra) { const _0xc = _0xe.trim(); if (_0xc && _0xdoms.indexOf(_0xc) < 0) _0xdoms.push(_0xc); }
  _adBlockDomainsCache = _0xdoms;
  return _0xdoms;
}
function _isAdHost(_0xhost) {
  _0xhost = String(_0xhost || "").toLowerCase();
  for (const _0xd of adBlockDomains()) {
    if (_0xhost === _0xd || _0xhost.endsWith("." + _0xd)) return true;
  }
  return false;
}
const _adBlockedSessions = new WeakSet();
function installAdBlock(_0xses) {
  try {
    if (!_0xses || _adBlockedSessions.has(_0xses)) return;
    _adBlockedSessions.add(_0xses);
    _0xses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (_0xdet, _0xcb) => {
      try {
        if (_isAdHost(new URL(_0xdet.url).hostname)) { _0xcb({ cancel: true }); return; }
      } catch (e) {}
      _0xcb({});
    });
  } catch (e) {}
}
// ── Web-App: Medien (Logo/Banner/Bild) in einen Ordner sichern ──────────────
// Nimmt entweder eine data:-URL oder eine http(s)-URL, speichert die Bytes als
// Datei im Ziel-Ordner und liefert { dataUrl, file }. dataUrl wird nur bis zu
// _0xmax Bytes zurückgegeben (sonst bleibt die Original-URL als Anzeigequelle),
// damit die settings.json nicht explodiert. Alles defensiv – nie werfen.
async function webAppSaveMedia(_0xsrc, _0xdir, _0xstem, _0xmax) {
  const _0xlimit = typeof _0xmax === "number" && _0xmax > 0 ? _0xmax : 1500000;
  try {
    if (typeof _0xsrc !== "string" || !_0xsrc) {
      return null;
    }
    let _0xmime = "";
    let _0xbuf = null;
    if (/^data:image\//i.test(_0xsrc)) {
      const _0xm = _0xsrc.match(/^data:([^;,]+)[^,]*,(.*)$/i);
      if (!_0xm) {
        return null;
      }
      _0xmime = (_0xm[1] || "").toLowerCase();
      _0xbuf = /;base64/i.test(_0xsrc) ? Buffer.from(_0xm[2], "base64") : Buffer.from(decodeURIComponent(_0xm[2]), "utf8");
    } else if (/^https?:\/\//i.test(_0xsrc)) {
      const _0xic = new AbortController();
      const _0xit = setTimeout(() => _0xic.abort(), 8000);
      let _0xir;
      try {
        _0xir = await fetch(_0xsrc, {
          redirect: "follow",
          signal: _0xic.signal,
          headers: {
            "User-Agent": WEBAPP_UA
          }
        });
      } finally {
        clearTimeout(_0xit);
      }
      if (!_0xir || !_0xir.ok) {
        return null;
      }
      _0xmime = ((_0xir.headers.get("content-type") || "").split(";")[0] || "").trim().toLowerCase();
      _0xbuf = Buffer.from(await _0xir.arrayBuffer());
    } else {
      return null;
    }
    if (!_0xbuf || !_0xbuf.length || _0xbuf.length > 6 * 1024 * 1024) {
      return null;
    }
    if (!/^image\//.test(_0xmime)) {
      const _0xext2 = (String(_0xsrc).split("?")[0].match(/\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i) || [])[1];
      const _0xl2 = _0xext2 ? _0xext2.toLowerCase() : "png";
      _0xmime = "image/" + (_0xl2 === "svg" ? "svg+xml" : _0xl2 === "jpg" ? "jpeg" : _0xl2 === "ico" ? "x-icon" : _0xl2);
    }
    const _0xsub = _0xmime.split("/")[1] || "png";
    const _0xext = _0xsub === "svg+xml" ? "svg" : _0xsub === "jpeg" ? "jpg" : _0xsub === "x-icon" ? "ico" : _0xsub;
    let _0xfile = "";
    try {
      _0xfile = path.join(_0xdir, _0xstem + "." + _0xext);
      fs.writeFileSync(_0xfile, _0xbuf);
    } catch {
      _0xfile = "";
    }
    const _0xdataUrl = _0xbuf.length <= _0xlimit ? "data:" + _0xmime + ";base64," + _0xbuf.toString("base64") : /^https?:\/\//i.test(_0xsrc) ? _0xsrc : "";
    return {
      dataUrl: _0xdataUrl,
      file: _0xfile
    };
  } catch {
    return null;
  }
}
function regQuery(_0x3d936b, _0x45f18d) {
  if (!IS_WIN) {
    return Promise.resolve(null);
  }
  return new Promise(_0x5cae44 => {
    execFile("reg", ["query", _0x3d936b, "/v", _0x45f18d], {
      windowsHide: true
    }, (_0x307605, _0x4c5669) => {
      if (_0x307605 || !_0x4c5669) {
        return _0x5cae44(null);
      }
      const _0x101a31 = _0x4c5669.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
      _0x5cae44(_0x101a31 ? _0x101a31[1].trim() : null);
    });
  });
}
async function fetchJson(_0x4e2957, _0x6924cb = {}, _0x92ae12 = 6000) {
  // Public review copy (Stefan Reibnegger): no calls to the removed Vystra backend.
  if (typeof PUBLIC_REVIEW_BUILD !== "undefined" && PUBLIC_REVIEW_BUILD && typeof vystraServerGesperrt === "function" && vystraServerGesperrt(_0x4e2957)) {
    return null;
  }
  const _0x227c6f = new AbortController();
  const _0xf7ad03 = setTimeout(() => _0x227c6f.abort(), _0x92ae12);
  const {
    wm: _0x91471d,
    ..._0x1ed58c
  } = _0x6924cb;
  const _0x52ee09 = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...(_0x1ed58c.headers || {})
  };
  delete _0x52ee09["X-VisCode-Client"];
  Object.assign(_0x52ee09, watermarkHeaders(_0x4e2957, _0x91471d));
  try {
    const _0x5db138 = await fetch(_0x4e2957, {
      ..._0x1ed58c,
      headers: _0x52ee09,
      signal: _0x227c6f.signal
    });
    if (!_0x5db138.ok) {
      return null;
    }
    return await _0x5db138.json();
  } catch {
    return null;
  } finally {
    clearTimeout(_0xf7ad03);
  }
}
// ── GeForce NOW: oeffentliche Liste der unterstuetzten Spiele ────────────────
// Rein oeffentliche Metadaten (kein Login, kein Token, kein AGB-Bruch). NVIDIA
// stellt die Liste als statische JSON bereit. 24h lokal gecacht (RAM + Platte),
// damit nicht bei jeder Anzeige neu geladen wird. Jeder Eintrag traegt store und
// - bei Steam - die appid aus steamUrl; damit matchen wir EXAKT gegen die
// erkannten Spiele, statt Titel zu raten.
let gfnCache = null;
let gfnCacheZeit = 0;
const GFN_URL = "https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-de-DE.json";
const GFN_CACHE_MS = 24 * 60 * 60 * 1000;
function gfnAppidAusUrl(_0xurl) {
  const _0xm = /store\.steampowered\.com\/app\/(\d+)/i.exec(String(_0xurl || ""));
  return _0xm ? _0xm[1] : "";
}
async function gfnListeHolen() {
  const _0xnow = Date.now();
  if (gfnCache && _0xnow - gfnCacheZeit < GFN_CACHE_MS) {
    return gfnCache;
  }
  const _0xdatei = path.join(app.getPath("userData"), "gfn-liste.json");
  // Platten-Cache zuerst (ueberlebt Neustarts, spart den 400-KB-Download).
  if (!gfnCache) {
    try {
      const _0xroh = JSON.parse(fs.readFileSync(_0xdatei, "utf8"));
      if (_0xroh && Array.isArray(_0xroh.spiele) && _0xnow - (_0xroh.zeit || 0) < GFN_CACHE_MS) {
        gfnCache = _0xroh.spiele;
        gfnCacheZeit = _0xroh.zeit || _0xnow;
        return gfnCache;
      }
    } catch {}
  }
  const _0xdaten = await fetchJson(GFN_URL, {}, 20000);
  if (!Array.isArray(_0xdaten)) {
    // Netzfehler: lieber alten Cache behalten als nichts.
    return gfnCache || [];
  }
  const _0xkompakt = _0xdaten.map(_0xg => ({
    id: _0xg.id,
    title: _0xg.title || "",
    store: _0xg.store || "",
    appid: gfnAppidAusUrl(_0xg.steamUrl),
    status: _0xg.status || ""
  }));
  gfnCache = _0xkompakt;
  gfnCacheZeit = _0xnow;
  try {
    fs.writeFileSync(_0xdatei, JSON.stringify({
      zeit: _0xnow,
      spiele: _0xkompakt
    }), "utf8");
  } catch {}
  return gfnCache;
}
// ── Absturzmeldung ──────────────────────────────────────────────────────────
// Fassung 2.3.0 startete bei ALLEN Nutzern nicht mehr (fehlende Datei im
// Paket) und Stefan erfuhr davon erst, weil ein Kumpel geschrieben hat: der
// Launcher starb bis dahin wortlos. Ab hier wird jeder unbehandelte Fehler
// lokal protokolliert und - wenn Netz da ist - gemeldet.
// Oberste Regel fuer diesen ganzen Abschnitt: der Absturzmelder darf NIEMALS
// selbst werfen. Sonst ersetzt er einen sichtbaren Absturz durch einen
// zweiten, von dem erst recht niemand erfaehrt. Deshalb ueberall try/catch.
const ABSTURZ_MELDE_URL = "";
const ABSTURZ_LOG_MAX = 1024 * 1024; // ab 1 MB wird gekuerzt ...
const ABSTURZ_LOG_REST = 200 * 1024; // ... auf die letzten ~200 KB
// Bereits verschickte Signaturen dieses Programmlaufs. Eine Fehlerschleife
// (z.B. ein Intervall, das jede Sekunde wirft) wuerde den Server sonst fluten
// und der echte Fehler ginge in tausend gleichen Meldungen unter.
const gesendeteAbstuerze = new Set();
let absturzDialogOffen = false;
function absturzLogPfad() {
  try {
    return path.join(app.getPath("userData"), "abstuerze.log");
  } catch {
    return "";
  }
}
// Entfernt den Windows-Benutzernamen aus Pfaden in einer Fehlerspur.
// Warum: eine Node-Spur enthaelt fast immer C:\Users\<Klarname>\... - der
// Klarname des Nutzers geht niemanden etwas an und darf den Rechner gar
// nicht erst verlassen.
function spurEntschaerfen(text) {
  try {
    let s = String(text == null ? "" : text);
    let benutzername = "";
    try {
      benutzername = String((os.userInfo() || {}).username || "").trim();
    } catch {}
    // REIHENFOLGE IST WICHTIG: erst ganze Pfadsegmente, dann der Name.
    // Andersherum bleibt ein Rest stehen - aus "/home/stefan" wird
    // "/home/<benutzer>n", weil die Muster "<" und ">" ausschliessen und
    // den bereits gesetzten Platzhalter nicht mehr aufraeumen koennen.
    s = s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n"'<>|]+/gi, "$1<benutzer>");
    s = s.replace(/(\/home\/)[^/\r\n"'<>|]+/g, "$1<benutzer>");
    s = s.replace(/(\/Users\/)[^/\r\n"'<>|]+/g, "$1<benutzer>");
    // Danach noch freistehende Vorkommen des Namens, etwa in einer Meldung
    // ohne Pfad. Sehr kurze Namen ("a") wuerden quer durch die Spur alles
    // zerschiessen, deshalb erst ab drei Zeichen.
    if (benutzername.length >= 3) {
      const maskiert = benutzername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      s = s.replace(new RegExp(maskiert, "gi"), "<benutzer>");
    }
    return s;
  } catch {
    return "";
  }
}
// Lokales Protokoll. Muss auch ohne Netz funktionieren - beim Startfehler von
// 2.3.0 war das die einzige Spur, die es ueberhaupt haette geben koennen.
function absturzProtokollieren(art, meldung, spur) {
  try {
    const datei = absturzLogPfad();
    if (!datei) {
      return;
    }
    try {
      const stat = fs.statSync(datei);
      if (stat.size > ABSTURZ_LOG_MAX) {
        // Nur den Schwanz behalten: eine Fehlerschleife schreibt sonst ueber
        // Nacht die Platte des Nutzers voll. Alte Eintraege sind laengst raus.
        const griff = fs.openSync(datei, "r");
        const puffer = Buffer.alloc(ABSTURZ_LOG_REST);
        fs.readSync(griff, puffer, 0, ABSTURZ_LOG_REST, stat.size - ABSTURZ_LOG_REST);
        fs.closeSync(griff);
        fs.writeFileSync(datei, "[gekuerzt]\n" + puffer.toString("utf8"), "utf8");
      }
    } catch {}
    // Alles in EINE Zeile, damit die Datei zeilenweise auswertbar bleibt.
    const zeile = [new Date().toISOString(), String(art || "?"), String(meldung || "").replace(/[\r\n]+/g, " "), String(spur || "").replace(/[\r\n]+/g, " | ")].join(" | ");
    fs.appendFileSync(datei, zeile + "\n", "utf8");
  } catch {}
}
// Gleiche Bildung wie im Melde-Server, damit lokal und dort dasselbe
// zusammengefasst wird: Art + Meldung + erste Zeile der Spur.
function absturzSignatur(art, meldung, spur) {
  try {
    const zeilen = String(spur || "").split(/\r?\n/);
    const erste = (zeilen[0] || "").trim();
    return crypto.createHash("sha256").update(String(art) + "|" + String(meldung) + "|" + erste).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}
function absturzMelden(daten) {
  try {
    const art = String(daten && daten.art || "unbekannt").slice(0, 32);
    const meldung = String(daten && daten.meldung || "").slice(0, 500);
    const spur = spurEntschaerfen(daten && daten.spur || "").slice(0, 4000);
    // Erst schreiben, dann senden: das Protokoll ist der Teil, der immer klappt.
    absturzProtokollieren(art, meldung, spur);
    const signatur = absturzSignatur(art, meldung, spur);
    if (signatur) {
      if (gesendeteAbstuerze.has(signatur)) {
        return;
      }
      gesendeteAbstuerze.add(signatur);
    }
    let benutzer = "";
    try {
      const einstellungen = loadSettings();
      benutzer = String(einstellungen.user && (einstellungen.user.username || einstellungen.user.displayName) || "").slice(0, 64);
    } catch {}
    let version = "";
    try {
      version = String(app.getVersion() || "").slice(0, 32);
    } catch {}
    let betriebssystem = "";
    try {
      betriebssystem = (process.platform + " " + os.release()).slice(0, 32);
    } catch {}
    const abbruch = new AbortController();
    const uhr = setTimeout(() => {
      try {
        abbruch.abort();
      } catch {}
    }, 8000);
    // Fehler beim Senden werden STILL verschluckt: wer gerade einen Absturz
    // vor sich hat, braucht nicht zusaetzlich eine Netzwerkfehlermeldung.
    fetch(ABSTURZ_MELDE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: version,
        os: betriebssystem,
        art: art,
        meldung: meldung,
        spur: spur,
        benutzer: benutzer
      }),
      signal: abbruch.signal
    }).catch(() => {}).finally(() => {
      try {
        clearTimeout(uhr);
      } catch {}
    });
  } catch {}
}
function absturzDialogZeigen() {
  if (absturzDialogOffen) {
    return;
  }
  absturzDialogOffen = true;
  let fensterDa = false;
  try {
    fensterDa = app.isReady() && !!mainWindow && !mainWindow.isDestroyed();
  } catch {}
  if (!fensterDa) {
    // Faellt der Fehler ganz frueh an (genau der 2.3.0-Fall: fehlende Datei
    // im Paket), gibt es noch kein Fenster. Ein Dialog ohne Fenster laesst
    // den Prozess unsichtbar haengen - lieber die kurze Frist fuer das
    // Absenden abwarten und dann sauber beenden.
    setTimeout(() => {
      try {
        app.exit(1);
      } catch {
        process.exit(1);
      }
    }, 2000);
    return;
  }
  try {
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Vystra Launcher",
      message: "Ein unerwarteter Fehler ist aufgetreten.",
      detail: "Der Fehler wurde automatisch gemeldet, damit er behoben werden kann. Du kannst den Launcher neu starten oder beenden.",
      buttons: ["Neu starten", "Beenden"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(antwort => {
      if (antwort && antwort.response === 0) {
        try {
          app.relaunch();
        } catch {}
        app.exit(0);
      } else {
        app.exit(1);
      }
    }).catch(() => {
      try {
        app.exit(1);
      } catch {}
    });
  } catch {
    try {
      app.exit(1);
    } catch {}
  }
}
// Ohne diesen Haken beendet Node/Electron den Prozess bei einem unbehandelten
// Fehler wortlos - genau das Verhalten, das 2.3.0 so lange unentdeckt liess.
process.on("uncaughtException", fehler => {
  try {
    absturzMelden({
      art: "hauptprozess",
      meldung: fehler && fehler.message || String(fehler),
      spur: fehler && fehler.stack || ""
    });
  } catch {}
  try {
    absturzDialogZeigen();
  } catch {
    try {
      app.exit(1);
    } catch {}
  }
});
// Bewusst OHNE Dialog: ein nicht abgefangenes Promise legt den Launcher in
// aller Regel nicht lahm. Melden reicht; den Nutzer dafuer zu unterbrechen
// waere unverhaeltnismaessig und wuerde bei Netzproblemen staendig nerven.
process.on("unhandledRejection", grund => {
  try {
    absturzMelden({
      art: "promise",
      meldung: grund && grund.message || String(grund),
      spur: grund && grund.stack || ""
    });
  } catch {}
});
// Renderer weg = weisses Fenster. Der Nutzer sieht "kaputt", der Hauptprozess
// laeuft weiter und wuerde ohne diesen Haken nichts davon melden.
app.on("render-process-gone", (ereignis, webContents, details) => {
  try {
    absturzMelden({
      art: "renderer-weg",
      meldung: "render-process-gone: " + (details && details.reason || "unbekannt"),
      spur: "exitCode=" + (details && details.exitCode != null ? details.exitCode : "?")
    });
  } catch {}
  oberflaecheWiederherstellen(webContents, details);
});
// Nach einem Renderer-Absturz bleibt sonst ein leeres Fenster stehen. Neu laden,
// aber begrenzt: stuerzt die Seite sofort wieder ab, kein Endlos-Kreislauf.
const _rendererNeustarts = [];
function oberflaecheWiederherstellen(_0xwc, _0xdetails) {
  const _0xgrund = _0xdetails && _0xdetails.reason;
  if (!_0xwc || _0xgrund === "clean-exit" || isQuitting) {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== _0xwc) {
    return;
  }
  const _0xjetzt = Date.now();
  while (_rendererNeustarts.length && _0xjetzt - _rendererNeustarts[0] > 5 * 60 * 1000) {
    _rendererNeustarts.shift();
  }
  if (_rendererNeustarts.length >= 3) {
    return;
  }
  _rendererNeustarts.push(_0xjetzt);
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !_0xwc.isDestroyed()) {
        _0xwc.reload();
      }
    } catch {}
  }, 1000);
}
app.on("child-process-gone", (ereignis, details) => {
  try {
    absturzMelden({
      art: "kindprozess-weg",
      meldung: "child-process-gone: " + (details && details.type || "?") + " / " + (details && details.reason || "unbekannt"),
      spur: "name=" + (details && details.name || "") + " exitCode=" + (details && details.exitCode != null ? details.exitCode : "?")
    });
  } catch {}
});
// Cache für die Crowd-Launcher-Erkennung (~5 min).
let crowdLauncherCache = null;
let crowdLauncherCacheTime = 0;
const CROWD_CACHE_MS = 5 * 60 * 1000;
const PLATFORM_IDS = {
  win32: "windows",
  darwin: "macos",
  linux: "linux"
};
function currentPlatformId() {
  return PLATFORM_IDS[process.platform] || "windows";
}
function withPlatform(_0x536296, _0xb803a) {
  if (!_0x536296) {
    return _0x536296;
  }
  if (/[?&]platform=/.test(_0x536296)) {
    return _0x536296;
  }
  return _0x536296 + (_0x536296.includes("?") ? "&" : "?") + "platform=" + encodeURIComponent(_0xb803a || currentPlatformId());
}
let platformListCache = null;
const STEAM_IGNORE = new Set(["228980", "1070560", "1391110", "1826330", "2348590"]);
const BUILTIN_STEAM_API_KEY = "";
function effectiveSteamKey(_0x526bed) {
  return (_0x526bed && _0x526bed.steamApiKey || "").trim() || BUILTIN_STEAM_API_KEY;
}
async function findSteamPath() {
  const _0x51987a = [];
  const _0x87c1e7 = [["HKCU\\Software\\Valve\\Steam", "SteamPath"], ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"], ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]];
  for (const [_0x136168, _0x3fa650] of _0x87c1e7) {
    const _0x47dedc = await regQuery(_0x136168, _0x3fa650);
    if (_0x47dedc) {
      _0x51987a.push(_0x47dedc.replace(/\//g, "\\"));
    }
  }
  if (IS_WIN) {
    for (const _0x351ee7 of ["C", "D", "E", "F", "G", "H"]) {
      _0x51987a.push(_0x351ee7 + ":\\Program Files (x86)\\Steam");
      _0x51987a.push(_0x351ee7 + ":\\Program Files\\Steam");
      _0x51987a.push(_0x351ee7 + ":\\Steam");
    }
  } else {
    const _0x9d0b1a = os.homedir();
    _0x51987a.push(path.join(_0x9d0b1a, ".steam", "steam"));
    _0x51987a.push(path.join(_0x9d0b1a, ".steam", "root"));
    _0x51987a.push(path.join(_0x9d0b1a, ".local", "share", "Steam"));
    _0x51987a.push(path.join(_0x9d0b1a, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"));
  }
  const _0x1dc5d6 = new Set();
  for (const _0x1b8358 of _0x51987a) {
    if (!_0x1b8358 || _0x1dc5d6.has(_0x1b8358.toLowerCase())) {
      continue;
    }
    _0x1dc5d6.add(_0x1b8358.toLowerCase());
    try {
      if (fs.existsSync(path.join(_0x1b8358, "steam.exe")) || fs.existsSync(path.join(_0x1b8358, "steamapps"))) {
        return _0x1b8358;
      }
    } catch {}
  }
  return null;
}
function parseVdfValue(_0x40e9cf, _0x4ee9d1) {
  const _0xe2ca8e = new RegExp("\"" + _0x4ee9d1 + "\"\\s+\"((?:[^\"\\\\]|\\\\.)*)\"", "i");
  const _0x2c4d9e = _0x40e9cf.match(_0xe2ca8e);
  if (_0x2c4d9e) {
    return _0x2c4d9e[1].replace(/\\\\/g, "\\");
  } else {
    return null;
  }
}
function steamLibraries(_0x3dc222) {
  const _0x3e3ce3 = new Set([_0x3dc222]);
  const _0x330f25 = path.join(_0x3dc222, "steamapps", "libraryfolders.vdf");
  try {
    const _0x29f2ce = fs.readFileSync(_0x330f25, "utf8");
    const _0x2600db = /"path"\s+"((?:[^"\\]|\\.)*)"/gi;
    let _0x5287b0;
    while ((_0x5287b0 = _0x2600db.exec(_0x29f2ce)) !== null) {
      _0x3e3ce3.add(_0x5287b0[1].replace(/\\\\/g, "\\"));
    }
  } catch {}
  return [..._0x3e3ce3].filter(_0x2865a9 => fs.existsSync(_0x2865a9));
}
async function scanSteam() {
  const _0x382163 = await findSteamPath();
  if (!_0x382163) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  const _0x325f46 = [];
  const _0x1a6ee4 = new Set();
  for (const _0x3bce97 of steamLibraries(_0x382163)) {
    const _0x10a52c = path.join(_0x3bce97, "steamapps");
    let _0x929223 = [];
    try {
      _0x929223 = fs.readdirSync(_0x10a52c);
    } catch {
      continue;
    }
    for (const _0x3e880f of _0x929223) {
      if (!/^appmanifest_\d+\.acf$/i.test(_0x3e880f)) {
        continue;
      }
      try {
        const _0x1bcdda = fs.readFileSync(path.join(_0x10a52c, _0x3e880f), "utf8");
        const _0x3b8adc = parseVdfValue(_0x1bcdda, "appid");
        const _0x499c5a = parseVdfValue(_0x1bcdda, "name");
        if (!_0x3b8adc || !_0x499c5a || STEAM_IGNORE.has(_0x3b8adc) || _0x1a6ee4.has(_0x3b8adc)) {
          continue;
        }
        _0x1a6ee4.add(_0x3b8adc);
        const _0x473260 = parseVdfValue(_0x1bcdda, "installdir");
        const _0x198a5d = parseInt(parseVdfValue(_0x1bcdda, "SizeOnDisk") || "0", 10);
        _0x325f46.push({
          platform: "steam",
          id: _0x3b8adc,
          title: _0x499c5a,
          sizeBytes: _0x198a5d,
          installPath: _0x473260 ? path.join(_0x10a52c, "common", _0x473260) : null,
          image: "https://cdn.cloudflare.steamstatic.com/steam/apps/" + _0x3b8adc + "/header.jpg"
        });
      } catch {}
    }
  }
  _0x325f46.sort((_0x2dacd7, _0x1dea06) => _0x2dacd7.title.localeCompare(_0x1dea06.title, "de"));
  return {
    installed: true,
    path: _0x382163,
    games: _0x325f46
  };
}
// ── Vystra VR: SteamVR-Status + VR-Spiele-Erkennung ─────────────────────────
// SteamVR hat auf Steam die App-ID 250820.
const VR_STEAMVR_APPID = "250820";
// Kleine eingebaute Liste bekannter VR-App-IDs (Titel als Fallback, falls kein
// appmanifest-Name vorliegt). Ergänzt die OpenVR-DLL-Heuristik.
const VR_KNOWN_APPIDS = new Map([["546560", "Half-Life: Alyx"], ["620980", "Beat Saber"], ["555160", "Pavlov VR"], ["629730", "Blade and Sorcery"], ["823500", "BONEWORKS"], ["438100", "VRChat"], ["450390", "The Lab"], ["617830", "SUPERHOT VR"], ["496240", "Onward"]]);
// Prüft (rekursiv, max. 2 Ebenen tief), ob im Spielordner eine openvr_api.dll liegt.
function vrHatOpenVrDll(_0xdir, _0xtiefe = 0) {
  if (!_0xdir || _0xtiefe > 2) {
    return false;
  }
  let _0xeintraege;
  try {
    _0xeintraege = fs.readdirSync(_0xdir, {
      withFileTypes: true
    });
  } catch {
    return false;
  }
  const _0xunterordner = [];
  for (const _0xe of _0xeintraege) {
    try {
      if (_0xe.isFile() && _0xe.name.toLowerCase() === "openvr_api.dll") {
        return true;
      }
      if (_0xe.isDirectory()) {
        _0xunterordner.push(_0xe.name);
      }
    } catch {}
  }
  if (_0xtiefe < 2) {
    for (const _0xsub of _0xunterordner) {
      if (vrHatOpenVrDll(path.join(_0xdir, _0xsub), _0xtiefe + 1)) {
        return true;
      }
    }
  }
  return false;
}
// Läuft SteamVR? (vrmonitor.exe oder vrserver.exe im Prozessbaum)
function vrLaeuftSteamVr() {
  return new Promise(_0x60fe2b => {
    if (!IS_WIN) {
      // Nicht-Windows: kein zuverlässiger tasklist-Weg → konservativ false.
      return _0x60fe2b(false);
    }
    try {
      execFile("tasklist", ["/FI", "IMAGENAME eq vrmonitor.exe", "/FI", "IMAGENAME eq vrserver.exe", "/NH"], {
        windowsHide: true
      }, (_0x1e4b7c, _0x2f9a11) => {
        if (_0x1e4b7c || !_0x2f9a11) {
          return _0x60fe2b(false);
        }
        _0x60fe2b(/vrmonitor\.exe|vrserver\.exe/i.test(_0x2f9a11));
      });
    } catch {
      _0x60fe2b(false);
    }
  });
}
// Ist SteamVR installiert? (appmanifest_250820.acf in irgendeiner Steam-Bibliothek)
function vrSteamVrInstalliert(_0x1a2b3c) {
  if (!_0x1a2b3c) {
    return false;
  }
  try {
    for (const _0x4d5e6f of steamLibraries(_0x1a2b3c)) {
      const _0x7a8b9c = path.join(_0x4d5e6f, "steamapps", "appmanifest_" + VR_STEAMVR_APPID + ".acf");
      try {
        if (fs.existsSync(_0x7a8b9c)) {
          return true;
        }
      } catch {}
    }
  } catch {}
  return false;
}
// Statusabfrage für den VR-Hub.
// ── Meta Quest Sideload (ADB / USB) ─────────────────────────────────────────
// ADB-Fundorte in Prüf-Reihenfolge; danach Fallback auf "adb" im PATH.
const QUEST_ADB_PFADE = ["F:\\Vystra_Apk_Runner\\sdk\\platform-tools\\adb.exe", "E:\\Vystra_Apk_Runner\\sdk\\platform-tools\\adb.exe"];
const QUEST_APK_PFAD = "E:\\Vystra_Android\\Vystra-Launcher.apk";
const QUEST_APK_FALLBACK_DIR = "F:\\Vystra_Website\\downloads";
// Grobe Erkennung „ist das eine Quest?" über Modell/Produkt-Codenamen.
const QUEST_MODELL_HINTS = ["quest", "hollywood", "monterey", "eureka", "panther", "seacliff"];
let questInstallLauft = false;
// Liefert den ADB-Pfad (erste vorhandene Datei; sonst "adb" aus PATH; sonst ok:false).
async function adbPfad() {
  for (const _0xp of QUEST_ADB_PFADE) {
    try {
      if (fs.existsSync(_0xp)) {
        return {
          ok: true,
          pfad: _0xp
        };
      }
    } catch {}
  }
  // Fallback: adb im PATH? Kurz testen.
  const _0ximPath = await new Promise(_0xres => {
    try {
      execFile("adb", ["version"], {
        windowsHide: true,
        timeout: 8000
      }, _0xerr => _0xres(!_0xerr));
    } catch {
      _0xres(false);
    }
  });
  if (_0ximPath) {
    return {
      ok: true,
      pfad: "adb"
    };
  }
  return {
    ok: false,
    error: "ADB nicht gefunden"
  };
}
// Ermittelt die zu installierende APK (feste Datei, sonst neueste *.apk im Downloads-Ordner).
function questApkPfad() {
  // Quest-Fassung (Querformat + Quest-Kennzeichnung) bevorzugen, sonst die Handy-APK.
  const _0xquest = "E:\Vystra_Android\Vystra-Quest.apk";
  try {
    if (fs.existsSync(_0xquest)) {
      return _0xquest;
    }
  } catch {}
  try {
    if (fs.existsSync(QUEST_APK_PFAD)) {
      return QUEST_APK_PFAD;
    }
  } catch {}
  try {
    const _0xliste = fs.readdirSync(QUEST_APK_FALLBACK_DIR).filter(_0xf => /\.apk$/i.test(_0xf)).map(_0xf => {
      const _0xfull = path.join(QUEST_APK_FALLBACK_DIR, _0xf);
      let _0xm = 0;
      try {
        _0xm = fs.statSync(_0xfull).mtimeMs;
      } catch {}
      return {
        full: _0xfull,
        mtime: _0xm
      };
    }).sort((_0xa, _0xb) => _0xb.mtime - _0xa.mtime);
    if (_0xliste.length) {
      return _0xliste[0].full;
    }
  } catch {}
  return null;
}
// Führt adb mit Argumenten aus und liefert stdout/stderr + Fehlerinfo (nie throw).
function adbRun(_0xadb, _0xargs, _0xtimeout = 15000) {
  return new Promise(_0xres => {
    try {
      execFile(_0xadb, _0xargs, {
        windowsHide: true,
        timeout: _0xtimeout,
        maxBuffer: 4194304
      }, (_0xerr, _0xstdout, _0xstderr) => {
        _0xres({
          ok: !_0xerr,
          killed: !!(_0xerr && _0xerr.killed),
          stdout: String(_0xstdout || ""),
          stderr: String(_0xstderr || "")
        });
      });
    } catch (_0xe) {
      _0xres({
        ok: false,
        killed: false,
        stdout: "",
        stderr: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      });
    }
  });
}
// Fortschritt an den Renderer melden (gleiches Muster wie "music:progress").
function questSendProgress(_0xdata) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("quest:progress", _0xdata);
    }
  } catch {}
}
// Übersetzt adb-Ausgabe in eine verständliche deutsche Fehlermeldung.
function questFehlerText(_0xout) {
  const _0xs = String(_0xout || "");
  const _0xm = _0xs.match(/(INSTALL_FAILED_[A-Z_]+|INSTALL_PARSE_FAILED_[A-Z_]+)/);
  const _0xcode = _0xm ? _0xm[1] : "";
  if (/INSTALL_FAILED_VERSION_DOWNGRADE|INSTALL_FAILED_UPDATE_INCOMPATIBLE|INCONSISTENT_CERTIFICATES/i.test(_0xs)) {
    return "Versionskonflikt: Auf der Quest ist bereits eine andere Version installiert. Bitte diese zuerst im Headset deinstallieren und erneut versuchen.";
  }
  if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(_0xcode)) {
    return "Nicht genug Speicherplatz auf der Quest. Bitte Speicher freigeben und erneut versuchen.";
  }
  if (/INSTALL_FAILED_OLDER_SDK/i.test(_0xcode)) {
    return "Die Quest-Software ist zu alt für diese App. Bitte das Headset zuerst aktualisieren.";
  }
  if (/no devices\/emulators found|device .*not found|device unauthorized|closed/i.test(_0xs)) {
    return "Gerät nicht mehr erreichbar. Bitte USB-Verbindung prüfen und erneut suchen.";
  }
  if (_0xcode) {
    return "Installation fehlgeschlagen (" + _0xcode + "). Bitte erneut versuchen.";
  }
  const _0xerste = _0xs.split(/\r?\n/).map(_0xl => _0xl.trim()).filter(Boolean)[0] || "";
  return "Installation fehlgeschlagen." + (_0xerste ? " (" + _0xerste.slice(0, 140) + ")" : "");
}
// Sucht angeschlossene ADB-Geräte und markiert Quest-Modelle.
async function questGeraeteErmitteln() {
  const _0xap = await adbPfad();
  if (!_0xap.ok) {
    return {
      ok: false,
      error: _0xap.error || "ADB nicht gefunden",
      geraete: []
    };
  }
  const _0xadb = _0xap.pfad;
  await adbRun(_0xadb, ["start-server"], 15000);
  const _0xdev = await adbRun(_0xadb, ["devices", "-l"], 15000);
  if (!_0xdev.ok && !_0xdev.stdout) {
    return {
      ok: false,
      error: "ADB konnte nicht gestartet werden.",
      geraete: []
    };
  }
  const _0xgeraete = [];
  for (const _0xraw of _0xdev.stdout.split(/\r?\n/)) {
    const _0xline = _0xraw.trim();
    if (!_0xline || /^List of devices/i.test(_0xline)) {
      continue;
    }
    const _0xmt = _0xline.match(/^(\S+)\s+(\S+)(.*)$/);
    if (!_0xmt) {
      continue;
    }
    const _0xserial = _0xmt[1];
    const _0xzustand = _0xmt[2];
    if (_0xzustand !== "device" && _0xzustand !== "unauthorized") {
      continue;
    }
    const _0xrest = _0xmt[3] || "";
    let _0xproduct = "";
    const _0xpm = _0xrest.match(/product:(\S+)/);
    if (_0xpm) {
      _0xproduct = _0xpm[1];
    }
    let _0xmodel = "";
    const _0xmm = _0xrest.match(/model:(\S+)/);
    if (_0xmm) {
      _0xmodel = _0xmm[1].replace(/_/g, " ");
    }
    let _0xhersteller = "";
    // getprop nur bei bestätigtem Gerät (unauthorized verweigert die Shell).
    if (_0xzustand === "device") {
      const _0xgm = await adbRun(_0xadb, ["-s", _0xserial, "shell", "getprop", "ro.product.model"], 10000);
      if (_0xgm.ok && _0xgm.stdout.trim()) {
        _0xmodel = _0xgm.stdout.trim();
      }
      const _0xgh = await adbRun(_0xadb, ["-s", _0xserial, "shell", "getprop", "ro.product.manufacturer"], 10000);
      if (_0xgh.ok && _0xgh.stdout.trim()) {
        _0xhersteller = _0xgh.stdout.trim();
      }
    }
    const _0xhay = (_0xproduct + " " + _0xmodel + " " + _0xhersteller).toLowerCase();
    const _0xistQuest = QUEST_MODELL_HINTS.some(_0xh => _0xhay.includes(_0xh)) || /oculus/.test(_0xhay);
    _0xgeraete.push({
      serial: _0xserial,
      model: _0xmodel || _0xserial,
      hersteller: _0xhersteller,
      istQuest: _0xistQuest,
      zustand: _0xzustand
    });
  }
  return {
    ok: true,
    geraete: _0xgeraete
  };
}
// Installiert die APK per "adb install -r -g" auf das (gewählte) Gerät.
async function questInstallApk(_0xserialArg) {
  if (questInstallLauft) {
    return {
      ok: false,
      error: "Es läuft bereits eine Übertragung. Bitte warten."
    };
  }
  const _0xapk = questApkPfad();
  if (!_0xapk) {
    return {
      ok: false,
      error: "Keine APK gefunden (E:\\Vystra_Android\\Vystra-Launcher.apk)."
    };
  }
  questInstallLauft = true;
  try {
    questSendProgress({
      phase: "verbinde",
      text: "Suche Gerät …",
      pct: 8
    });
    const _0xdet = await questGeraeteErmitteln();
    if (!_0xdet.ok) {
      questSendProgress({
        phase: "fehler",
        text: _0xdet.error || "ADB nicht gefunden",
        pct: 100
      });
      return {
        ok: false,
        error: _0xdet.error || "ADB nicht gefunden"
      };
    }
    const _0xgeraete = _0xdet.geraete || [];
    let _0xziel = null;
    if (_0xserialArg) {
      _0xziel = _0xgeraete.find(_0xg => _0xg.serial === _0xserialArg) || null;
      if (!_0xziel) {
        return {
          ok: false,
          error: "Das gewählte Gerät ist nicht mehr verbunden. Bitte erneut suchen."
        };
      }
    } else {
      const _0xbereit = _0xgeraete.filter(_0xg => _0xg.zustand === "device");
      if (_0xbereit.length === 0) {
        const _0xunauth = _0xgeraete.find(_0xg => _0xg.zustand === "unauthorized");
        if (_0xunauth) {
          return {
            ok: false,
            error: "Bitte im Headset die USB-Debugging-Anfrage bestätigen (Immer erlauben)."
          };
        }
        return {
          ok: false,
          error: "Kein Gerät gefunden. Verbinde deine Quest per USB."
        };
      }
      if (_0xbereit.length > 1) {
        return {
          ok: false,
          needChoice: true,
          geraete: _0xbereit
        };
      }
      _0xziel = _0xbereit[0];
    }
    if (_0xziel.zustand === "unauthorized") {
      return {
        ok: false,
        error: "Bitte im Headset die USB-Debugging-Anfrage bestätigen (Immer erlauben)."
      };
    }
    const _0xap = await adbPfad();
    if (!_0xap.ok) {
      return {
        ok: false,
        error: _0xap.error || "ADB nicht gefunden"
      };
    }
    questSendProgress({
      phase: "übertrage",
      text: "Übertrage Vystra auf " + _0xziel.model + " …",
      pct: 40
    });
    const _0xinst = await adbRun(_0xap.pfad, ["-s", _0xziel.serial, "install", "-r", "-g", _0xapk], 180000);
    const _0xout = _0xinst.stdout + "\n" + _0xinst.stderr;
    if (/Success/i.test(_0xout)) {
      questSendProgress({
        phase: "fertig",
        text: "Fertig!",
        pct: 100
      });
      return {
        ok: true,
        model: _0xziel.model
      };
    }
    if (_0xinst.killed) {
      const _0xtmsg = "Zeitüberschreitung bei der Übertragung. Bitte Kabel/Verbindung prüfen und erneut versuchen.";
      questSendProgress({
        phase: "fehler",
        text: _0xtmsg,
        pct: 100
      });
      return {
        ok: false,
        error: _0xtmsg
      };
    }
    const _0xfehler = questFehlerText(_0xout);
    questSendProgress({
      phase: "fehler",
      text: _0xfehler,
      pct: 100
    });
    return {
      ok: false,
      error: _0xfehler
    };
  } finally {
    questInstallLauft = false;
  }
}
async function vrStatus() {
  const _0x0a1b2c = await findSteamPath();
  if (!_0x0a1b2c) {
    return {
      ok: true,
      steamVrInstalled: false,
      steamVrRunning: false,
      steamPath: null
    };
  }
  const _0x3c4d5e = vrSteamVrInstalliert(_0x0a1b2c);
  const _0x6f7a8b = await vrLaeuftSteamVr();
  return {
    ok: true,
    steamVrInstalled: _0x3c4d5e,
    steamVrRunning: _0x6f7a8b,
    steamPath: _0x0a1b2c
  };
}
// Durchsucht installierte Steam-Spiele und filtert auf VR (bekannte IDs + OpenVR-DLL).
async function vrScanGames() {
  const _0x9c0d1e = await findSteamPath();
  if (!_0x9c0d1e) {
    return {
      ok: true,
      games: []
    };
  }
  const _0x2f3a4b = [];
  const _0x5b6c7d = new Set();
  for (const _0x8e9f0a of steamLibraries(_0x9c0d1e)) {
    const _0x1b2c3d = path.join(_0x8e9f0a, "steamapps");
    let _0x4e5f6a = [];
    try {
      _0x4e5f6a = fs.readdirSync(_0x1b2c3d);
    } catch {
      continue;
    }
    for (const _0x7a8b9d of _0x4e5f6a) {
      if (!/^appmanifest_\d+\.acf$/i.test(_0x7a8b9d)) {
        continue;
      }
      let _0xtext;
      try {
        _0xtext = fs.readFileSync(path.join(_0x1b2c3d, _0x7a8b9d), "utf8");
      } catch {
        continue;
      }
      const _0xappid = parseVdfValue(_0xtext, "appid");
      if (!_0xappid || _0xappid === VR_STEAMVR_APPID || STEAM_IGNORE.has(_0xappid) || _0x5b6c7d.has(_0xappid)) {
        continue;
      }
      const _0xname = parseVdfValue(_0xtext, "name");
      const _0xinstalldir = parseVdfValue(_0xtext, "installdir");
      const _0xinstallPath = _0xinstalldir ? path.join(_0x1b2c3d, "common", _0xinstalldir) : null;
      let _0xistVr = VR_KNOWN_APPIDS.has(_0xappid);
      if (!_0xistVr && _0xinstallPath) {
        _0xistVr = vrHatOpenVrDll(_0xinstallPath, 0);
      }
      if (!_0xistVr) {
        continue;
      }
      _0x5b6c7d.add(_0xappid);
      _0x2f3a4b.push({
        appid: _0xappid,
        title: _0xname || VR_KNOWN_APPIDS.get(_0xappid) || ("Spiel " + _0xappid),
        installPath: _0xinstallPath
      });
      if (_0x2f3a4b.length >= 200) {
        break;
      }
    }
    if (_0x2f3a4b.length >= 200) {
      break;
    }
  }
  _0x2f3a4b.sort((_0xg1, _0xg2) => _0xg1.title.localeCompare(_0xg2.title, "de"));
  return {
    ok: true,
    games: _0x2f3a4b
  };
}
// ── Vystra VR im LAN: Suche, Kopplung, Fernsteuerung ────────────────────────
// Zweck: die Quest-App soll den PC in Millisekunden finden und danach dauerhaft
// gekoppelt bleiben. Darum zwei getrennte Kanaele: UDP-Rundruf (verbindungslos,
// schnell, nur Steckbrief) und WebSocket (zustandsbehaftet, authentifiziert).
const VR_DISCOVERY_PORT = 8450;
const VR_LAN_PORT = 8451;
const VR_PAIR_GUELTIGKEIT_MS = 5 * 60 * 1000;
const VR_PAIR_MAX_FEHLVERSUCHE = 5;

// Der PC-Name aendert sich zur Laufzeit praktisch nie -> einmal ermitteln, damit
// der UDP-Handler wirklich nur noch Variablen liest.
const vrPcName = (() => {
  try {
    return os.hostname();
  } catch {
    return "PC";
  }
})();

// WARUM Cache: der UDP-Handler MUSS synchron und in wenigen Millisekunden
// antworten. vrStatus()/vrScanGames() lesen Steam-Bibliotheken von der Platte -
// das darf im Handler nicht passieren. Ein Intervall frischt diese Werte im
// Hintergrund auf, der Handler liest sie nur.
let vrCacheSteamVrLaeuft = false;
let vrCacheSpieleAnzahl = 0;
let vrCacheBenutzer = null;
// Absender-IPs bereits gekoppelter Geraete - ebenfalls nur damit der Handler
// nicht die Einstellungsdatei lesen muss.
let vrCacheGekoppelteIps = new Set();
let vrDiscoverySocket = null;
let vrCacheIntervall = null;
let vrLanServer = null;

// IPv4-gemappte IPv6-Adressen ("::ffff:192.168.0.5") auf die reine IPv4-Form
// bringen, sonst vergleicht man UDP-Absender und WebSocket-Gegenstelle nie gleich.
function vrIpNormal(_0xvrip) {
  const _0xtxt = String(_0xvrip || "").trim();
  return _0xtxt.replace(/^::ffff:/i, "");
}
async function vrCacheAktualisieren() {
  try {
    const _0xvrcSt = await vrStatus();
    vrCacheSteamVrLaeuft = !!(_0xvrcSt && _0xvrcSt.steamVrRunning);
  } catch {}
  try {
    const _0xvrcSp = await vrScanGames();
    vrCacheSpieleAnzahl = _0xvrcSp && Array.isArray(_0xvrcSp.games) ? _0xvrcSp.games.length : 0;
  } catch {}
}
// Benutzername und gekoppelte IPs neu einlesen. Wird nach jeder Kopplung sofort
// aufgerufen, damit die naechste UDP-Antwort schon „gekoppelt: true" meldet.
function vrCacheGeraeteAuffrischen() {
  try {
    const _0xvrcS = loadSettings();
    const _0xvrcU = _0xvrcS.user || {};
    vrCacheBenutzer = _0xvrcU.username || _0xvrcU.displayName || null;
    const _0xvrcMenge = new Set();
    for (const _0xvrcG of Array.isArray(_0xvrcS.vrGeraete) ? _0xvrcS.vrGeraete : []) {
      if (_0xvrcG && _0xvrcG.ip) {
        _0xvrcMenge.add(vrIpNormal(_0xvrcG.ip));
      }
    }
    vrCacheGekoppelteIps = _0xvrcMenge;
  } catch {}
}
function vrGeraeteLesen() {
  try {
    const _0xvrgS = loadSettings();
    return Array.isArray(_0xvrgS.vrGeraete) ? _0xvrgS.vrGeraete : [];
  } catch {
    return [];
  }
}
function vrGeraeteSchreiben(_0xvrgListe) {
  try {
    const _0xvrgS = loadSettings();
    _0xvrgS.vrGeraete = _0xvrgListe;
    saveSettings(_0xvrgS);
  } catch (_0xvrgErr) {
    // Nur melden: eine nicht schreibbare Einstellungsdatei darf die laufende
    // Verbindung nicht abreissen, sie gilt dann eben nur bis zum Neustart.
    console.log("VR-LAN: Geraeteliste konnte nicht gespeichert werden: " + (_0xvrgErr && _0xvrgErr.message ? _0xvrgErr.message : _0xvrgErr));
  }
}
let vrPairCode = null;
let vrPairGueltigBis = 0;
let vrPairFehlversuche = 0;
// Erzeugt einen frischen 6-stelligen Kopplungscode.
// WARUM crypto.randomInt und nicht Math.random: Math.random ist vorhersagbar,
// ein erratbarer Code haette den gesamten Kopplungsschutz wertlos gemacht.
function vrNeuerPairingCode() {
  vrPairCode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  vrPairGueltigBis = Date.now() + VR_PAIR_GUELTIGKEIT_MS;
  vrPairFehlversuche = 0;
  return {
    code: vrPairCode,
    gueltigBis: vrPairGueltigBis
  };
}
// Liefert den gueltigen Code, erzeugt bei Ablauf oder beim ersten Aufruf einen neuen.
function vrAktuellerPairingCode() {
  if (!vrPairCode || Date.now() > vrPairGueltigBis) {
    return vrNeuerPairingCode();
  }
  return {
    code: vrPairCode,
    gueltigBis: vrPairGueltigBis
  };
}
// Legt ein gekoppeltes Geraet dauerhaft ab. Die IP wird mitgefuehrt, weil die
// UDP-Antwort sonst nicht sagen koennte, ob der Fragende schon gekoppelt ist.
function vrGeraetHinzufuegen(_0xvrhName, _0xvrhIp) {
  const _0xvrhEintrag = {
    id: crypto.randomBytes(8).toString("hex"),
    name: String(_0xvrhName || "Unbekanntes Geraet").slice(0, 64),
    token: crypto.randomBytes(24).toString("hex"),
    gekoppeltAm: Date.now(),
    ip: vrIpNormal(_0xvrhIp)
  };
  const _0xvrhListe = vrGeraeteLesen();
  _0xvrhListe.push(_0xvrhEintrag);
  vrGeraeteSchreiben(_0xvrhListe);
  vrCacheGeraeteAuffrischen();
  return _0xvrhEintrag;
}
// Startet den UDP-Steckbrief-Dienst. Antwortet auf "VYSTRA_VR_DISCOVER"-Rundrufe.
function startVrDiscovery() {
  vrCacheGeraeteAuffrischen();
  vrCacheAktualisieren();
  if (!vrCacheIntervall) {
    vrCacheIntervall = setInterval(() => {
      vrCacheAktualisieren();
      vrCacheGeraeteAuffrischen();
    }, 30000);
  }
  try {
    vrDiscoverySocket = dgram.createSocket({
      type: "udp4",
      reuseAddr: true
    });
  } catch (_0xvrdErr) {
    console.log("VR-Discovery: Socket nicht moeglich: " + (_0xvrdErr && _0xvrdErr.message ? _0xvrdErr.message : _0xvrdErr));
    vrDiscoverySocket = null;
    return;
  }
  // Still fehlschlagende Faelle: Port 8450 belegt (zweite Launcher-Instanz),
  // gar kein Netzwerk, oder die Firewall verwirft eingehende UDP-Pakete. In
  // allen Faellen darf der Launcher nur die LAN-Suche verlieren, nicht sterben.
  vrDiscoverySocket.on("error", _0xvrdE => {
    console.log("VR-Discovery: " + (_0xvrdE && _0xvrdE.message ? _0xvrdE.message : _0xvrdE));
    try {
      vrDiscoverySocket.close();
    } catch {}
    vrDiscoverySocket = null;
  });
  vrDiscoverySocket.on("message", (_0xvrdBuf, _0xvrdInfo) => {
    try {
      if (!_0xvrdBuf || _0xvrdBuf.length > 512) {
        return;
      }
      const _0xvrdTxt = _0xvrdBuf.toString("utf8");
      if (_0xvrdTxt.indexOf("VYSTRA_VR_DISCOVER") !== 0) {
        return;
      }
      const _0xvrdIp = vrIpNormal(_0xvrdInfo && _0xvrdInfo.address);
      // Bewusst nur Cache-Zugriffe: kein Dateilesen, kein await, keine Promise.
      const _0xvrdAntwort = Buffer.from(JSON.stringify({
        typ: "VYSTRA_VR_HIER",
        name: vrPcName,
        version: app.getVersion(),
        benutzer: vrCacheBenutzer,
        wsPort: VR_LAN_PORT,
        steamVrLaeuft: vrCacheSteamVrLaeuft,
        vrSpiele: vrCacheSpieleAnzahl,
        gekoppelt: vrCacheGekoppelteIps.has(_0xvrdIp)
      }), "utf8");
      vrDiscoverySocket.send(_0xvrdAntwort, 0, _0xvrdAntwort.length, _0xvrdInfo.port, _0xvrdInfo.address, () => {});
    } catch (_0xvrdMErr) {
      console.log("VR-Discovery: Antwort fehlgeschlagen: " + (_0xvrdMErr && _0xvrdMErr.message ? _0xvrdMErr.message : _0xvrdMErr));
    }
  });
  vrDiscoverySocket.on("listening", () => {
    try {
      // Ohne Broadcast-Erlaubnis verwirft der Kernel Pakete an 255.255.255.255.
      vrDiscoverySocket.setBroadcast(true);
    } catch {}
    console.log("VR-Discovery lauscht auf UDP " + VR_DISCOVERY_PORT);
  });
  try {
    vrDiscoverySocket.bind(VR_DISCOVERY_PORT);
  } catch (_0xvrdBErr) {
    console.log("VR-Discovery: bind fehlgeschlagen: " + (_0xvrdBErr && _0xvrdBErr.message ? _0xvrdBErr.message : _0xvrdBErr));
  }
}
// Startet ein Steam-VR-Spiel. Bewusst eigene Funktion, weil sowohl der
// IPC-Handler (Oberflaeche) als auch die LAN-Bruecke (Quest) sie brauchen.
async function vrSpielStarten(_0xvrsAppid) {
  if (!/^\d+$/.test(String(_0xvrsAppid || ""))) {
    return {
      ok: false,
      error: "Ungültige App-ID."
    };
  }
  try {
    await shell.openExternal("steam://rungameid/" + _0xvrsAppid);
    return {
      ok: true
    };
  } catch (_0xvrsErr2) {
    return {
      ok: false,
      error: _0xvrsErr2 && _0xvrsErr2.message ? _0xvrsErr2.message : String(_0xvrsErr2)
    };
  }
}
// WebSocket-Kanal fuer gekoppelte Geraete. Bewusst OHNE 127.0.0.1-Bindung -
// die Quest sitzt im selben WLAN, nicht auf diesem Rechner. Der Schutz liegt
// deshalb komplett bei Pairing-Code und Token, nicht bei der Netzwerkgrenze.
function startVrLanBridge() {
  try {
    vrLanServer = new WebSocketServer({
      port: VR_LAN_PORT
    });
  } catch (_0xvrlSErr) {
    console.log("VR-LAN-Bruecke: Start fehlgeschlagen: " + (_0xvrlSErr && _0xvrlSErr.message ? _0xvrlSErr.message : _0xvrlSErr));
    vrLanServer = null;
    return;
  }
  // EADDRINUSE meldet ws asynchron als Ereignis, nicht als Wurf - ohne diesen
  // Zuhoerer wuerde ein belegter Port 8451 den ganzen Launcher beenden.
  vrLanServer.on("error", _0xvrlEE => {
    console.log("VR-LAN-Bruecke: " + (_0xvrlEE && _0xvrlEE.message ? _0xvrlEE.message : _0xvrlEE));
  });
  vrLanServer.on("listening", () => {
    console.log("VR-LAN-Bruecke lauscht auf Port " + VR_LAN_PORT);
  });
  vrLanServer.on("connection", (_0xvrlSock, _0xvrlReq) => {
    // Eine frische Verbindung gilt als NICHT authentifiziert.
    let _0xvrlAuth = false;
    const _0xvrlIp = vrIpNormal(_0xvrlReq && _0xvrlReq.socket ? _0xvrlReq.socket.remoteAddress : "");
    const _0xvrlSenden = _0xvrlObj => {
      try {
        _0xvrlSock.send(JSON.stringify(_0xvrlObj));
      } catch {}
    };
    const _0xvrlAbweisen = _0xvrlGrund => {
      _0xvrlSenden({
        ok: false,
        fehler: _0xvrlGrund
      });
      try {
        _0xvrlSock.close();
      } catch {}
    };
    // Ohne diesen Zuhoerer wirft ein abgerissenes WLAN einen unbehandelten Fehler.
    _0xvrlSock.on("error", () => {});
    _0xvrlSock.on("message", async _0xvrlRoh => {
      let _0xvrlN;
      try {
        _0xvrlN = JSON.parse(_0xvrlRoh.toString());
      } catch {
        return;
      }
      const _0xvrlTyp = _0xvrlN && _0xvrlN.typ;
      try {
        // Vor erfolgreicher Anmeldung sind ausschliesslich pair und auth erlaubt.
        if (!_0xvrlAuth && _0xvrlTyp !== "pair" && _0xvrlTyp !== "auth") {
          _0xvrlAbweisen("nicht_authentifiziert");
          return;
        }
        if (_0xvrlTyp === "pair") {
          const _0xvrlCode = String(_0xvrlN.code || "");
          if (!vrPairCode || Date.now() > vrPairGueltigBis) {
            // Abgelaufen: neuen Code erzeugen, der Nutzer muss ihn neu ablesen.
            vrNeuerPairingCode();
            _0xvrlSenden({
              ok: false,
              fehler: "code_falsch",
              verbleibend: VR_PAIR_MAX_FEHLVERSUCHE
            });
            return;
          }
          if (_0xvrlCode !== vrPairCode) {
            vrPairFehlversuche++;
            if (vrPairFehlversuche >= VR_PAIR_MAX_FEHLVERSUCHE) {
              // WARUM: 6 Ziffern waeren sonst in Sekunden durchprobiert. Nach
              // funf Fehlversuchen wird der Code sofort verbrannt.
              vrNeuerPairingCode();
              _0xvrlSenden({
                ok: false,
                fehler: "code_falsch",
                verbleibend: 0
              });
              return;
            }
            _0xvrlSenden({
              ok: false,
              fehler: "code_falsch",
              verbleibend: VR_PAIR_MAX_FEHLVERSUCHE - vrPairFehlversuche
            });
            return;
          }
          const _0xvrlNeu = vrGeraetHinzufuegen(_0xvrlN.geraet, _0xvrlIp);
          _0xvrlAuth = true;
          // Verbrauchter Code darf kein zweites Mal gelten.
          vrNeuerPairingCode();
          _0xvrlSenden({
            ok: true,
            typ: "paired",
            token: _0xvrlNeu.token,
            name: vrPcName
          });
          return;
        }
        if (_0xvrlTyp === "auth") {
          const _0xvrlToken = String(_0xvrlN.token || "");
          const _0xvrlListe = vrGeraeteLesen();
          const _0xvrlTreffer = _0xvrlToken ? _0xvrlListe.find(_0xvrlG => _0xvrlG && _0xvrlG.token === _0xvrlToken) : null;
          if (!_0xvrlTreffer) {
            _0xvrlAbweisen("token_ungueltig");
            return;
          }
          _0xvrlAuth = true;
          // IP nachfuehren: per DHCP bekommt die Quest oft eine neue, sonst
          // meldete die UDP-Antwort faelschlich „noch nicht gekoppelt".
          if (vrIpNormal(_0xvrlTreffer.ip) !== _0xvrlIp) {
            _0xvrlTreffer.ip = _0xvrlIp;
            vrGeraeteSchreiben(_0xvrlListe);
          }
          vrCacheGeraeteAuffrischen();
          _0xvrlSenden({
            ok: true,
            typ: "authed",
            name: vrPcName,
            geraet: _0xvrlTreffer.name
          });
          return;
        }
        if (_0xvrlTyp === "status") {
          _0xvrlSenden({
            ...(await vrStatus()),
            typ: "status"
          });
          return;
        }
        if (_0xvrlTyp === "spiele") {
          _0xvrlSenden({
            ...(await vrScanGames()),
            typ: "spiele"
          });
          return;
        }
        if (_0xvrlTyp === "starte") {
          _0xvrlSenden({
            ...(await vrSpielStarten(_0xvrlN.appid)),
            typ: "starte"
          });
          return;
        }
        if (_0xvrlTyp === "ping") {
          _0xvrlSenden({
            typ: "pong",
            zeit: Date.now()
          });
          return;
        }
        _0xvrlSenden({
          ok: false,
          fehler: "unbekannter_typ"
        });
      } catch (_0xvrlMErr) {
        // Ein Fehler in einer Nachricht darf weder Verbindung noch Launcher reissen.
        console.log("VR-LAN-Bruecke: Nachricht fehlgeschlagen: " + (_0xvrlMErr && _0xvrlMErr.message ? _0xvrlMErr.message : _0xvrlMErr));
        _0xvrlSenden({
          ok: false,
          fehler: "interner_fehler"
        });
      }
    });
  });
}
function steamLang() {
  const _0x57d0dd = {
    de: "german",
    en: "english",
    es: "spanish",
    fr: "french",
    pl: "polish",
    hu: "hungarian",
    lb: "german"
  };
  return _0x57d0dd[loadSettings().language] || "english";
}
const MONTH_PREFIXES = [["jan", "ene", "sty"], ["feb", "fév", "fev", "lut"], ["mar", "mär", "mrz", "már"], ["apr", "abr", "avr", "kwi", "ápr"], ["may", "mai", "maj", "máj"], ["jun", "jún", "cze", "juin"], ["jul", "júl", "lip", "juil"], ["aug", "ago", "aoû", "aou", "sie"], ["sep", "wrz", "szep"], ["oct", "okt", "paź", "paz"], ["nov", "lis"], ["dec", "dez", "dic", "déc", "gru"]];
function monthFromText(_0x528fa6) {
  const _0x4f3763 = String(_0x528fa6).toLowerCase();
  for (let _0x2969d1 = MONTH_PREFIXES.length - 1; _0x2969d1 >= 0; _0x2969d1--) {
    if (MONTH_PREFIXES[_0x2969d1].some(_0x2c11c8 => _0x4f3763.includes(_0x2c11c8))) {
      return _0x2969d1;
    }
  }
  return null;
}
function isUnreleased(_0x25c879) {
  const _0x530310 = String(_0x25c879 || "").trim();
  if (!_0x530310) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(_0x530310)) {
    return new Date(_0x530310).getTime() > Date.now();
  }
  const _0x5400ff = new Date();
  const _0x153586 = parseInt((_0x530310.match(/\b(19|20|21)\d{2}\b/) || [])[0] || "", 10);
  if (!_0x153586) {
    return true;
  }
  if (_0x153586 > _0x5400ff.getFullYear()) {
    return true;
  }
  if (_0x153586 < _0x5400ff.getFullYear()) {
    return false;
  }
  const _0x3632f0 = parseInt((_0x530310.match(/\b([1-9]|[12]\d|3[01])\b(?!\d)/) || [])[0] || "", 10);
  const _0x1032cb = monthFromText(_0x530310);
  if (_0x1032cb == null || !_0x3632f0) {
    return true;
  }
  if (_0x1032cb !== _0x5400ff.getMonth()) {
    return _0x1032cb > _0x5400ff.getMonth();
  }
  return _0x3632f0 > _0x5400ff.getDate();
}
function acceptLang() {
  const _0x5851ee = {
    de: "de-DE",
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    pl: "pl-PL",
    hu: "hu-HU",
    lb: "de-DE"
  };
  return _0x5851ee[loadSettings().language] || "en-US";
}
async function fetchText(_0x2d8a5d, _0x167375 = 8000) {
  const _0x3359d7 = new AbortController();
  const _0x3e4ca0 = setTimeout(() => _0x3359d7.abort(), _0x167375);
  const _0xabf04d = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  try {
    const _0x14a77a = await fetch(_0x2d8a5d, {
      headers: _0xabf04d,
      signal: _0x3359d7.signal
    });
    if (!_0x14a77a.ok) {
      return null;
    }
    return await _0x14a77a.text();
  } catch {
    return null;
  } finally {
    clearTimeout(_0x3e4ca0);
  }
}
function detectSteamUser(_0x59eb65) {
  try {
    const _0x2a72bc = fs.readFileSync(path.join(_0x59eb65, "config", "loginusers.vdf"), "utf8");
    const _0x2c7d6f = /"(7656\d{13})"\s*\{([\s\S]*?)\}/g;
    let _0x3cad5d;
    let _0x613d48 = null;
    while ((_0x3cad5d = _0x2c7d6f.exec(_0x2a72bc)) !== null) {
      const _0xaf5292 = _0x3cad5d[2];
      const _0x4ea32f = (_0xaf5292.match(/"PersonaName"\s+"([^"]*)"/i) || [])[1] || "";
      const _0x366715 = /"MostRecent"\s+"1"/i.test(_0xaf5292);
      const _0x66cc81 = parseInt((_0xaf5292.match(/"Timestamp"\s+"(\d+)"/i) || [])[1] || "0", 10);
      const _0x30fac6 = {
        steamId: _0x3cad5d[1],
        persona: _0x4ea32f,
        mostRecent: _0x366715,
        timestamp: _0x66cc81
      };
      if (!_0x613d48 || _0x30fac6.mostRecent || !_0x613d48.mostRecent && _0x30fac6.timestamp > _0x613d48.timestamp) {
        _0x613d48 = _0x30fac6;
      }
    }
    return _0x613d48;
  } catch {
    return null;
  }
}
function vdfBlock(_0x39f3fd, _0x36937a) {
  const _0x1fcab4 = new RegExp("\"" + _0x36937a + "\"\\s*\\{", "i");
  const _0x5a34c7 = _0x1fcab4.exec(_0x39f3fd);
  if (!_0x5a34c7) {
    return null;
  }
  const _0x31246b = _0x39f3fd.indexOf("{", _0x5a34c7.index);
  let _0x4d5f8c = 0;
  for (let _0x5452da = _0x31246b; _0x5452da < _0x39f3fd.length; _0x5452da++) {
    if (_0x39f3fd[_0x5452da] === "{") {
      _0x4d5f8c++;
    } else if (_0x39f3fd[_0x5452da] === "}") {
      _0x4d5f8c--;
      if (_0x4d5f8c === 0) {
        return _0x39f3fd.slice(_0x31246b + 1, _0x5452da);
      }
    }
  }
  return null;
}
let steamAppNamesCache = null;
async function steamAppNames() {
  if (steamAppNamesCache) {
    return steamAppNamesCache;
  }
  const _0x3141ad = path.join(app.getPath("userData"), "steam-applist.json");
  try {
    const _0x4ebbfa = fs.statSync(_0x3141ad);
    if (Date.now() - _0x4ebbfa.mtimeMs < 604800000) {
      steamAppNamesCache = new Map(JSON.parse(fs.readFileSync(_0x3141ad, "utf8")));
      return steamAppNamesCache;
    }
  } catch {}
  const _0x4f22a8 = await fetchJson("https://api.steampowered.com/ISteamApps/GetAppList/v2/", {}, 20000);
  const _0x4295eb = _0x4f22a8 && _0x4f22a8.applist && _0x4f22a8.applist.apps;
  const _0x43de72 = new Map();
  if (Array.isArray(_0x4295eb)) {
    for (const _0x49ba60 of _0x4295eb) {
      if (_0x49ba60.appid && _0x49ba60.name) {
        _0x43de72.set(String(_0x49ba60.appid), _0x49ba60.name);
      }
    }
    try {
      fs.writeFileSync(_0x3141ad, JSON.stringify([..._0x43de72]));
    } catch {}
  }
  steamAppNamesCache = _0x43de72;
  return _0x43de72;
}
function scanSteamOwnedLocalIds(_0x596361) {
  const _0x1f2f87 = new Set();
  if (!_0x596361) {
    return _0x1f2f87;
  }
  const _0x25a407 = path.join(_0x596361, "userdata");
  let _0x5e59ac = [];
  try {
    _0x5e59ac = fs.readdirSync(_0x25a407);
  } catch {
    return _0x1f2f87;
  }
  for (const _0x4c0f42 of _0x5e59ac) {
    if (!/^\d+$/.test(_0x4c0f42)) {
      continue;
    }
    for (const _0x373252 of [path.join("config", "localconfig.vdf"), path.join("7", "remote", "sharedconfig.vdf")]) {
      let _0x4c1cc6;
      try {
        _0x4c1cc6 = fs.readFileSync(path.join(_0x25a407, _0x4c0f42, _0x373252), "utf8");
      } catch {
        continue;
      }
      const _0x402bb3 = vdfBlock(_0x4c1cc6, "apps");
      if (!_0x402bb3) {
        continue;
      }
      const _0x5925f0 = /"(\d{2,8})"\s*\{/g;
      let _0x1ba64b;
      while ((_0x1ba64b = _0x5925f0.exec(_0x402bb3)) !== null) {
        _0x1f2f87.add(_0x1ba64b[1]);
      }
    }
  }
  return _0x1f2f87;
}
function ownedGame(_0x213257, _0x3edc30, _0xafe629 = 0) {
  return {
    platform: "steam",
    id: String(_0x213257),
    title: _0x3edc30,
    owned: true,
    playtimeMinutes: _0xafe629 || 0,
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/" + _0x213257 + "/header.jpg"
  };
}
async function fetchOwnedSteamGames() {
  const _0x38fa9a = loadSettings();
  const _0x99516f = await findSteamPath();
  const _0x439474 = _0x99516f ? detectSteamUser(_0x99516f) : null;
  const _0x26e838 = (_0x38fa9a.steamId64 || "").trim() || (_0x439474 ? _0x439474.steamId : null);
  const _0x3f689c = _0x439474 ? _0x439474.persona : null;
  const _0x18d4a9 = effectiveSteamKey(_0x38fa9a);
  if (_0x26e838 && _0x18d4a9) {
    const _0x143362 = await fetchJson("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=" + encodeURIComponent(_0x18d4a9) + "&steamid=" + _0x26e838 + "&include_appinfo=1&include_played_free_games=1&format=json", {}, 10000);
    const _0x19b1ad = _0x143362 && _0x143362.response && _0x143362.response.games;
    if (Array.isArray(_0x19b1ad) && _0x19b1ad.length) {
      const _0x255317 = _0x19b1ad.map(_0x59ef45 => ownedGame(_0x59ef45.appid, _0x59ef45.name, _0x59ef45.playtime_forever)).sort((_0x1faa96, _0x22600d) => _0x1faa96.title.localeCompare(_0x22600d.title, "de"));
      return {
        ok: true,
        steamId: _0x26e838,
        persona: _0x3f689c,
        games: _0x255317,
        source: "api"
      };
    }
    if (Array.isArray(_0x19b1ad)) {
      return {
        ok: false,
        steamId: _0x26e838,
        persona: _0x3f689c,
        games: [],
        error: "Die Web-API hat keine Spiele geliefert – ist das Profil bzw. der Spielebesitz auf privat gestellt?"
      };
    }
  }
  const _0x1d7010 = _0x26e838 ? await fetchText("https://steamcommunity.com/profiles/" + _0x26e838 + "/games?tab=all&xml=1", 10000) : null;
  if (_0x1d7010 && _0x1d7010.includes("<gamesList>")) {
    const _0x2eb63d = [];
    const _0x2d2af9 = /<game>[\s\S]*?<appID>(\d+)<\/appID>[\s\S]*?<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>[\s\S]*?<\/game>/g;
    let _0x117adb;
    while ((_0x117adb = _0x2d2af9.exec(_0x1d7010)) !== null) {
      _0x2eb63d.push(ownedGame(_0x117adb[1], _0x117adb[2]));
    }
    if (_0x2eb63d.length) {
      _0x2eb63d.sort((_0x3f784f, _0x20ce95) => _0x3f784f.title.localeCompare(_0x20ce95.title, "de"));
      return {
        ok: true,
        steamId: _0x26e838,
        persona: _0x3f689c,
        games: _0x2eb63d,
        source: "profile"
      };
    }
  }
  const _0x3249d5 = scanSteamOwnedLocalIds(_0x99516f);
  if (_0x3249d5.size) {
    const _0x350acf = await steamAppNames();
    const _0x1e4216 = [..._0x3249d5].filter(_0x1f2a15 => !STEAM_IGNORE.has(_0x1f2a15)).map(_0x4767cb => ownedGame(_0x4767cb, _0x350acf.get(_0x4767cb) || "Steam-Spiel " + _0x4767cb)).sort((_0x2868dd, _0x2ba464) => _0x2868dd.title.localeCompare(_0x2ba464.title, "de"));
    if (_0x1e4216.length) {
      return {
        ok: true,
        steamId: _0x26e838,
        persona: _0x3f689c,
        games: _0x1e4216,
        source: "local"
      };
    }
  }
  if (!_0x99516f) {
    return {
      ok: false,
      steamId: _0x26e838,
      persona: _0x3f689c,
      games: [],
      error: "Steam wurde auf diesem PC nicht gefunden. Ist Steam installiert und wurde es schon einmal gestartet?"
    };
  }
  return {
    ok: false,
    steamId: _0x26e838,
    persona: _0x3f689c,
    games: [],
    error: "Spielebesitz konnte nicht geladen werden. Entweder ist dein Steam-Profil privat – oder du hinterlegst in den Einstellungen einen kostenlosen Steam-Web-API-Key (steamcommunity.com/dev/apikey), dann klappt es immer."
  };
}
function listSteamAccounts(_0x28b9dd) {
  const _0x20b5bf = [];
  if (!_0x28b9dd) {
    return _0x20b5bf;
  }
  try {
    const _0x4cc20d = fs.readFileSync(path.join(_0x28b9dd, "config", "loginusers.vdf"), "utf8");
    const _0x14b77a = /"(7656\d{13})"\s*\{([\s\S]*?)\}/g;
    let _0x33f377;
    while ((_0x33f377 = _0x14b77a.exec(_0x4cc20d)) !== null) {
      const _0xb1c9a4 = _0x33f377[2];
      _0x20b5bf.push({
        steamId: _0x33f377[1],
        accountName: (_0xb1c9a4.match(/"AccountName"\s+"([^"]*)"/i) || [])[1] || "",
        persona: (_0xb1c9a4.match(/"PersonaName"\s+"([^"]*)"/i) || [])[1] || "",
        mostRecent: /"MostRecent"\s+"1"/i.test(_0xb1c9a4),
        remembered: /"RememberPassword"\s+"1"/i.test(_0xb1c9a4),
        timestamp: parseInt((_0xb1c9a4.match(/"Timestamp"\s+"(\d+)"/i) || [])[1] || "0", 10)
      });
    }
  } catch {}
  return _0x20b5bf;
}
async function fetchOwnedForSteamId(_0x1028a1, _0x5f2dba) {
  if (!_0x1028a1 || !_0x5f2dba) {
    return null;
  }
  const _0x4a5919 = await fetchJson("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=" + encodeURIComponent(_0x5f2dba) + "&steamid=" + _0x1028a1 + "&include_appinfo=1&include_played_free_games=1&format=json", {}, 10000);
  const _0x16392a = _0x4a5919 && _0x4a5919.response && _0x4a5919.response.games;
  if (Array.isArray(_0x16392a)) {
    return _0x16392a.map(_0x2758d0 => ownedGame(_0x2758d0.appid, _0x2758d0.name, _0x2758d0.playtime_forever));
  }
  return null;
}
async function fetchAllAccountsOwned() {
  const _0x540b9e = loadSettings();
  const _0x32dd75 = await findSteamPath();
  if (!_0x32dd75) {
    return {
      ok: false,
      error: "Steam nicht gefunden.",
      accounts: [],
      games: []
    };
  }
  const _0x410e45 = effectiveSteamKey(_0x540b9e);
  const _0x65f6c7 = listSteamAccounts(_0x32dd75);
  const _0x275f26 = Array.isArray(_0x540b9e.steamAccounts) && _0x540b9e.steamAccounts.length ? _0x65f6c7.filter(_0x44bd2f => _0x540b9e.steamAccounts.includes(_0x44bd2f.steamId)) : _0x65f6c7;
  const _0x3a6bb2 = new Map();
  for (const _0x4f3452 of _0x275f26) {
    let _0x4a36b3 = await fetchOwnedForSteamId(_0x4f3452.steamId, _0x410e45);
    if (!_0x4a36b3) {
      const _0x477b96 = await fetchText("https://steamcommunity.com/profiles/" + _0x4f3452.steamId + "/games?tab=all&xml=1", 10000).catch(() => null);
      if (_0x477b96 && _0x477b96.includes("<gamesList>")) {
        _0x4a36b3 = [];
        const _0x1ee4e5 = /<game>[\s\S]*?<appID>(\d+)<\/appID>[\s\S]*?<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>[\s\S]*?<\/game>/g;
        let _0x411309;
        while ((_0x411309 = _0x1ee4e5.exec(_0x477b96)) !== null) {
          _0x4a36b3.push(ownedGame(_0x411309[1], _0x411309[2]));
        }
      }
    }
    if (!_0x4a36b3) {
      continue;
    }
    for (const _0xc3a6a1 of _0x4a36b3) {
      const _0x504f5e = _0x3a6bb2.get(_0xc3a6a1.id) || {
        ..._0xc3a6a1,
        owners: []
      };
      if (!_0x504f5e.owners.some(_0x46abc7 => _0x46abc7.steamId === _0x4f3452.steamId)) {
        _0x504f5e.owners.push({
          steamId: _0x4f3452.steamId,
          accountName: _0x4f3452.accountName,
          persona: _0x4f3452.persona || _0x4f3452.accountName
        });
      }
      if ((_0xc3a6a1.playtimeMinutes || 0) > (_0x504f5e.playtimeMinutes || 0)) {
        _0x504f5e.playtimeMinutes = _0xc3a6a1.playtimeMinutes;
      }
      _0x3a6bb2.set(_0xc3a6a1.id, _0x504f5e);
    }
  }
  const _0x531d8a = [..._0x3a6bb2.values()].sort((_0x33df11, _0x1c13ba) => _0x33df11.title.localeCompare(_0x1c13ba.title, "de"));
  return {
    ok: true,
    accounts: _0x275f26,
    games: _0x531d8a
  };
}
let lastSteamSwitchAt = 0; // Zeitpunkt des letzten Konto-Wechsels (für 60-Sek-Cooldown)
async function launchSteamAsAccount(_0x9c1e59, _0x1a6da7) {
  const _0x387b0e = await findSteamPath();
  if (!_0x387b0e) {
    return {
      ok: false,
      error: "Steam nicht gefunden."
    };
  }
  const _0x2a3ff0 = path.join(_0x387b0e, "steam.exe");
  if (!fs.existsSync(_0x2a3ff0)) {
    return {
      ok: false,
      error: "steam.exe nicht gefunden."
    };
  }
  const _0x2d884a = listSteamAccounts(_0x387b0e);
  const _0x55df97 = _0x2d884a.find(_0x2b804a => _0x2b804a.mostRecent) || null;
  const _0x5ef0e8 = !_0x1a6da7 || _0x55df97 && _0x55df97.accountName && _0x55df97.accountName.toLowerCase() === String(_0x1a6da7).toLowerCase();
  if (_0x5ef0e8) {
    await shell.openExternal("steam://rungameid/" + _0x9c1e59);
    return {
      ok: true,
      switched: false
    };
  }
  // Konto-Wechsel (Steam-Neustart) höchstens 1× pro Minute – schützt vor Neustart-Thrashing
  if (Date.now() - lastSteamSwitchAt < 60000) {
    const _0xwait = Math.ceil((60000 - (Date.now() - lastSteamSwitchAt)) / 1000);
    return {
      ok: false,
      cooldown: true,
      error: "Konto-Wechsel ist nur 1× pro Minute möglich – bitte noch " + _0xwait + " Sek. warten."
    };
  }
  lastSteamSwitchAt = Date.now();
  try {
    execFile(_0x2a3ff0, ["-shutdown"]);
  } catch {}
  await new Promise(_0x3a4c4b => {
    let _0x4206b3 = 0;
    const _0x1243f1 = () => {
      execFile("tasklist", ["/FI", "IMAGENAME eq steam.exe", "/NH"], (_0x58d766, _0x298532) => {
        _0x4206b3++;
        if (_0x298532 && !/steam\.exe/i.test(_0x298532) || _0x4206b3 > 30) {
          return _0x3a4c4b();
        }
        setTimeout(_0x1243f1, 500);
      });
    };
    _0x1243f1();
  });
  spawn(_0x2a3ff0, ["-login", _0x1a6da7, "-applaunch", String(_0x9c1e59)], {
    detached: true,
    stdio: "ignore"
  }).unref();
  return {
    ok: true,
    switched: true
  };
}
function epicManifestDir() {
  const _0x38bb85 = process.env.ProgramData || "C:\\ProgramData";
  return path.join(_0x38bb85, "Epic", "EpicGamesLauncher", "Data", "Manifests");
}
async function findEpicLauncherExe() {
  if (!IS_WIN) {
    return null;
  }
  const _0x4f43df = ["C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe", "C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe"];
  for (const _0x1575c8 of _0x4f43df) {
    if (fs.existsSync(_0x1575c8)) {
      return _0x1575c8;
    }
  }
  return null;
}
async function scanEpic() {
  const _0x56a3ac = epicManifestDir();
  const _0x5e5851 = await findEpicLauncherExe();
  if (!fs.existsSync(_0x56a3ac) && !_0x5e5851) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  const _0x7f5fc9 = [];
  let _0x28b0ab = [];
  try {
    _0x28b0ab = fs.readdirSync(_0x56a3ac);
  } catch {}
  for (const _0x43f4b2 of _0x28b0ab) {
    if (!_0x43f4b2.endsWith(".item")) {
      continue;
    }
    try {
      const _0x555688 = JSON.parse(fs.readFileSync(path.join(_0x56a3ac, _0x43f4b2), "utf8"));
      const _0x46c05e = _0x555688.AppCategories || [];
      if (_0x46c05e.length && !_0x46c05e.includes("games")) {
        continue;
      }
      if (!_0x555688.DisplayName || !_0x555688.AppName) {
        continue;
      }
      _0x7f5fc9.push({
        platform: "epic",
        id: _0x555688.AppName,
        title: _0x555688.DisplayName,
        sizeBytes: _0x555688.InstallSize || 0,
        installPath: _0x555688.InstallLocation || null,
        catalogNamespace: _0x555688.CatalogNamespace || "",
        catalogItemId: _0x555688.CatalogItemId || "",
        image: null
      });
    } catch {}
  }
  const _0x400a5b = [];
  for (const _0x179c71 of _0x7f5fc9) {
    if (!_0x179c71.catalogNamespace) {
      continue;
    }
    const _0x205c6e = fetchEpicImage(_0x179c71.catalogNamespace, _0x179c71.catalogItemId).then(_0x1b57e8 => {
      if (_0x1b57e8) {
        _0x179c71.image = _0x1b57e8;
      }
    }).catch(() => {});
    _0x400a5b.push(_0x205c6e);
    if (_0x400a5b.length >= 6) {
      await Promise.race(_0x400a5b);
    }
  }
  await Promise.allSettled(_0x400a5b);
  _0x7f5fc9.sort((_0x3c3f09, _0x3f3dd8) => _0x3c3f09.title.localeCompare(_0x3f3dd8.title, "de"));
  return {
    installed: true,
    path: _0x5e5851,
    games: _0x7f5fc9
  };
}
async function scanUbisoft() {
  if (!IS_WIN) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  const _0x41a699 = await regQuery("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher", "InstallDir");
  const _0x178fcd = _0x41a699 ? path.join(_0x41a699, "data", "games") : "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\data\\games";
  if (!fs.existsSync(_0x178fcd)) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  let _0x1d7838 = [];
  try {
    _0x1d7838 = fs.readdirSync(_0x178fcd);
  } catch {
    return {
      installed: true,
      path: _0x178fcd,
      games: []
    };
  }
  const _0x4b4595 = [];
  const _0xc6b47a = {
    "461": "Assassin's Creed Syndicate",
    "205": "Far Cry 4",
    "1843": "Rainbow Six Siege",
    "5175": "Assassin's Creed Valhalla",
    "3539": "Watch Dogs: Legion",
    "274": "Far Cry Primal",
    "1253": "The Division 2",
    "3624": "Assassin's Creed Odyssey",
    "413": "Far Cry 5",
    "5405": "Far Cry 6",
    "857": "Anno 1800"
  };
  for (const _0x212d90 of _0x1d7838) {
    if (/^\d+$/.test(_0x212d90)) {
      _0x4b4595.push({
        platform: "ubisoft",
        id: _0x212d90,
        title: _0xc6b47a[_0x212d90] || "Ubisoft-Spiel (ID: " + _0x212d90 + ")",
        installPath: path.join(_0x178fcd, _0x212d90),
        image: "https://ubistatic3-a.akamaihd.net/us/uplay/uplayapp/ubisoft-logo.png"
      });
    }
  }
  return {
    installed: true,
    path: _0x178fcd,
    games: _0x4b4595
  };
}
async function scanEA() {
  if (!IS_WIN) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  const _0x20d322 = "C:\\ProgramData\\EA Desktop\\EA Desktop\\Data";
  if (!fs.existsSync(_0x20d322)) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  function _0x50ca98(_0x5a2b6f) {
    let _0x5afab0 = [];
    try {
      const _0x3efad2 = fs.readdirSync(_0x5a2b6f);
      for (const _0x505922 of _0x3efad2) {
        const _0x141c1b = path.join(_0x5a2b6f, _0x505922);
        const _0x2ea24a = fs.statSync(_0x141c1b);
        if (_0x2ea24a.isDirectory()) {
          _0x5afab0 = _0x5afab0.concat(_0x50ca98(_0x141c1b));
        } else if (_0x505922.endsWith(".mfst")) {
          _0x5afab0.push(_0x141c1b);
        }
      }
    } catch {}
    return _0x5afab0;
  }
  const _0xb14794 = _0x50ca98(_0x20d322);
  const _0x1385cc = [];
  const _0x17d446 = {
    "OFB-EAST:109552156": "The Sims 4",
    "Origin.OFR.50.0002693": "Battlefield V",
    "Origin.OFR.50.0001453": "FIFA 21",
    "Origin.OFR.50.0000557": "Mass Effect Legendary Edition",
    "Origin.OFR.50.0001662": "Apex Legends",
    "Origin.OFR.50.0003923": "It Takes Two"
  };
  for (const _0x5ac75a of _0xb14794) {
    try {
      const _0x219b5a = path.basename(_0x5ac75a, ".mfst");
      const _0x5bcac7 = fs.readFileSync(_0x5ac75a, "utf8");
      const _0x1fd12e = _0x5bcac7.match(/title="([^"]+)"/i) || _0x5bcac7.match(/displayName="([^"]+)"/i);
      const _0x126e63 = _0x1fd12e ? _0x1fd12e[1] : _0x17d446[_0x219b5a] || "EA-Spiel (" + _0x219b5a + ")";
      _0x1385cc.push({
        platform: "ea",
        id: _0x219b5a,
        title: _0x126e63,
        installPath: _0x5ac75a,
        image: "https://eaassets-a.akamaihd.net/eahelp/images/hero/ea-logo.png"
      });
    } catch {}
  }
  return {
    installed: true,
    path: _0x20d322,
    games: _0x1385cc
  };
}
async function iconDataUrl(_0x4c2c4e) {
  try {
    if (!IS_WIN) {
      return null;
    }
    if (!_0x4c2c4e || !fs.existsSync(_0x4c2c4e)) {
      return null;
    }
    const _0xb16d9c = await app.getFileIcon(_0x4c2c4e, {
      size: "large"
    });
    if (_0xb16d9c && !_0xb16d9c.isEmpty()) {
      return _0xb16d9c.toDataURL();
    } else {
      return null;
    }
  } catch {
    return null;
  }
}
function localImageDataUrl(_0x2bae91, _0x3ea7c4 = 921600) {
  try {
    if (!_0x2bae91 || !fs.existsSync(_0x2bae91)) {
      return null;
    }
    const _0x3edd68 = fs.statSync(_0x2bae91);
    if (_0x3edd68.size > _0x3ea7c4) {
      return null;
    }
    const _0x5c077b = path.extname(_0x2bae91).slice(1).toLowerCase();
    const _0x1bd64d = _0x5c077b === "jpg" ? "jpeg" : _0x5c077b;
    return "data:image/" + _0x1bd64d + ";base64," + fs.readFileSync(_0x2bae91).toString("base64");
  } catch {
    return null;
  }
}
// ── Launcher verknuepfen: Ordner der .exe untersuchen ──────────────────────
// Durchsucht den Ordner einer .exe nach Hinweisen, ob es ein Launcher (fuehrt
// eine Spielebibliothek) oder ein einzelnes Spiel ist. Bewusst mit doppeltem
// Deckel: hoechstens zwei Ebenen tief UND hoechstens MAX_EINTRAEGE Datei-
// eintraege. WARUM: liegt die exe in einer Steam-Bibliothek mit zehntausenden
// Dateien, wuerde ein vollstaendiger Scan die IPC minutenlang blockieren.
function launcherOrdnerScan(_0xwurzel) {
  const _0xergebnis = {
    unterordner: 0,
    exeAnzahl: 0,
    gefunden: [],
    launcherPunkte: 0,
    spielPunkte: 0
  };
  const _0xgesehen = new Set();
  const _0xmerke = (_0xhinweis, _0xseite, _0xpunkte) => {
    if (!_0xgesehen.has(_0xhinweis)) {
      _0xgesehen.add(_0xhinweis);
      _0xergebnis.gefunden.push(_0xhinweis);
    }
    if (_0xseite === "launcher") {
      _0xergebnis.launcherPunkte += _0xpunkte;
    } else if (_0xseite === "spiel") {
      _0xergebnis.spielPunkte += _0xpunkte;
    }
  };
  let _0xzaehler = 0;
  const MAX_EINTRAEGE = 4000;
  const _0xscanne = (_0xdir, _0xtiefe) => {
    if (_0xtiefe > 2 || _0xzaehler > MAX_EINTRAEGE) {
      return;
    }
    let _0xeintraege = [];
    try {
      _0xeintraege = fs.readdirSync(_0xdir, {
        withFileTypes: true
      });
    } catch {
      return;
    }
    for (const _0xe of _0xeintraege) {
      if (_0xzaehler++ > MAX_EINTRAEGE) {
        break;
      }
      const _0xklein = _0xe.name.toLowerCase();
      if (_0xe.isDirectory()) {
        // Nur die Unterordner der ersten Ebene zaehlen - tiefere wuerden die
        // Zahl unbrauchbar aufblaehen.
        if (_0xtiefe === 1) {
          _0xergebnis.unterordner++;
        }
        // Launcher-Signaturen an Ordnernamen.
        if (/(librar|manifests|depot|steamapps)/i.test(_0xklein)) {
          _0xmerke("Ordner: " + _0xe.name, "launcher", 2);
        } else if (/(games|config)/i.test(_0xklein)) {
          _0xmerke("Ordner: " + _0xe.name, "launcher", 1);
        }
        // Spiel-Signaturen an Ordnernamen: Unity legt "<Spiel>_Data" an,
        // Unreal einen "Engine"-Ordner.
        if (/_data$/i.test(_0xklein)) {
          _0xmerke("Unity-Datenordner: " + _0xe.name, "spiel", 2);
        } else if (_0xklein === "engine") {
          _0xmerke("Unreal-Engine-Ordner", "spiel", 2);
        }
        _0xscanne(path.join(_0xdir, _0xe.name), _0xtiefe + 1);
      } else {
        if (/\.exe$/i.test(_0xklein)) {
          _0xergebnis.exeAnzahl++;
        }
        // Launcher-Signaturen an Dateien: eine Datenbank fuehrt fast immer eine
        // Bibliothek/Kontostand, Manifest/Depot sind Store-Begriffe.
        if (/\.(db|sqlite|sqlite3)$/i.test(_0xklein)) {
          _0xmerke("Datenbank: " + _0xe.name, "launcher", 2);
        }
        if (/(manifest|depot)/i.test(_0xklein)) {
          _0xmerke("Datei: " + _0xe.name, "launcher", 1);
        }
        // Spiel-Signaturen an Dateien: eindeutige Engine-Marker.
        if (_0xklein === "unityplayer.dll") {
          _0xmerke("UnityPlayer.dll", "spiel", 3);
        }
        if (/\.pck$/i.test(_0xklein)) {
          _0xmerke("Godot-Paket (.pck)", "spiel", 3);
        }
      }
    }
  };
  _0xscanne(_0xwurzel, 1);
  // Viele Unterordner mit je eigenen Programmen sprechen fuer einen Launcher
  // (die installierten Spiele), eine einzelne exe ohne Struktur fuer ein Spiel.
  if (_0xergebnis.unterordner >= 4 && _0xergebnis.exeAnzahl >= 4) {
    _0xmerke("Viele Unterordner mit Programmen", "launcher", 2);
  }
  if (_0xergebnis.unterordner <= 1 && _0xergebnis.exeAnzahl <= 2 && _0xergebnis.launcherPunkte === 0 && _0xergebnis.spielPunkte === 0) {
    _0xmerke("Einzelne .exe ohne weitere Struktur", "spiel", 1);
  }
  return _0xergebnis;
}
function findXboxLogo(_0x512d70) {
  const _0x511da0 = [/square150x150logo/i, /storelogo/i, /square44x44logo/i, /logo\.png$/i, /square/i, /logo/i];
  let _0x148ad3 = [];
  try {
    _0x148ad3 = fs.readdirSync(_0x512d70).filter(_0x55e895 => /\.(png|jpg|jpeg)$/i.test(_0x55e895));
  } catch {
    return null;
  }
  for (const _0x58e5e5 of _0x511da0) {
    const _0x10e290 = _0x148ad3.find(_0x457a5e => _0x58e5e5.test(_0x457a5e));
    if (_0x10e290) {
      return path.join(_0x512d70, _0x10e290);
    }
  }
  return null;
}
function hashPath(_0xda2c0c) {
  let _0x2e7c2c = 0;
  const _0x2ccb3c = String(_0xda2c0c).toLowerCase();
  for (let _0x4269d6 = 0; _0x4269d6 < _0x2ccb3c.length; _0x4269d6++) {
    _0x2e7c2c = _0x2e7c2c * 31 + _0x2ccb3c.charCodeAt(_0x4269d6) >>> 0;
  }
  return _0x2e7c2c.toString(36);
}
const NON_GAME_EXE = new Set(["chrome.exe", "firefox.exe", "msedge.exe", "opera.exe", "operagx.exe", "brave.exe", "iexplore.exe", "winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe", "onenote.exe", "teams.exe", "code.exe", "notepad.exe", "notepad++.exe", "explorer.exe", "cmd.exe", "powershell.exe", "discord.exe", "spotify.exe", "zoom.exe", "skype.exe", "thunderbird.exe", "obs64.exe", "obs32.exe", "vlc.exe", "acrobat.exe", "acrord32.exe", "winrar.exe", "7zfm.exe", "viscode launcher.exe", "steam.exe", "epicgameslauncher.exe", "upc.exe", "eadesktop.exe", "battle.net.exe", "galaxyclient.exe"]);
function isNonGameExe(_0x5aa089) {
  const _0x27817e = String(_0x5aa089).toLowerCase();
  if (_0x27817e.includes("\\windows\\")) {
    return true;
  }
  if (_0x27817e.includes("\\system32\\")) {
    return true;
  }
  const _0x1c3914 = path.basename(_0x27817e);
  if (NON_GAME_EXE.has(_0x1c3914)) {
    return true;
  }
  if (/(uninstall|unins\d|^setup|installer|redist|vcredist|dxsetup|dotnetfx|crashhandler|crashreport|^update\.exe)/i.test(_0x1c3914)) {
    return true;
  }
  return false;
}
function psJson(_0x9b8500, _0x20be16 = 15000) {
  if (!IS_WIN) {
    return Promise.resolve([]);
  }
  return new Promise(_0x2a3397 => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _0x9b8500], {
      windowsHide: true,
      timeout: _0x20be16,
      maxBuffer: 4194304
    }, (_0x36186a, _0x3d952f) => {
      if (_0x36186a || !_0x3d952f || !_0x3d952f.trim()) {
        return _0x2a3397([]);
      }
      try {
        const _0x57d29e = JSON.parse(_0x3d952f);
        _0x2a3397(Array.isArray(_0x57d29e) ? _0x57d29e : [_0x57d29e]);
      } catch {
        _0x2a3397([]);
      }
    });
  });
}
async function resolveShortcuts(_0x420e04) {
  const _0x24ae51 = _0x420e04.replace(/'/g, "''");
  const _0x3e5c07 = "$sh = New-Object -ComObject WScript.Shell; " + ("Get-ChildItem -LiteralPath '" + _0x24ae51 + "' -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { ") + "$l = $sh.CreateShortcut($_.FullName); [PSCustomObject]@{ name = $_.BaseName; target = $l.TargetPath; workdir = $l.WorkingDirectory } } | ConvertTo-Json -Compress";
  return await psJson(_0x3e5c07);
}
async function scanDesktop() {
  const _0x4cf51e = [];
  try {
    _0x4cf51e.push(app.getPath("desktop"));
  } catch {}
  const _0x1e6762 = app.getPath("home");
  _0x4cf51e.push(path.join(_0x1e6762, "Desktop"));
  _0x4cf51e.push(path.join(_0x1e6762, "OneDrive", "Desktop"));
  if (process.env.OneDrive) {
    _0x4cf51e.push(path.join(process.env.OneDrive, "Desktop"));
  }
  if (process.env.OneDriveConsumer) {
    _0x4cf51e.push(path.join(process.env.OneDriveConsumer, "Desktop"));
  }
  _0x4cf51e.push(path.join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"));
  const _0x5e2563 = new Set();
  const _0x3fa77b = [];
  for (const _0x4edaf1 of _0x4cf51e) {
    if (!_0x4edaf1 || _0x5e2563.has(_0x4edaf1.toLowerCase()) || !fs.existsSync(_0x4edaf1)) {
      continue;
    }
    _0x5e2563.add(_0x4edaf1.toLowerCase());
    _0x3fa77b.push(...(await resolveShortcuts(_0x4edaf1)));
  }
  const _0x1cd111 = [];
  const _0x418614 = new Set();
  for (const _0x1b1c6a of _0x3fa77b) {
    const _0x493845 = (_0x1b1c6a.target || "").trim();
    if (!_0x493845 || !/\.exe$/i.test(_0x493845) || !fs.existsSync(_0x493845)) {
      continue;
    }
    if (isNonGameExe(_0x493845)) {
      continue;
    }
    const _0x224bde = _0x493845.toLowerCase();
    if (_0x418614.has(_0x224bde)) {
      continue;
    }
    _0x418614.add(_0x224bde);
    _0x1cd111.push({
      platform: "manual",
      source: "desktop",
      id: "dt-" + hashPath(_0x493845),
      title: (_0x1b1c6a.name || path.basename(_0x493845, ".exe")).trim(),
      exePath: _0x493845,
      installPath: _0x1b1c6a.workdir && fs.existsSync(_0x1b1c6a.workdir) ? _0x1b1c6a.workdir : path.dirname(_0x493845),
      image: null
    });
  }
  return _0x1cd111;
}
function scanMinecraft() {
  const _0x1028e0 = [];
  if (!IS_WIN) {
    return _0x1028e0;
  }
  const _0x53a1fd = path.join(app.getPath("appData"), ".minecraft");
  if (!fs.existsSync(_0x53a1fd)) {
    return _0x1028e0;
  }
  const _0x27567d = ["C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe", "C:\\Program Files (x86)\\Minecraft\\MinecraftLauncher.exe", "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe"];
  const _0x29dc14 = _0x27567d.find(_0x2f021c => fs.existsSync(_0x2f021c)) || null;
  _0x1028e0.push({
    platform: "manual",
    source: "minecraft",
    id: "minecraft-java",
    title: "Minecraft",
    exePath: _0x29dc14,
    installPath: _0x53a1fd,
    image: "https://www.minecraft.net/content/dam/games/minecraft/key-art/MC-Vanilla_PMP_Collection-Carousel-0_Java-Bedrock_1200x600.jpg"
  });
  return _0x1028e0;
}
function scanXbox() {
  const _0x373949 = [];
  if (!IS_WIN) {
    return {
      installed: false,
      games: []
    };
  }
  const _0x5d6415 = new Set();
  _0x5d6415.add("C:\\XboxGames");
  for (const _0x142e3d of ["D", "E", "F", "G"]) {
    const _0x2c8e41 = _0x142e3d + ":\\XboxGames";
    if (fs.existsSync(_0x2c8e41)) {
      _0x5d6415.add(_0x2c8e41);
    }
  }
  for (const _0x545a7e of _0x5d6415) {
    if (!fs.existsSync(_0x545a7e)) {
      continue;
    }
    let _0x227fe7 = [];
    try {
      _0x227fe7 = fs.readdirSync(_0x545a7e);
    } catch {
      continue;
    }
    for (const _0x34ddfa of _0x227fe7) {
      const _0x65e1e6 = path.join(_0x545a7e, _0x34ddfa, "Content");
      if (!fs.existsSync(_0x65e1e6)) {
        continue;
      }
      let _0x5b7b95 = null;
      try {
        const _0x284c92 = fs.readdirSync(_0x65e1e6);
        const _0x43e309 = _0x284c92.find(_0x229866 => /gamelaunchhelper\.exe$/i.test(_0x229866));
        _0x5b7b95 = _0x43e309 ? path.join(_0x65e1e6, _0x43e309) : (() => {
          const _0x240b6c = _0x284c92.find(_0x151cf8 => /\.exe$/i.test(_0x151cf8) && !isNonGameExe(_0x151cf8));
          if (_0x240b6c) {
            return path.join(_0x65e1e6, _0x240b6c);
          } else {
            return null;
          }
        })();
      } catch {}
      const _0xa11f5 = findXboxLogo(_0x65e1e6);
      _0x373949.push({
        platform: "microsoft",
        source: "xbox",
        id: "xbox-" + hashPath(path.join(_0x545a7e, _0x34ddfa)),
        title: _0x34ddfa,
        exePath: _0x5b7b95,
        installPath: path.join(_0x545a7e, _0x34ddfa),
        image: _0xa11f5 ? localImageDataUrl(_0xa11f5) : null,
        imageContain: !!_0xa11f5
      });
    }
  }
  return {
    installed: _0x373949.length > 0 || fs.existsSync("C:\\XboxGames"),
    games: _0x373949
  };
}
function manualStorePath() {
  return path.join(app.getPath("userData"), "manual-games.json");
}
function loadManualStore() {
  try {
    return {
      games: [],
      hidden: [],
      overrides: {},
      ...JSON.parse(fs.readFileSync(manualStorePath(), "utf8"))
    };
  } catch {
    return {
      games: [],
      hidden: [],
      overrides: {}
    };
  }
}
function saveManualStore(_0x24fd6f) {
  fs.writeFileSync(manualStorePath(), JSON.stringify(_0x24fd6f, null, 2), "utf8");
}
function gameArtDir() {
  const _0x39f62b = path.join(app.getPath("userData"), "game-art");
  try {
    if (!fs.existsSync(_0x39f62b)) {
      fs.mkdirSync(_0x39f62b, {
        recursive: true
      });
    }
  } catch {}
  return _0x39f62b;
}
function gameArtFile(_0x24947a) {
  const _0x401ecf = String(_0x24947a).replace(/[^a-z0-9_-]/gi, "_").slice(0, 90);
  return path.join(gameArtDir(), _0x401ecf + ".img");
}
function readGameArt(_0x5453d8, _0x43f8c1) {
  try {
    const _0x37e589 = gameArtFile(_0x5453d8);
    if (fs.existsSync(_0x37e589)) {
      return "data:" + (_0x43f8c1 || "image/png") + ";base64," + fs.readFileSync(_0x37e589).toString("base64");
    }
  } catch {}
  return null;
}
function deleteGameArt(_0x445edc) {
  try {
    fs.unlinkSync(gameArtFile(_0x445edc));
  } catch {}
}
function applyOverrides(_0x4dec9a, _0xd50e48) {
  const _0x59897c = _0xd50e48 && _0xd50e48[_0x4dec9a.id];
  if (!_0x59897c) {
    return _0x4dec9a;
  }
  if (_0x59897c.title) {
    _0x4dec9a.title = _0x59897c.title;
  }
  if (_0x59897c.description) {
    _0x4dec9a.description = _0x59897c.description;
  }
  if (_0x59897c.imageFile) {
    const _0x4ee062 = readGameArt(_0x4dec9a.id, _0x59897c.imageMime);
    if (_0x4ee062) {
      _0x4dec9a.image = _0x4ee062;
      _0x4dec9a.imageContain = !!_0x59897c.imageContain;
    }
  } else if (_0x4dec9a.image && _0x59897c.imageContain !== undefined) {
    _0x4dec9a.imageContain = !!_0x59897c.imageContain;
  }
  return _0x4dec9a;
}
function isGameExeCandidate(_0x4e6f21, _0x2d8c7a) {
  if (IS_WIN) {
    return /\.exe$/i.test(_0x4e6f21);
  }
  if (/\.(AppImage|sh|x86_64|run)$/i.test(_0x4e6f21)) {
    return true;
  }
  if (!path.extname(_0x4e6f21)) {
    try {
      return !!(fs.statSync(_0x2d8c7a).mode & 0o111);
    } catch {}
  }
  return false;
}
/* ===== Autostart-Helfer =====
 * Der Autostart-Ordner des NUTZERS braucht keine Administratorrechte.
 * Windows: %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
 * Linux:   ~/.config/autostart  */
function autostartOrdner() {
  if (IS_WIN) {
    return path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  }
  return path.join(os.homedir(), ".config", "autostart");
}
/* Macht aus einem Spielnamen einen sicheren Dateinamen (nur Basename,
 * keine Pfadtrenner, kein "..", Präfix "Vystra - " zum Wiedererkennen). */
function autostartBasisName(_0xname) {
  let _0xs = String(_0xname || "").trim();
  _0xs = path.basename(_0xs.replace(/[\\/]+/g, " "));
  _0xs = _0xs.replace(/[<>:"|?*]+/g, " ");
  _0xs = _0xs.replace(new RegExp("[\\u0000-\\u001f]", "g"), "");
  _0xs = _0xs.replace(/\.{2,}/g, ".");
  _0xs = _0xs.replace(/^[.\s]+|[.\s]+$/g, "");
  _0xs = _0xs.replace(/\s+/g, " ").trim().slice(0, 60).trim();
  if (!_0xs || _0xs === "." || _0xs === "..") {
    _0xs = "Spiel";
  }
  return "Vystra - " + _0xs;
}
/* Vollständiger Pfad der Autostart-Verknüpfung – oder null, wenn der
 * Name aus dem Ordner ausbrechen würde. */
function autostartDateiPfad(_0xname) {
  const _0xdir = autostartOrdner();
  const _0xdatei = path.join(_0xdir, autostartBasisName(_0xname) + (IS_WIN ? ".lnk" : ".desktop"));
  if (path.dirname(path.resolve(_0xdatei)) !== path.resolve(_0xdir)) {
    return null;
  }
  return _0xdatei;
}
function findGameExe(_0x2c22f3, _0x2b0dc1 = 0) {
  let _0x51a695 = null;
  let _0x3b1ade = -1;
  let _0x5c4e67 = [];
  try {
    _0x5c4e67 = fs.readdirSync(_0x2c22f3, {
      withFileTypes: true
    });
  } catch {
    return null;
  }
  for (const _0x1d69ee of _0x5c4e67) {
    const _0x161762 = path.join(_0x2c22f3, _0x1d69ee.name);
    if (_0x1d69ee.isFile() && isGameExeCandidate(_0x1d69ee.name, _0x161762) && !isNonGameExe(_0x1d69ee.name)) {
      let _0x29799c = 0;
      try {
        _0x29799c = fs.statSync(_0x161762).size;
      } catch {}
      if (_0x29799c > _0x3b1ade) {
        _0x3b1ade = _0x29799c;
        _0x51a695 = _0x161762;
      }
    } else if (_0x1d69ee.isDirectory() && _0x2b0dc1 < 2 && !/^(redist|_CommonRedist|directx|dotnet|vcredist)/i.test(_0x1d69ee.name)) {
      const _0x994144 = findGameExe(_0x161762, _0x2b0dc1 + 1);
      if (_0x994144) {
        let _0x21594e = 0;
        try {
          _0x21594e = fs.statSync(_0x994144).size;
        } catch {}
        if (_0x21594e > _0x3b1ade) {
          _0x3b1ade = _0x21594e;
          _0x51a695 = _0x994144;
        }
      }
    }
  }
  return _0x51a695;
}
async function launcherFreundeUiScan(_0xopt) {
  if (!IS_WIN) {
    return { ok: false, fehler: "nur Windows" };
  }
  const _0xscript = path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, "app.asar.unpacked"), "tools", "finde-freunde.ps1");
  if (!fs.existsSync(_0xscript)) {
    return { ok: false, fehler: "finde-freunde.ps1 fehlt" };
  }
  const _0xexe = _0xopt && typeof _0xopt.exePath === "string" ? _0xopt.exePath : "";
  const _0xproc = _0xopt && typeof _0xopt.processName === "string" ? _0xopt.processName : "";
  if (!_0xexe && !_0xproc) {
    return { ok: false, fehler: "kein Launcher" };
  }
  let _0xcmd = "& '" + _0xscript.replace(/'/g, "''") + "'";
  if (_0xexe) {
    _0xcmd += " -ExePath '" + _0xexe.replace(/'/g, "''") + "'";
  }
  if (_0xproc) {
    _0xcmd += " -ProcessName '" + _0xproc.replace(/'/g, "''") + "'";
  }
  _0xcmd += " -TimeoutSec 28";
  const _0xrows = await psJson(_0xcmd, 70000);
  const _0xr = _0xrows && _0xrows[0] ? _0xrows[0] : null;
  if (!_0xr) {
    return { ok: false, fehler: "keine Antwort vom UI-Scan" };
  }
  _0xr.platform = _0xopt && _0xopt.platform || _0xr.platform || "";
  return _0xr;
}
function launcherFreundeSpeichern(_0xplattform, _0xdaten) {
  try {
    const _0xziel = path.join(app.getPath("userData"), "freunde-ui-" + String(_0xplattform || "launcher").replace(/[^\w.-]+/g, "_") + ".json");
    fs.writeFileSync(_0xziel, JSON.stringify({
      ok: true,
      ts: Date.now(),
      platform: _0xplattform || "",
      username: _0xdaten && _0xdaten.username || "",
      userId: _0xdaten && _0xdaten.userId || "",
      friends: Array.isArray(_0xdaten && _0xdaten.friends) ? _0xdaten.friends : []
    }, null, 1), "utf8");
  } catch {}
}
function launcherFreundeCacheLesen() {
  const _0xout = [];
  try {
    const _0xdir = app.getPath("userData");
    const _0xdateien = fs.readdirSync(_0xdir).filter(_0xf => /^freunde-ui-.+\.json$/i.test(_0xf));
    for (const _0xf of _0xdateien) {
      try {
        const _0xd = JSON.parse(fs.readFileSync(path.join(_0xdir, _0xf), "utf8"));
        if (_0xd && _0xd.ok) {
          _0xout.push(_0xd);
        }
      } catch {}
    }
  } catch {}
  return _0xout;
}
function launcherFreundeFortschritt(_0xtext, _0xplattform) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("launcher:freundeProgress", {
        text: _0xtext || "",
        platform: _0xplattform || ""
      });
    }
  } catch {}
}
function launcherFreundeAufKonto(_0xplattform, _0xdaten) {
  if (!_0xdaten || !_0xdaten.ok) {
    return;
  }
  const _0xs = loadSettings();
  let _0xan = false;
  const _0xname = String(_0xdaten.username || "").trim();
  const _0xid = String(_0xdaten.userId || "").trim();
  if (_0xplattform === "steam") {
    if (_0xid && /^7656119\d{10}$/.test(_0xid) && !_0xs.steamId64) {
      _0xs.steamId64 = _0xid;
      _0xan = true;
    }
    if (_0xname && !_0xs.steamPersona) {
      _0xs.steamPersona = _0xname;
      _0xan = true;
    }
  } else if (_0xplattform === "epic") {
    if (_0xname && !_0xs.epicDisplayName && !_0xs.epicLauncherDisplayName) {
      _0xs.epicLauncherDisplayName = _0xname;
      _0xan = true;
    }
    if (_0xid && !_0xs.epicLauncherAccountId) {
      _0xs.epicLauncherAccountId = _0xid;
      _0xan = true;
    }
  }
  if (_0xan) {
    saveSettings(_0xs);
  }
}
// Kandidaten-Bibliotheksordner eines verknuepften Launchers. WARUM mehrere: der
// Launcher-.exe-Ordner (vl.ordner) ist oft NICHT der Ort, wo die Spiele liegen -
// itch z. B. installiert nach %APPDATA%\itch\apps. Deshalb: vom Nutzer hinterlegte
// Ordner (vl.bibliotheken) zuerst, dann der Launcher-Ordner samt "games"-Unterordner
// und Nachbar, dazu bekannte Standardorte je nach Launcher-Name. Alles dedupliziert;
// nicht existierende Pfade fliegen erst beim Scan raus.
function vlKandidatenOrdner(_0xvl) {
  const _0xk = [];
  const _0xbib = _0xvl && Array.isArray(_0xvl.bibliotheken) ? _0xvl.bibliotheken : [];
  for (const _0xb of _0xbib) {
    if (_0xb && typeof _0xb === "string") {
      _0xk.push(_0xb);
    }
  }
  const _0xordner = _0xvl && typeof _0xvl.ordner === "string" ? _0xvl.ordner : "";
  if (_0xordner) {
    _0xk.push(_0xordner);
    _0xk.push(path.join(_0xordner, "games"));
    _0xk.push(path.join(_0xordner, "apps"));
    try {
      _0xk.push(path.join(path.dirname(_0xordner), "games"));
    } catch {}
  }
  const _0xname = String(_0xvl && _0xvl.name || "").toLowerCase();
  const _0xappdata = process.env.APPDATA || "";
  const _0xlocal = process.env.LOCALAPPDATA || "";
  // Bekannte Standard-Installationsorte. Bewusst konservativ - nur was sicher passt.
  if (_0xname.includes("itch") && _0xappdata) {
    _0xk.push(path.join(_0xappdata, "itch", "apps"));
  }
  if (_0xname.includes("gog") || _0xname.includes("galaxy")) {
    _0xk.push("C:\\Program Files (x86)\\GOG Galaxy\\Games");
    _0xk.push("C:\\GOG Games");
  }
  // Deduplizieren (gleicher Pfad, egal ob Gross/Klein) und leere raus.
  const _0xgesehen = new Set();
  const _0xergebnis = [];
  for (const _0xp of _0xk) {
    const _0xnorm = String(_0xp).toLowerCase();
    if (_0xp && !_0xgesehen.has(_0xnorm)) {
      _0xgesehen.add(_0xnorm);
      _0xergebnis.push(_0xp);
    }
  }
  return _0xergebnis;
}
// Scannt die Kandidaten-Ordner nach installierten Spielen: jeder Unterordner der
// ersten Ebene, in dem eine startbare .exe steckt, gilt als ein Spiel. Der
// Ordnername ist der Spielname (der zuverlaessigste Titel bei fremden Launchern).
// Dedupliziert ueber den exe-Pfad, damit ein Spiel nicht doppelt auftaucht, wenn
// mehrere Kandidaten-Ordner sich ueberlappen.
function vlSpieleScan(_0xwurzeln) {
  const _0xspiele = [];
  const _0xgesehen = new Set();
  const MAX_SPIELE = 500;
  for (const _0xwurzel of _0xwurzeln) {
    if (_0xspiele.length >= MAX_SPIELE) {
      break;
    }
    if (!_0xwurzel || !fs.existsSync(_0xwurzel)) {
      continue;
    }
    let _0xeintraege = [];
    try {
      _0xeintraege = fs.readdirSync(_0xwurzel, {
        withFileTypes: true
      });
    } catch {
      continue;
    }
    for (const _0xe of _0xeintraege) {
      if (_0xspiele.length >= MAX_SPIELE) {
        break;
      }
      if (!_0xe.isDirectory()) {
        continue;
      }
      const _0xunter = path.join(_0xwurzel, _0xe.name);
      const _0xexe = findGameExe(_0xunter);
      if (!_0xexe) {
        continue;
      }
      const _0xid = "vlg-" + hashPath(_0xexe);
      if (_0xgesehen.has(_0xid)) {
        continue;
      }
      _0xgesehen.add(_0xid);
      _0xspiele.push({
        id: _0xid,
        name: _0xe.name,
        // Spiel vs. Software klassifizieren (Namensbasis; ohne Engine-Marker-Pruefung
        // hier - der Tiefen-Scan macht die genauere Variante).
        art: launcherScan.klassifiziereArt ? launcherScan.klassifiziereArt(_0xunter, _0xexe, false) : "spiel",
        exePath: _0xexe,
        ordner: _0xunter
      });
    }
  }
  _0xspiele.sort((_0xa, _0xb) => String(_0xa.name).localeCompare(String(_0xb.name), "de"));
  return _0xspiele;
}
async function verifyOwnership(_0x4d7ea3) {
  const _0x4dfa5f = loadSettings();
  const _0x1332e0 = _0x4dfa5f.user && _0x4dfa5f.user.id;
  const _0x13d6a6 = await socialApi("GET", "/removed" + (_0x1332e0 ? "?userId=" + encodeURIComponent(_0x1332e0) : ""));
  if (!_0x13d6a6 || _0x13d6a6.offline || !_0x13d6a6.ok) {
    return {
      owned: null,
      offline: true
    };
  }
  const _0x39908b = _0x13d6a6.data && (_0x13d6a6.data.games || _0x13d6a6.data.library || _0x13d6a6.data) || [];
  const _0x52a904 = Array.isArray(_0x39908b) ? _0x39908b : [];
  const _0x58969c = _0x52a904.find(_0x147377 => _0x147377 && String(_0x147377.id) === String(_0x4d7ea3));
  if (_0x58969c) {
    return {
      owned: true,
      entry: _0x58969c
    };
  }
  return {
    owned: false
  };
}
async function fetchEpicOfferById(_0xns, _0xid) {
  if (!_0xns || !_0xid) {
    return null;
  }
  const _0xtok = await epicLauncherEnsureToken();
  if (!_0xtok) {
    return null;
  }
  const _0xurl = EPIC_CATALOG_BASE + "/namespace/" + encodeURIComponent(_0xns) + "/bulk/offers?id=" + encodeURIComponent(_0xid) + "&country=DE&locale=de";
  const _0xdata = await fetchJson(_0xurl, {
    headers: {
      Authorization: "bearer " + _0xtok,
      "User-Agent": EPIC_UA
    }
  }, 8000);
  return _0xdata && _0xdata[_0xid] || null;
}
async function fetchEpicImage(_0x362e24, _0x13a61a) {
  // graphql.epicgames.com liefert seit 2025 410 Gone – Bilder ueber Catalog-API.
  const _0xoffer = await fetchEpicOfferById(_0x362e24, _0x13a61a);
  const _0xf8d870 = _0xoffer && Array.isArray(_0xoffer.keyImages) ? _0xoffer.keyImages : [];
  if (!_0xf8d870.length) {
    return null;
  }
  const _0x45a300 = _0xf8d870.find(_0x245caa => _0x245caa.type === "OfferImageWide" || _0x245caa.type === "DieselStoreFrontWide");
  return (_0x45a300 || _0xf8d870[0])?.url || null;
}
async function fetchSteamShop() {
  const [_0x5f29a4, _0x348356, _0x46ea8a] = await Promise.all([steamCatalogSearch("", 0, 15, "&specials=1"), steamCatalogSearch("", 0, 15, "&filter=topsellers"), steamCatalogSearch("", 0, 15, "&filter=popularnew&sort_by=Released_DESC")]);
  const _0xbb5c72 = (_0x5c1d3d, _0x4fdf03) => (_0x5c1d3d.items || []).map(_0x2f120b => ({
    ..._0x2f120b,
    category: _0x4fdf03
  }));
  return {
    specials: _0xbb5c72(_0x5f29a4, "Im Angebot"),
    newReleases: _0xbb5c72(_0x46ea8a, "Neuerscheinungen"),
    topSellers: _0xbb5c72(_0x348356, "Topseller")
  };
}
async function fetchSteamFreePromos() {
  const _0xalle = [];
  for (let _0xseite = 0; _0xseite < 10; _0xseite++) {
    const _0x3ad843 = await steamCatalogSearch("", _0xseite, 50, "&specials=1&maxprice=free", true);
    const _0xstk = _0x3ad843.items || [];
    _0xalle.push(..._0xstk);
    if (_0xstk.length < 50 || _0xalle.length >= (_0x3ad843.total || 0)) {
      break;
    }
  }
  return _0xalle.map(_0x45d156 => ({
    ..._0x45d156,
    category: "Für begrenzte Zeit kostenlos",
    priceCents: 0,
    discountPercent: _0x45d156.discountPercent || 100
  }));
}
async function fetchViscodeInfo() {
  const _0x488e0a = loadSettings();
  const _0x5f5d3f = (_0x488e0a.viscodeInfoUrl || "https://removed.invalid").replace(/\/$/, "");
  const _0x2c5206 = Array.isArray(_0x488e0a.viscodePublishers) && _0x488e0a.viscodePublishers.length ? _0x488e0a.viscodePublishers : ["pub_000009"];
  const _0x567dc4 = [];
  const _0x1438a7 = [];
  for (const _0x15f58f of _0x2c5206) {
    try {
      const _0x18295a = await fetchJson(_0x5f5d3f + "/removed/" + encodeURIComponent(_0x15f58f) + "/info", {}, 10000);
      const _0x31ab0e = _0x18295a && (_0x18295a.publisher || _0x18295a) || null;
      if (!_0x31ab0e) {
        continue;
      }
      const _0x391907 = {
        id: _0x31ab0e.id || _0x15f58f,
        name: _0x31ab0e.name || "VisCode",
        icon: _0x31ab0e.icon || null,
        description: _0x31ab0e.description || "",
        created: _0x31ab0e.created || null,
        gameCount: _0x31ab0e.game_count,
        totalDownloads: _0x31ab0e.total_downloads
      };
      _0x1438a7.push(_0x391907);
      const _0x5bd7dd = _0x18295a.games || _0x31ab0e.games || [];
      for (const _0x640f1b of _0x5bd7dd) {
        const _0x3cc60d = typeof _0x640f1b.rating === "number" ? {
          stars: _0x640f1b.rating,
          count: Array.isArray(_0x640f1b.reviews) ? _0x640f1b.reviews.length : _0x640f1b.rating_count || 0,
          desc: ""
        } : _0x640f1b.rating || null;
        _0x567dc4.push({
          platform: "viscode",
          id: _0x640f1b.game_id || _0x640f1b.id,
          title: _0x640f1b.name || _0x640f1b.title,
          image: _0x640f1b.portrait || _0x640f1b.banner || _0x640f1b.logo || null,
          bannerImage: _0x640f1b.banner || null,
          logo: _0x640f1b.logo || null,
          priceCents: _0x640f1b.price != null ? Math.round(Number(_0x640f1b.price) * 100) : _0x640f1b.priceCents ?? 0,
          originalPriceCents: null,
          discountPercent: 0,
          currency: "EUR",
          seller: _0x391907.name,
          shortDescription: _0x640f1b.mini_description || "",
          description: _0x640f1b.description || "",
          screenshots: Array.isArray(_0x640f1b.screenshots) ? _0x640f1b.screenshots : [],
          videos: Array.isArray(_0x640f1b.videos) ? _0x640f1b.videos : [],
          rating: _0x3cc60d,
          reviews: Array.isArray(_0x640f1b.reviews) ? _0x640f1b.reviews : [],
          downloads: _0x640f1b.downloads || 0,
          releaseDate: _0x640f1b.created || null,
          developers: [_0x391907.name],
          publishers: [_0x391907.name],
          publisher: _0x391907,
          website: _0x391907.website || null,
          storeUrl: null
        });
      }
    } catch {}
  }
  return {
    games: _0x567dc4,
    publishers: _0x1438a7
  };
}
async function fetchGamerPower() {
  try {
    const _0x1091a0 = await fetchJson("https://www.gamerpower.com/api/giveaways?type=game&sort-by=value", {}, 10000);
    if (!Array.isArray(_0x1091a0)) {
      return [];
    }
    return _0x1091a0.filter(_0x151811 => _0x151811 && _0x151811.title && (_0x151811.status ? _0x151811.status !== "Expired" : true) && /\bPC\b/i.test(String(_0x151811.platforms || ""))).map(_0x65a4ef => {
      let _0x36d29d = null;
      const _0x29cc2c = String(_0x65a4ef.worth || "").match(/([\d.]+)/);
      if (_0x29cc2c) {
        _0x36d29d = Math.round(parseFloat(_0x29cc2c[1]) * 100);
      }
      return {
        platform: "gamerpower",
        category: "Gratis abstauben",
        id: "gp-" + _0x65a4ef.id,
        title: String(_0x65a4ef.title).replace(/\s*Giveaway$/i, "").replace(/\s+Key$/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim(),
        image: _0x65a4ef.image || _0x65a4ef.thumbnail || null,
        priceCents: 0,
        originalPriceCents: _0x36d29d,
        discountPercent: 100,
        currency: "USD",
        seller: _0x65a4ef.platforms || "GamerPower",
        storeUrl: _0x65a4ef.open_giveaway_url || _0x65a4ef.open_giveaway || _0x65a4ef.gamerpower_url || null,
        shortDescription: _0x65a4ef.description || "",
        endDate: _0x65a4ef.end_date || null,
        platformsText: _0x65a4ef.platforms || ""
      };
    });
  } catch {
    return [];
  }
}
let _cheapSharkDealsCache = null;
let _cheapSharkDealsCacheTs = 0;
let _cheapSharkStoresCache = null;
async function fetchCheapSharkStores() {
  if (_cheapSharkStoresCache) {
    return _cheapSharkStoresCache;
  }
  const _0xst = await fetchJson("https://www.cheapshark.com/api/1.0/stores", {}, 10000);
  const _0xmap = {};
  if (Array.isArray(_0xst)) {
    for (const _0xs of _0xst) {
      if (_0xs && _0xs.storeID != null) {
        _0xmap[String(_0xs.storeID)] = _0xs.storeName || "Store " + _0xs.storeID;
      }
    }
    _cheapSharkStoresCache = _0xmap;
  }
  return _0xmap;
}
async function fetchCheapSharkDeals() {
  try {
    const _0xnow = Date.now();
    if (_cheapSharkDealsCache && _0xnow - _cheapSharkDealsCacheTs < 600000) {
      return _cheapSharkDealsCache;
    }
    const [_0xdeals, _0xstores] = await Promise.all([fetchJson("https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&pageSize=30&onSale=1", {}, 10000), fetchCheapSharkStores()]);
    if (!Array.isArray(_0xdeals)) {
      return {
        ok: false
      };
    }
    const _0xlist = _0xdeals.filter(_0xd => _0xd && _0xd.title && _0xd.dealID).map(_0xd => {
      const _0xsale = parseFloat(_0xd.salePrice);
      const _0xnormal = parseFloat(_0xd.normalPrice);
      const _0xpct = Math.round(parseFloat(_0xd.savings) || 0);
      return {
        title: String(_0xd.title),
        sale: isNaN(_0xsale) ? null : _0xsale,
        normal: isNaN(_0xnormal) ? null : _0xnormal,
        savingsPct: _0xpct,
        thumb: _0xd.thumb || null,
        store: _0xstores && _0xstores[String(_0xd.storeID)] || "Store",
        buyUrl: "https://www.cheapshark.com/redirect?dealID=" + _0xd.dealID
      };
    });
    const _0xres = {
      ok: true,
      deals: _0xlist
    };
    _cheapSharkDealsCache = _0xres;
    _cheapSharkDealsCacheTs = _0xnow;
    return _0xres;
  } catch {
    return {
      ok: false
    };
  }
}
// In-Memory-Cache fuer cover:forTitle (Key: lowercase Titel -> {ok,url}).
const _coverForTitleCache = new Map();
async function fetchCheapSharkForTitle(_0xtitle) {
  try {
    const _0xt = String(_0xtitle || "").trim();
    if (!_0xt) {
      return {
        ok: false
      };
    }
    const _0xarr = await fetchJson("https://www.cheapshark.com/api/1.0/games?title=" + encodeURIComponent(_0xt) + "&limit=1", {}, 10000);
    if (!Array.isArray(_0xarr) || !_0xarr.length) {
      return {
        ok: false
      };
    }
    const _0xg = _0xarr[0];
    const _0xsale = parseFloat(_0xg.cheapest);
    if (!_0xg.cheapestDealID || isNaN(_0xsale)) {
      return {
        ok: false
      };
    }
    return {
      ok: true,
      sale: _0xsale,
      thumb: _0xg.thumb || null,
      buyUrl: "https://www.cheapshark.com/redirect?dealID=" + _0xg.cheapestDealID
    };
  } catch {
    return {
      ok: false
    };
  }
}
// ── Preisvergleich ueber mehrere Stores ─────────────────────────────────────
// Flaggschiff-Funktion: einen Titel ueber ALLE Stores vergleichen, guenstigster
// zuerst. Zwei Quellen: CheapShark (kein Key noetig, Preise in USD) und - nur
// wenn der Nutzer einen freien Schluessel hinterlegt hat - IsThereAnyDeal
// (EUR, deckt zusaetzlich EA/MS-Store/Ubisoft ab).
// WARUM eigener, beschreibender User-Agent: CheapShark weist Anfragen mit
// nichtssagendem UA mit HTTP 400 ab - ein Klartext-UA mit Kontaktadresse ist
// dort Pflicht. Bei ITAD schadet er nicht, also ueberall mitschicken.
const PREIS_USER_AGENT = "VystraLauncher/2.3 (contact@vystra.games)";
// Zwischenspeicher je Titel (~10 min). WARUM: sonst wuerde bei jedem Klick neu
// abgefragt; beide Dienste haben Rate-Limits, und Preise aendern sich ohnehin
// nur langsam. Schluessel = normalisierter Titel.
const _preisVergleichCache = new Map();
const PREIS_CACHE_MS = 10 * 60 * 1000;
function preisNorm(_0xt) {
  return String(_0xt == null ? "" : _0xt).trim().toLowerCase();
}
// CheapShark: Angebote zu einem Titel holen und vereinheitlichen (USD).
async function cheapSharkPreiseFuerTitel(_0xtitel, _0xstores) {
  try {
    const _0xt = String(_0xtitel || "").trim();
    if (!_0xt) {
      return [];
    }
    const _0xdeals = await fetchJson("https://www.cheapshark.com/api/1.0/deals?title=" + encodeURIComponent(_0xt) + "&pageSize=20", {
      headers: {
        "User-Agent": PREIS_USER_AGENT
      }
    }, 10000);
    if (!Array.isArray(_0xdeals)) {
      return [];
    }
    // Pro Store nur das guenstigste Angebot behalten - CheapShark liefert oft
    // mehrere Eintraege desselben Stores (verschiedene Editionen/Deals).
    const _0xproStore = new Map();
    for (const _0xd of _0xdeals) {
      if (!_0xd || !_0xd.dealID) {
        continue;
      }
      const _0xsale = parseFloat(_0xd.salePrice);
      if (isNaN(_0xsale)) {
        continue;
      }
      const _0xstore = _0xstores && _0xstores[String(_0xd.storeID)] || "Store " + _0xd.storeID;
      const _0xschluessel = preisNorm(_0xstore);
      const _0xvorher = _0xproStore.get(_0xschluessel);
      if (_0xvorher && _0xvorher.preis <= _0xsale) {
        continue;
      }
      const _0xnormal = parseFloat(_0xd.normalPrice);
      _0xproStore.set(_0xschluessel, {
        quelle: "cheapshark",
        store: _0xstore,
        preis: _0xsale,
        normalpreis: isNaN(_0xnormal) ? null : _0xnormal,
        waehrung: "USD",
        rabatt: Math.round(parseFloat(_0xd.savings) || 0),
        link: "https://www.cheapshark.com/redirect?dealID=" + _0xd.dealID,
        verfuegbar: true
      });
    }
    return Array.from(_0xproStore.values());
  } catch {
    return [];
  }
}
// ITAD (IsThereAnyDeal): OPTIONAL und DEFENSIV. Nur mit freiem Schluessel. Die
// genaue v2/v3-Route ist nicht garantiert stabil, darum ist jeder Schritt
// gekapselt: schlaegt irgendetwas fehl (kein Treffer, geaenderte Route, Timeout),
// liefert die Funktion einfach [] - der Vergleich bleibt dann bei den
// CheapShark-Daten. Ein ITAD-Ausfall wird so NIE zum Fehler des ganzen
// Preisvergleichs. Der beschreibende User-Agent wird auch hier mitgeschickt.
async function itadPreiseFuerTitel(_0xtitel, _0xkey) {
  try {
    const _0xt = String(_0xtitel || "").trim();
    const _0xk = String(_0xkey || "").trim();
    if (!_0xt || !_0xk) {
      return [];
    }
    // 1) Spiel suchen -> interne ITAD-ID.
    const _0xtreffer = await fetchJson("https://api.isthereanydeal.com/games/search/v1?key=" + encodeURIComponent(_0xk) + "&title=" + encodeURIComponent(_0xt) + "&results=5", {
      headers: {
        "User-Agent": PREIS_USER_AGENT
      }
    }, 10000);
    // v2 liefert die Treffer entweder direkt als Array oder unter .data.
    const _0xliste = Array.isArray(_0xtreffer) ? _0xtreffer : _0xtreffer && Array.isArray(_0xtreffer.data) ? _0xtreffer.data : [];
    if (!_0xliste.length) {
      return [];
    }
    // Bevorzugt exakter Titel, sonst der erste Treffer.
    const _0xexakt = _0xliste.find(_0xg => _0xg && preisNorm(_0xg.title) === preisNorm(_0xt));
    const _0xspiel = _0xexakt || _0xliste[0];
    const _0xid = _0xspiel && _0xspiel.id;
    if (!_0xid) {
      return [];
    }
    // 2) Aktuelle Preise. v3-Endpunkt ist ein POST mit Liste von IDs im Body.
    // country=DE liefert EUR-Preise. deals=true bringt die Store-Links mit.
    const _0xpreise = await fetchJson("https://api.isthereanydeal.com/games/prices/v3?key=" + encodeURIComponent(_0xk) + "&country=DE&deals=true", {
      method: "POST",
      headers: {
        "User-Agent": PREIS_USER_AGENT,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([_0xid])
    }, 10000);
    if (!Array.isArray(_0xpreise)) {
      return [];
    }
    const _0xeintrag = _0xpreise.find(_0xp => _0xp && _0xp.id === _0xid) || _0xpreise[0];
    const _0xdeals = _0xeintrag && Array.isArray(_0xeintrag.deals) ? _0xeintrag.deals : [];
    const _0xproStore = new Map();
    for (const _0xd of _0xdeals) {
      if (!_0xd) {
        continue;
      }
      const _0xstore = _0xd.shop && (_0xd.shop.name || _0xd.shop.id) || "Store";
      const _0xpreis = _0xd.price && typeof _0xd.price.amount === "number" ? _0xd.price.amount : parseFloat(_0xd.price && _0xd.price.amount);
      if (isNaN(_0xpreis)) {
        continue;
      }
      const _0xschluessel = preisNorm(_0xstore);
      const _0xvorher = _0xproStore.get(_0xschluessel);
      if (_0xvorher && _0xvorher.preis <= _0xpreis) {
        continue;
      }
      const _0xnormal = _0xd.regular && _0xd.regular.amount;
      _0xproStore.set(_0xschluessel, {
        quelle: "itad",
        store: String(_0xstore),
        preis: _0xpreis,
        normalpreis: typeof _0xnormal === "number" ? _0xnormal : null,
        waehrung: _0xd.price && _0xd.price.currency || "EUR",
        rabatt: Math.round(_0xd.cut || 0),
        link: _0xd.url || "",
        verfuegbar: true
      });
    }
    return Array.from(_0xproStore.values());
  } catch {
    return [];
  }
}
// Fuehrt beide Quellen zusammen: guenstigster zuerst; bei gleichem Store hat
// ITAD (EUR) Vorrang vor CheapShark (USD). Eintraege ohne Preis ans Ende.
async function preisVergleichHolen(_0xtitel) {
  try {
    const _0xt = String(_0xtitel || "").trim();
    if (!_0xt) {
      return {
        ok: false
      };
    }
    const _0xkey = preisNorm(_0xt);
    const _0xnow = Date.now();
    const _0xgemerkt = _preisVergleichCache.get(_0xkey);
    if (_0xgemerkt && _0xnow - _0xgemerkt.ts < PREIS_CACHE_MS) {
      return _0xgemerkt.data;
    }
    const _0xstores = await fetchCheapSharkStores();
    const _0xitadKey = String((loadSettings() || {}).itadSchluessel || "").trim();
    // Beide Quellen parallel. ITAD nur, wenn ein Schluessel hinterlegt ist -
    // sonst gar nicht erst anfragen (kein Fehler, einfach weglassen).
    const [_0xcs, _0xitad] = await Promise.all([cheapSharkPreiseFuerTitel(_0xt, _0xstores), _0xitadKey ? itadPreiseFuerTitel(_0xt, _0xitadKey) : Promise.resolve([])]);
    // Zusammenfuehren ueber den Store-Namen. ITAD wird NACH CheapShark
    // eingespielt und ueberschreibt so denselben Store (EUR bevorzugt).
    const _0xproStore = new Map();
    for (const _0xe of _0xcs) {
      if (_0xe) {
        _0xproStore.set(preisNorm(_0xe.store), _0xe);
      }
    }
    for (const _0xe of _0xitad) {
      if (_0xe) {
        _0xproStore.set(preisNorm(_0xe.store), _0xe);
      }
    }
    const _0xalle = Array.from(_0xproStore.values());
    // Sortierung: verfuegbare nach Preis aufsteigend, nicht verfuegbare ans Ende.
    _0xalle.sort((_0xa, _0xb) => {
      const _0xav = _0xa.verfuegbar && typeof _0xa.preis === "number";
      const _0xbv = _0xb.verfuegbar && typeof _0xb.preis === "number";
      if (_0xav && !_0xbv) {
        return -1;
      }
      if (!_0xav && _0xbv) {
        return 1;
      }
      if (!_0xav && !_0xbv) {
        return 0;
      }
      return _0xa.preis - _0xb.preis;
    });
    const _0xguenstigster = _0xalle.find(_0xe => _0xe.verfuegbar && typeof _0xe.preis === "number") || null;
    const _0xdaten = {
      ok: true,
      titel: _0xt,
      eintraege: _0xalle,
      guenstigster: _0xguenstigster
    };
    _preisVergleichCache.set(_0xkey, {
      ts: _0xnow,
      data: _0xdaten
    });
    return _0xdaten;
  } catch {
    return {
      ok: false
    };
  }
}
// CheapShark-Kandidaten zu einem Titel: die games-Suche liefert je Spiel-Eintrag
// eine gameID + Titel + (bei Basis-Spielen) steamAppID + thumb. Damit kann der
// Nutzer VOR dem Vergleich das genaue Spiel per Cover waehlen - so wird "Forza
// Horizon 5" nicht mit "...Premium Add-Ons Bundle" verwechselt. Kein Key noetig.
async function cheapSharkKandidaten(_0xtitel) {
  try {
    const _0xt = String(_0xtitel || "").trim();
    if (!_0xt) return [];
    const _0xarr = await fetchJson("https://www.cheapshark.com/api/1.0/games?title=" + encodeURIComponent(_0xt) + "&limit=15", {
      headers: { "User-Agent": PREIS_USER_AGENT }
    }, 10000);
    if (!Array.isArray(_0xarr)) return [];
    return _0xarr.map(_0xg => ({
      gameID: String(_0xg.gameID || ""),
      titel: _0xg.external || "",
      steamAppId: _0xg.steamAppID || null,
      // Steam-Capsule (scharf) fuer Basis-Spiele, sonst der CheapShark-thumb.
      cover: _0xg.steamAppID ? "https://cdn.cloudflare.steamstatic.com/steam/apps/" + _0xg.steamAppID + "/library_600x900.jpg" : _0xg.thumb || null,
      thumb: _0xg.thumb || null
    })).filter(_0xg => _0xg.gameID);
  } catch {
    return [];
  }
}
// Exakte Store-Preise EINES CheapShark-Spiels (per gameID) - anders als die
// deals?title=-Suche mischt das keine fremden Editionen mehr zusammen.
async function cheapSharkPreiseFuerGameId(_0xgameId, _0xstores) {
  try {
    const _0xid = String(_0xgameId || "").trim();
    if (!_0xid) return [];
    const _0xd = await fetchJson("https://www.cheapshark.com/api/1.0/games?id=" + encodeURIComponent(_0xid), {
      headers: { "User-Agent": PREIS_USER_AGENT }
    }, 10000);
    const _0xdeals = _0xd && Array.isArray(_0xd.deals) ? _0xd.deals : [];
    const _0xproStore = new Map();
    for (const _0xx of _0xdeals) {
      const _0xsale = parseFloat(_0xx.price);
      if (isNaN(_0xsale)) continue;
      const _0xstore = _0xstores && _0xstores[String(_0xx.storeID)] || "Store " + _0xx.storeID;
      const _0xk = preisNorm(_0xstore);
      const _0xv = _0xproStore.get(_0xk);
      if (_0xv && _0xv.preis <= _0xsale) continue;
      const _0xnormal = parseFloat(_0xx.retailPrice);
      _0xproStore.set(_0xk, {
        quelle: "cheapshark",
        store: _0xstore,
        preis: _0xsale,
        normalpreis: isNaN(_0xnormal) ? null : _0xnormal,
        waehrung: "USD",
        rabatt: Math.round(parseFloat(_0xx.savings) || 0),
        link: "https://www.cheapshark.com/redirect?dealID=" + _0xx.dealID,
        verfuegbar: true
      });
    }
    return Array.from(_0xproStore.values());
  } catch {
    return [];
  }
}
// CheapShark- und ITAD-Eintraege zusammenfuehren (ITAD/EUR ueberschreibt gleichen
// Store), guenstigster zuerst, ohne Preis ans Ende. Gemeinsam genutzt von der
// genauen (per gameID) und der titelbasierten Variante.
function preisEintraegeMergen(_0xcs, _0xitad, _0xtitel) {
  const _0xproStore = new Map();
  for (const _0xe of _0xcs || []) if (_0xe) _0xproStore.set(preisNorm(_0xe.store), _0xe);
  for (const _0xe of _0xitad || []) if (_0xe) _0xproStore.set(preisNorm(_0xe.store), _0xe);
  const _0xalle = Array.from(_0xproStore.values());
  _0xalle.sort((_0xa, _0xb) => {
    const _0xav = _0xa.verfuegbar && typeof _0xa.preis === "number";
    const _0xbv = _0xb.verfuegbar && typeof _0xb.preis === "number";
    if (_0xav && !_0xbv) return -1;
    if (!_0xav && _0xbv) return 1;
    if (!_0xav && !_0xbv) return 0;
    return _0xa.preis - _0xb.preis;
  });
  return {
    ok: true,
    titel: _0xtitel,
    eintraege: _0xalle,
    guenstigster: _0xalle.find(_0xe => _0xe.verfuegbar && typeof _0xe.preis === "number") || null
  };
}
// Genauer Vergleich fuer ein AUSGEWAEHLTES Spiel: CheapShark exakt ueber die
// gameID + ITAD ueber den (exakten) Titel. So kein Editions-Mischmasch mehr.
async function preisVergleichGenau(_0xgameId, _0xtitel) {
  try {
    const _0xt = String(_0xtitel || "").trim();
    const _0xgid = String(_0xgameId || "").trim();
    if (!_0xgid && !_0xt) return { ok: false };
    const _0xkey = "genau:" + preisNorm(_0xt) + ":" + _0xgid;
    const _0xnow = Date.now();
    const _0xgemerkt = _preisVergleichCache.get(_0xkey);
    if (_0xgemerkt && _0xnow - _0xgemerkt.ts < PREIS_CACHE_MS) return _0xgemerkt.data;
    const _0xstores = await fetchCheapSharkStores();
    const _0xitadKey = String((loadSettings() || {}).itadSchluessel || "").trim();
    const [_0xcs, _0xitad] = await Promise.all([
      _0xgid ? cheapSharkPreiseFuerGameId(_0xgid, _0xstores) : Promise.resolve([]),
      _0xitadKey && _0xt ? itadPreiseFuerTitel(_0xt, _0xitadKey) : Promise.resolve([])
    ]);
    const _0xdaten = preisEintraegeMergen(_0xcs, _0xitad, _0xt || _0xgid);
    _preisVergleichCache.set(_0xkey, { ts: _0xnow, data: _0xdaten });
    return _0xdaten;
  } catch {
    return { ok: false };
  }
}
// ── ITAD-Shops als Kanaele ──────────────────────────────────────────────────
// Zusaetzlich zu den vier launcher-eigenen Kanaelen (Steam/Epic/Xbox/Vystra)
// koennen ALLE von IsThereAnyDeal gefuehrten Stores als Shop-Kanaele erscheinen.
// Zwei Abfragen: die Shop-Liste (OEFFENTLICH, ohne Schluessel) und - pro Shop -
// die aktuellen Angebote (mit Schluessel). Beides defensiv und gecacht; ein
// Ausfall darf NIE den Shop lahmlegen, darum liefert alles im Fehlerfall leere
// bzw. {ok:false}-Ergebnisse statt zu werfen. Der beschreibende User-Agent ist
// bei ITAD Pflicht (sonst HTTP 400/403), also ueberall mitschicken.
let _itadShopsCache = null; // { ts, shops:[...] }
const ITAD_SHOPS_CACHE_MS = 6 * 60 * 60 * 1000; // Shop-Liste aendert sich fast nie -> 6 h
const _itadAngeboteCache = new Map(); // shopId(String) -> { ts, data }
const ITAD_ANGEBOTE_CACHE_MS = 15 * 60 * 1000; // Angebote ~15 min
// Shop-Liste holen (kein Schluessel noetig). Absteigend nach Zahl der gefuehrten
// Spiele, damit die grossen Stores oben stehen.
async function itadShopsHolen() {
  const _0xnow = Date.now();
  if (_itadShopsCache && _0xnow - _itadShopsCache.ts < ITAD_SHOPS_CACHE_MS) {
    return _itadShopsCache.shops;
  }
  try {
    const _0xroh = await fetchJson("https://api.isthereanydeal.com/service/shops/v1?country=DE", {
      headers: {
        "User-Agent": PREIS_USER_AGENT
      }
    }, 10000);
    const _0xliste = Array.isArray(_0xroh) ? _0xroh : [];
    // Nur die Felder behalten, die die Oberflaeche braucht - vereinheitlicht.
    const _0xshops = _0xliste.map(_0xs => ({
      id: _0xs && _0xs.id,
      title: _0xs && (_0xs.title || String(_0xs.id)),
      deals: _0xs && typeof _0xs.deals === "number" ? _0xs.deals : 0,
      games: _0xs && typeof _0xs.games === "number" ? _0xs.games : 0
    })).filter(_0xs => _0xs.id != null);
    _0xshops.sort((_0xa, _0xb) => (_0xb.games || 0) - (_0xa.games || 0));
    _itadShopsCache = {
      ts: _0xnow,
      shops: _0xshops
    };
    return _0xshops;
  } catch {
    // Bei Fehler die zuletzt bekannte Liste weiterreichen (statt gar nichts).
    return _itadShopsCache ? _itadShopsCache.shops : [];
  }
}
// Angebote eines Shops holen (mit Schluessel), vereinheitlicht und nach Rabatt
// absteigend. Kein Schluessel -> {ok:false, fehler:"kein-key"} (die Oberflaeche
// zeigt dann einen Hinweis). Defensiv gegen geaenderte Feldnamen: die Liste
// steckt entweder unter .list oder ist direkt ein Array.
async function itadAngeboteHolen(_0xshopId, _0xlimit) {
  const _0xid = _0xshopId == null ? "" : String(_0xshopId).trim();
  if (!_0xid) {
    return {
      ok: false,
      fehler: "kein-shop"
    };
  }
  const _0xkey = String((loadSettings() || {}).itadSchluessel || "").trim();
  if (!_0xkey) {
    return {
      ok: false,
      fehler: "kein-key"
    };
  }
  const _0xlim = Math.max(1, Math.min(60, parseInt(_0xlimit, 10) || 40));
  const _0xnow = Date.now();
  const _0xgemerkt = _itadAngeboteCache.get(_0xid);
  if (_0xgemerkt && _0xnow - _0xgemerkt.ts < ITAD_ANGEBOTE_CACHE_MS) {
    return _0xgemerkt.data;
  }
  try {
    const _0xroh = await fetchJson("https://api.isthereanydeal.com/deals/v2?key=" + encodeURIComponent(_0xkey) + "&country=DE&shops=" + encodeURIComponent(_0xid) + "&limit=" + _0xlim, {
      headers: {
        "User-Agent": PREIS_USER_AGENT
      }
    }, 12000);
    // Feld "list" ODER direkt ein Array behandeln (Route liefert je nach Fassung beides).
    const _0xliste = _0xroh && Array.isArray(_0xroh.list) ? _0xroh.list : Array.isArray(_0xroh) ? _0xroh : [];
    const _0xangebote = [];
    for (const _0xe of _0xliste) {
      if (!_0xe) {
        continue;
      }
      const _0xdeal = _0xe.deal || {};
      const _0xpreis = _0xdeal.price && typeof _0xdeal.price.amount === "number" ? _0xdeal.price.amount : null;
      const _0xnormal = _0xdeal.regular && typeof _0xdeal.regular.amount === "number" ? _0xdeal.regular.amount : null;
      _0xangebote.push({
        titel: String(_0xe.title || ""),
        store: _0xdeal.shop && _0xdeal.shop.name || "",
        preis: _0xpreis,
        normalpreis: _0xnormal,
        waehrung: _0xdeal.price && _0xdeal.price.currency || "EUR",
        rabatt: Math.round(_0xdeal.cut || 0),
        link: _0xdeal.url || ""
      });
    }
    _0xangebote.sort((_0xa, _0xb) => (_0xb.rabatt || 0) - (_0xa.rabatt || 0));
    const _0xdaten = {
      ok: true,
      shopId: _0xid,
      angebote: _0xangebote
    };
    _itadAngeboteCache.set(_0xid, {
      ts: _0xnow,
      data: _0xdaten
    });
    return _0xdaten;
  } catch {
    return {
      ok: false,
      fehler: "netz"
    };
  }
}
async function fetchEpicShop() {
  const _0x129fbe = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=de-DE&country=AT&allowCountries=AT";
  const _0xa9b4e4 = await fetchJson(_0x129fbe);
  const _0x45b473 = _0xa9b4e4?.data?.Catalog?.searchStore?.elements || [];
  return _0x45b473.filter(_0x2fd5ba => _0x2fd5ba.title && _0x2fd5ba.price?.totalPrice?.discountPrice === 0 && _0x2fd5ba.promotions?.promotionalOffers?.length > 0).map(_0x1cb3ea => {
    const _0x144568 = (_0x1cb3ea.keyImages || []).find(_0x3993dc => _0x3993dc.type === "OfferImageWide") || (_0x1cb3ea.keyImages || [])[0];
    const _0x447f46 = epicCleanSlug(_0x1cb3ea.catalogNs?.mappings?.[0]?.pageSlug || _0x1cb3ea.productSlug || _0x1cb3ea.urlSlug || "");
    return {
      platform: "epic",
      category: "Kostenlos bei Epic",
      id: _0x1cb3ea.id,
      title: _0x1cb3ea.title,
      image: _0x144568 ? _0x144568.url : null,
      priceCents: 0,
      originalPriceCents: _0x1cb3ea.price?.totalPrice?.originalPrice || null,
      discountPercent: 100,
      currency: "EUR",
      catalogNamespace: _0x1cb3ea.namespace || "",
      catalogItemId: _0x1cb3ea.id,
      urlSlug: _0x447f46,
      storeUrl: _0x447f46 ? "https://store.epicgames.com/de/p/" + _0x447f46 : "https://store.epicgames.com/de/free-games"
    };
  });
}
async function fetchEpicCatalog(_0x182ab5 = "", _0x335ea8 = 0, _0x397c46 = 40) {
  const _0x1488f4 = "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=de-DE&country=AT&allowCountries=AT";
  try {
    const _0x1acc18 = await fetchJson(_0x1488f4, {}, 10000);
    let _0x4f3e3f = _0x1acc18?.data?.Catalog?.searchStore?.elements || [];
    const _0x7c71e1 = new Set();
    let _0x3d26db = _0x4f3e3f.filter(_0x46b14a => {
      if (!_0x46b14a.title || _0x7c71e1.has(_0x46b14a.id)) {
        return false;
      }
      _0x7c71e1.add(_0x46b14a.id);
      return true;
    }).map(_0x6cc153 => {
      const _0xcbe7b0 = (_0x6cc153.keyImages || []).find(_0x2626af => ["OfferImageWide", "DieselStoreFrontWide", "Thumbnail"].includes(_0x2626af.type)) || (_0x6cc153.keyImages || [])[0];
      const _0x402e60 = epicCleanSlug(_0x6cc153.catalogNs?.mappings?.[0]?.pageSlug || _0x6cc153.productSlug || _0x6cc153.urlSlug || "");
      const _0x5d5eca = _0x6cc153.price?.totalPrice;
      const _0x34867e = _0x6cc153.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0]?.startDate || null;
      const _0x5ee6e5 = _0x6cc153.releaseDate || _0x34867e || null;
      const _0x5088c9 = isUnreleased(_0x6cc153.releaseDate) || isUnreleased(_0x34867e);
      return {
        platform: "epic",
        category: "Epic Store",
        id: _0x6cc153.id,
        title: _0x6cc153.title,
        image: _0xcbe7b0 ? _0xcbe7b0.url : null,
        priceCents: _0x5d5eca ? _0x5d5eca.discountPrice : null,
        originalPriceCents: _0x5d5eca && _0x5d5eca.discount > 0 ? _0x5d5eca.originalPrice : null,
        discountPercent: _0x5d5eca && _0x5d5eca.originalPrice && _0x5d5eca.discount > 0 ? Math.round(_0x5d5eca.discount / _0x5d5eca.originalPrice * 100) : 0,
        currency: _0x5d5eca?.currencyCode || "EUR",
        seller: _0x6cc153.seller?.name || "Epic Games",
        releaseDate: _0x5ee6e5,
        comingSoon: _0x5088c9,
        catalogNamespace: _0x6cc153.namespace || "",
        catalogItemId: _0x6cc153.id,
        urlSlug: _0x402e60,
        storeUrl: _0x402e60 ? "https://store.epicgames.com/de/p/" + _0x402e60 : "https://store.epicgames.com/de"
      };
    });
    if (_0x182ab5) {
      const _0x22f264 = _0x182ab5.toLowerCase();
      _0x3d26db = _0x3d26db.filter(_0x2068e4 => _0x2068e4.title.toLowerCase().includes(_0x22f264));
    }
    return {
      items: _0x3d26db,
      total: _0x3d26db.length,
      page: _0x335ea8,
      pageSize: _0x397c46
    };
  } catch (_0x99f906) {
    console.error("Epic-Katalog laden fehlgeschlagen:", _0x99f906.message);
    return {
      items: [],
      total: 0,
      page: _0x335ea8,
      pageSize: _0x397c46
    };
  }
}
function htmlToText(_0x246a36) {
  if (!_0x246a36) {
    return "";
  }
  return _0x246a36.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<img[^>]*>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}
async function steamStoreSearchTerm(_0xterm, _0xpage = 0, _0xpageSize = 50) {
  // api/storesearch findet auch 18+/NSFW-Titel, die Steam in /search/results/
  // (HTML) bewusst ausblendet – ohne Login und oft trotz Mature-Cookies.
  const _0xurl = "https://store.steampowered.com/api/storesearch/?term=" + encodeURIComponent(_0xterm) + "&cc=at&l=" + steamLang();
  const _0xdata = await fetchJson(_0xurl, {
    headers: steamMatureHeaders()
  }, 12000);
  const _0xall = Array.isArray(_0xdata && _0xdata.items) ? _0xdata.items : [];
  const _0xapps = _0xall.filter(_0xit => _0xit && (_0xit.type === "app" || _0xit.type === "game") && _0xit.id && _0xit.name);
  const _0xstart = Math.max(0, (_0xpage || 0) * (_0xpageSize || 50));
  const _0xslice = _0xapps.slice(_0xstart, _0xstart + (_0xpageSize || 50));
  return {
    items: _0xslice.map(_0xit => {
      const _0xfinal = _0xit.price && _0xit.price.final != null ? Number(_0xit.price.final) : null;
      const _0xinit = _0xit.price && _0xit.price.initial != null ? Number(_0xit.price.initial) : null;
      const _0xdisc = _0xinit && _0xfinal != null && _0xinit > _0xfinal ? Math.round((1 - _0xfinal / _0xinit) * 100) : 0;
      return {
        platform: "steam",
        category: "Katalog",
        id: String(_0xit.id),
        title: String(_0xit.name),
        image: "https://cdn.cloudflare.steamstatic.com/steam/apps/" + _0xit.id + "/header.jpg",
        imageFallback: _0xit.tiny_image || null,
        priceCents: _0xfinal,
        originalPriceCents: _0xdisc > 0 ? _0xinit : null,
        discountPercent: _0xdisc,
        currency: _0xit.price && _0xit.price.currency || "EUR",
        releaseDate: null,
        comingSoon: false,
        storeUrl: "https://store.steampowered.com/app/" + _0xit.id
      };
    }),
    total: _0xapps.length,
    page: _0xpage || 0,
    pageSize: _0xpageSize || 50
  };
}
function steamMatureHeaders() {
  // Steam blendet Adult-only-Titel ohne Alters-Cookies aus der Store-Suche aus.
  let _0xok = false;
  try {
    const _0xs = loadSettings();
    _0xok = !!(_0xs && _0xs.adultAnzeigen);
  } catch {}
  if (!_0xok) {
    return {};
  }
  return {
    Cookie: "birthtime=628473600; lastagecheckage=1-0-1990; wants_mature_content=1; wants_mature_content_apps=1; mature_content=1"
  };
}
async function steamCatalogSearch(_0x9f8f65 = "", _0x54dbc3 = 0, _0x1e9eb2 = 50, _0x8b1b28 = "", _0x1e0813 = false) {
  // Textsuche: Store-Search-API (findet 18+), HTML-Katalog nur fuer Browse/Filter.
  if (_0x9f8f65 && String(_0x9f8f65).trim()) {
    return await steamStoreSearchTerm(String(_0x9f8f65).trim(), _0x54dbc3, _0x1e9eb2);
  }
  const _0x830411 = _0x54dbc3 * _0x1e9eb2;
  const _0x29226e = _0x8b1b28.includes("sort_by") ? "" : "&sort_by=Reviews_DESC";
  // Standard: 18+/NSFW-Tags aus dem Steam-Katalog ausblenden (Nudity, Adult-Only,
  // NSFW, Sexual Content). Mit Einstellung adultAnzeigen entfallen diese Filter.
  let _0xadultOk = false;
  try {
    const _0xsAdult = loadSettings();
    _0xadultOk = !!(_0xsAdult && _0xsAdult.adultAnzeigen);
  } catch {}
  const _0xuntags = _0xadultOk ? "" : "&untags=9130,24904,12095,6650";
  const _0x1d7b3a = _0xuntags + (_0x1e0813 ? "" : "&category1=998");
  const _0x24ad7c = "https://store.steampowered.com/search/results/?query&term=&start=" + _0x830411 + "&count=" + _0x1e9eb2 + "&cc=at&l=" + steamLang() + "&infinite=1" + _0x29226e + _0x1d7b3a + _0x8b1b28;
  const _0x58b6ae = await fetchJson(_0x24ad7c, {
    headers: steamMatureHeaders()
  }, 12000);
  if (!_0x58b6ae || !_0x58b6ae.results_html) {
    return {
      items: [],
      total: 0,
      page: _0x54dbc3,
      pageSize: _0x1e9eb2
    };
  }
  const _0x50f59c = _0x412686 => _0x412686.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const _0x20260b = [];
  const _0x2933c6 = new Set();
  for (const _0x1a0528 of String(_0x58b6ae.results_html).split("<a ").slice(1)) {
    const _0xb9e1c6 = (_0x1a0528.match(/data-ds-appid="(\d+)/) || [])[1];
    const _0x1a8852 = (_0x1a0528.match(/<span class="title">([^<]+)<\/span>/) || [])[1];
    if (!_0xb9e1c6 || !_0x1a8852) {
      continue;
    }
    if (_0x2933c6.has(_0xb9e1c6)) {
      continue;
    }
    _0x2933c6.add(_0xb9e1c6);
    const _0x25fe96 = (_0x1a0528.match(/data-price-final="(\d+)"/) || [])[1];
    const _0x3fc1e1 = parseInt((_0x1a0528.match(/data-discount="(\d+)"/) || [])[1] || "0", 10);
    const _0x47f2e6 = _0x25fe96 !== undefined ? parseInt(_0x25fe96, 10) : null;
    const _0xb197dc = (_0x1a0528.match(/<img[^>]*\ssrc="([^"]+)"/) || [])[1] || null;
    const _0x3964ca = _0x50f59c((_0x1a0528.match(/search_released[^>]*>([^<]*)</) || [])[1] || "");
    const _0x567c07 = isUnreleased(_0x3964ca);
    _0x20260b.push({
      platform: "steam",
      category: "Katalog",
      id: _0xb9e1c6,
      title: _0x50f59c(_0x1a8852),
      image: "https://cdn.cloudflare.steamstatic.com/steam/apps/" + _0xb9e1c6 + "/header.jpg",
      imageFallback: _0xb197dc,
      priceCents: _0x47f2e6,
      originalPriceCents: _0x3fc1e1 > 0 && _0x47f2e6 != null ? Math.round(_0x47f2e6 / (100 - _0x3fc1e1) * 100) : null,
      discountPercent: _0x3fc1e1,
      currency: "EUR",
      releaseDate: _0x3964ca || null,
      comingSoon: _0x567c07,
      storeUrl: "https://store.steampowered.com/app/" + _0xb9e1c6
    });
  }
  return {
    items: _0x20260b,
    total: _0x58b6ae.total_count || _0x20260b.length,
    page: _0x54dbc3,
    pageSize: _0x1e9eb2
  };
}
async function fetchSteamDetails(_0x481b66) {
  const _0xmatH = {
    headers: steamMatureHeaders()
  };
  const [_0x57ef5b, _0x518a44] = await Promise.all([fetchJson("https://store.steampowered.com/api/appdetails?appids=" + _0x481b66 + "&cc=at&l=" + steamLang(), _0xmatH), fetchJson("https://store.steampowered.com/appreviews/" + _0x481b66 + "?json=1&language=all&purchase_type=all&num_per_page=0", _0xmatH)]);
  const _0x316115 = _0x57ef5b && _0x57ef5b[_0x481b66];
  const _0x4d1fd2 = _0x316115 && _0x316115.success ? _0x316115.data : null;
  if (!_0x4d1fd2) {
    return null;
  }
  const _0x5c4dfb = _0x518a44 && _0x518a44.query_summary;
  return {
    platform: "steam",
    id: String(_0x481b66),
    title: _0x4d1fd2.name,
    heroImage: _0x4d1fd2.header_image,
    screenshots: (_0x4d1fd2.screenshots || []).map(_0x6c8e85 => ({
      thumb: _0x6c8e85.path_thumbnail,
      full: _0x6c8e85.path_full
    })),
    movies: (_0x4d1fd2.movies || []).map(_0x5b2afa => ({
      title: _0x5b2afa.name || "Trailer",
      thumb: _0x5b2afa.thumbnail || null,
      mp4: _0x5b2afa.mp4 && (_0x5b2afa.mp4.max || _0x5b2afa.mp4["480"]) || null,
      hls: _0x5b2afa.hls_h264 || null,
      dash: _0x5b2afa.dash_h264 || null
    })).filter(_0x5e4de7 => _0x5e4de7.mp4 || _0x5e4de7.hls),
    editions: (_0x4d1fd2.package_groups || []).flatMap(_0x2a7044 => (_0x2a7044.subs || []).map(_0x541c97 => ({
      id: _0x541c97.packageid,
      text: htmlToText(_0x541c97.option_text || ""),
      priceCents: typeof _0x541c97.price_in_cents_with_discount === "number" ? _0x541c97.price_in_cents_with_discount : null
    }))).filter(_0x293298 => _0x293298.text),
    adult: (parseInt(_0x4d1fd2.required_age, 10) || 0) >= 18 || (_0x4d1fd2.content_descriptors && _0x4d1fd2.content_descriptors.ids || []).some(_0x5201b5 => [1, 3, 4].includes(_0x5201b5)),
    contentNotes: _0x4d1fd2.content_descriptors && _0x4d1fd2.content_descriptors.notes ? htmlToText(_0x4d1fd2.content_descriptors.notes) : null,
    shortDescription: _0x4d1fd2.short_description || "",
    description: htmlToText(_0x4d1fd2.about_the_game || _0x4d1fd2.detailed_description),
    developers: _0x4d1fd2.developers || [],
    publishers: _0x4d1fd2.publishers || [],
    releaseDate: _0x4d1fd2.release_date ? _0x4d1fd2.release_date.date : null,
    comingSoon: _0x4d1fd2.release_date && _0x4d1fd2.release_date.coming_soon != null ? !!_0x4d1fd2.release_date.coming_soon : isUnreleased(_0x4d1fd2.release_date ? _0x4d1fd2.release_date.date : ""),
    genres: (_0x4d1fd2.genres || []).map(_0x41fcb1 => _0x41fcb1.description),
    categories: (_0x4d1fd2.categories || []).map(_0x14cf9d => _0x14cf9d.description),
    priceCents: _0x4d1fd2.is_free ? 0 : _0x4d1fd2.price_overview ? _0x4d1fd2.price_overview.final : null,
    originalPriceCents: _0x4d1fd2.price_overview ? _0x4d1fd2.price_overview.initial : null,
    discountPercent: _0x4d1fd2.price_overview ? _0x4d1fd2.price_overview.discount_percent : 0,
    rating: _0x5c4dfb && _0x5c4dfb.total_reviews ? {
      stars: Math.round(_0x5c4dfb.total_positive / _0x5c4dfb.total_reviews * 50) / 10,
      count: _0x5c4dfb.total_reviews,
      desc: _0x5c4dfb.review_score_desc || ""
    } : null,
    requiredAge: parseInt(_0x4d1fd2.required_age, 10) || 0,
    website: _0x4d1fd2.website || null,
    storeUrl: "https://store.steampowered.com/app/" + _0x481b66
  };
}
function epicCleanSlug(_0xslug) {
  return String(_0xslug || "").split("/")[0].trim().replace(/^-+|-+$/g, "");
}
function epicSlugFromGame(_0xg) {
  if (!_0xg || typeof _0xg !== "object") {
    return "";
  }
  const _0xdirect = _0xg.urlSlug || _0xg.pageSlug || _0xg.productSlug || "";
  if (_0xdirect) {
    return epicCleanSlug(_0xdirect);
  }
  const _0xstore = String(_0xg.storeUrl || "");
  const _0xm = _0xstore.match(/\/(?:p|product)\/([^/?#]+)/i);
  if (_0xm) {
    return epicCleanSlug(_0xm[1]);
  }
  const _0xtitle = String(_0xg.title || "").trim();
  if (!_0xtitle) {
    return "";
  }
  return epicCleanSlug(_0xtitle.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[''`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-"));
}
async function fetchEpicStoreContent(_0xslug) {
  const _0xclean = epicCleanSlug(_0xslug);
  if (!_0xclean) {
    return null;
  }
  for (const _0xloc of ["de", "en-US", "en"]) {
    const _0xdata = await fetchJson("https://store-content.ak.epicgames.com/api/" + _0xloc + "/content/products/" + encodeURIComponent(_0xclean), {
      headers: {
        Accept: "application/json"
      }
    }, 10000);
    if (_0xdata && (Array.isArray(_0xdata.pages) || _0xdata._slug || _0xdata.productName)) {
      return _0xdata;
    }
  }
  return null;
}
function epicMediaUrl(_0xval) {
  if (!_0xval) {
    return null;
  }
  if (typeof _0xval === "string") {
    return _0xval.startsWith("//") ? "https:" + _0xval : _0xval;
  }
  const _0xsrc = _0xval.src || _0xval.url || _0xval.Uri || _0xval.uri || null;
  return _0xsrc ? epicMediaUrl(_0xsrc) : null;
}
async function fetchEpicDetails(_0xa9075f) {
  const _0x1a85e0 = _0xa9075f && (_0xa9075f.id || _0xa9075f.catalogItemId) || null;
  const _0xns = _0xa9075f && (_0xa9075f.catalogNamespace || _0xa9075f.namespace) || "";
  const _0xofferId = _0xa9075f && (_0xa9075f.catalogItemId || _0xa9075f.id) || "";
  let _0xslug = epicSlugFromGame(_0xa9075f);
  let _0xoffer = null;
  if (_0xns && _0xofferId) {
    _0xoffer = await fetchEpicOfferById(_0xns, _0xofferId);
    if (_0xoffer && _0xoffer.urlSlug) {
      _0xslug = epicCleanSlug(_0xoffer.urlSlug);
    }
  }
  const _0xcontent = _0xslug ? await fetchEpicStoreContent(_0xslug) : null;
  const _0xpages = _0xcontent && Array.isArray(_0xcontent.pages) ? _0xcontent.pages : [];
  const _0xhome = _0xpages.find(_0xp => _0xp && (_0xp.type === "productHome" || _0xp._slug === "home")) || _0xpages[0] || null;
  const _0xdata = _0xhome && _0xhome.data || {};
  const _0xabout = _0xdata.about || {};
  const _0xhero = _0xdata.hero || {};
  const _0xshots = [];
  const _0xseen = new Set();
  const _0xpushShot = _0xu => {
    const _0xurl = epicMediaUrl(_0xu);
    if (!_0xurl || _0xseen.has(_0xurl)) {
      return;
    }
    // Bewertungs-/Icon-Bilder aus _images_ rausfiltern
    if (/rating|esrb|pegi|usk|suggestedrating|age.?gate/i.test(_0xurl) || /-\d{2,3}x\d{2,3}-/.test(_0xurl) && !/2560|1920|1440|1280/.test(_0xurl)) {
      return;
    }
    _0xseen.add(_0xurl);
    _0xshots.push({
      thumb: _0xurl,
      full: _0xurl
    });
  };
  const _0xcarousel = _0xdata.carousel && Array.isArray(_0xdata.carousel.items) ? _0xdata.carousel.items : [];
  for (const _0xitem of _0xcarousel) {
    if (_0xitem && _0xitem.image) {
      _0xpushShot(_0xitem.image);
    }
  }
  const _0xgallery = _0xdata.gallery && Array.isArray(_0xdata.gallery.galleryImages) ? _0xdata.gallery.galleryImages : [];
  for (const _0xg of _0xgallery) {
    _0xpushShot(_0xg && (_0xg.src || _0xg.image || _0xg));
  }
  if (Array.isArray(_0xcontent && _0xcontent._images_)) {
    for (const _0ximg of _0xcontent._images_) {
      _0xpushShot(_0ximg);
    }
  }
  const _0xkeyImgs = _0xoffer && Array.isArray(_0xoffer.keyImages) ? _0xoffer.keyImages : [];
  for (const _0xki of _0xkeyImgs) {
    if (_0xki && (_0xki.type === "Screenshot" || /screenshot/i.test(_0xki.type || ""))) {
      _0xpushShot(_0xki.url);
    }
  }
  let _0xheroImage = epicMediaUrl(_0xhero.backgroundImageUrl) || epicMediaUrl(_0xhero.portraitBackgroundImageUrl) || null;
  if (!_0xheroImage && _0xkeyImgs.length) {
    const _0xwide = _0xkeyImgs.find(_0xk => _0xk.type === "OfferImageWide" || _0xk.type === "DieselStoreFrontWide" || _0xk.type === "featuredMedia");
    _0xheroImage = (_0xwide || _0xkeyImgs[0]).url || null;
  }
  if (!_0xshots.length && _0xheroImage) {
    _0xshots.push({
      thumb: _0xheroImage,
      full: _0xheroImage
    });
  }
  if (!_0xcontent && !_0xoffer && !_0xshots.length && !_0xheroImage) {
    return null;
  }
  const _0xdescRaw = _0xabout.description || _0xoffer && (_0xoffer.longDescription || _0xoffer.description) || "";
  const _0xshortRaw = _0xabout.shortDescription || _0xoffer && _0xoffer.description || "";
  const _0xdev = _0xabout.developerAttribution || _0xoffer && (_0xoffer.developerDisplayName || _0xoffer.developer) || "";
  const _0xpub = _0xabout.publisherAttribution || _0xoffer && (_0xoffer.publisherDisplayName || _0xoffer.seller && _0xoffer.seller.name) || "";
  const _0xslugOut = _0xslug || epicCleanSlug(_0xcontent && _0xcontent._slug) || "";
  return {
    platform: "epic",
    id: _0x1a85e0,
    title: _0xabout.title || _0xcontent && _0xcontent.productName || _0xoffer && _0xoffer.title || _0xa9075f.title,
    heroImage: _0xheroImage,
    screenshots: _0xshots,
    movies: [],
    editions: [],
    adult: false,
    contentNotes: null,
    shortDescription: htmlToText(_0xshortRaw || _0xdescRaw).slice(0, 300),
    description: htmlToText(_0xdescRaw || _0xshortRaw),
    developers: _0xdev ? [String(_0xdev)] : [],
    publishers: _0xpub ? [String(_0xpub)] : [],
    releaseDate: _0xoffer && _0xoffer.releaseDate ? new Date(_0xoffer.releaseDate).toLocaleDateString("de-DE", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }) : _0xa9075f.releaseDate || null,
    genres: [],
    categories: [],
    priceCents: typeof _0xa9075f.priceCents === "number" ? _0xa9075f.priceCents : _0xoffer && typeof _0xoffer.currentPrice === "number" ? _0xoffer.currentPrice : null,
    originalPriceCents: typeof _0xa9075f.originalPriceCents === "number" ? _0xa9075f.originalPriceCents : null,
    discountPercent: _0xa9075f.discountPercent || 0,
    rating: null,
    requiredAge: 0,
    website: null,
    storeUrl: _0xslugOut ? "https://store.epicgames.com/de/p/" + _0xslugOut : _0xa9075f.storeUrl || "https://store.epicgames.com"
  };
}
const libraryCache = new Map();
async function fetchUserProfile() {
  const _0x3b171c = loadSettings();
  const _0xd5a8ed = await findSteamPath();
  const _0x2ddc67 = _0xd5a8ed ? detectSteamUser(_0xd5a8ed) : null;
  const _0xf06d99 = (_0x3b171c.steamId64 || "").trim() || (_0x2ddc67 ? _0x2ddc67.steamId : null);
  const _0x232aac = {
    viscode: _0x3b171c.user ? {
      userId: _0x3b171c.user.username,
      username: _0x3b171c.user.displayName || _0x3b171c.user.username,
      email: _0x3b171c.user.email || null,
      avatar: _0x3b171c.user.avatar || null,
      demo: !!_0x3b171c.user.demo
    } : null,
    steam: null,
    epic: null
  };
  if (_0xf06d99) {
    const _0x54eb66 = {
      steamId: _0xf06d99,
      persona: _0x2ddc67?.persona || null,
      avatar: null,
      profileUrl: null,
      realName: null,
      country: null
    };
    {
      const _0x3f7720 = await fetchJson("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=" + encodeURIComponent(effectiveSteamKey(_0x3b171c)) + "&steamids=" + _0xf06d99, {}, 6000);
      const _0x124a25 = _0x3f7720?.response?.players?.[0];
      if (_0x124a25) {
        _0x54eb66.persona = _0x124a25.personaname || _0x54eb66.persona;
        _0x54eb66.avatar = _0x124a25.avatarfull || _0x124a25.avatarmedium || _0x124a25.avatar || null;
        _0x54eb66.profileUrl = _0x124a25.profileurl || null;
        _0x54eb66.realName = _0x124a25.realname || null;
        _0x54eb66.country = _0x124a25.loccountrycode || null;
      }
    }
    if (!_0x54eb66.avatar) {
      const _0x319df7 = await fetchText("https://steamcommunity.com/profiles/" + _0xf06d99 + "/?xml=1", 6000);
      if (_0x319df7) {
        const _0x4369aa = _0x319df7.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/);
        const _0x42dc4c = _0x319df7.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
        if (_0x4369aa) {
          _0x54eb66.avatar = _0x4369aa[1];
        }
        if (_0x42dc4c) {
          _0x54eb66.persona = _0x42dc4c[1];
        }
        _0x54eb66.profileUrl = "https://steamcommunity.com/profiles/" + _0xf06d99;
      }
    }
    _0x232aac.steam = _0x54eb66;
  }
  try {
    const _0x5ac66d = path.join(process.env.LOCALAPPDATA || "", "EpicGamesLauncher", "Saved", "Config", "Windows");
    const _0x1e6be1 = path.join(_0x5ac66d, "GameUserSettings.ini");
    if (fs.existsSync(_0x1e6be1)) {
      const _0x4b94cf = fs.readFileSync(_0x1e6be1, "utf8");
      const _0x45323d = _0x4b94cf.match(/\[Launcher\][\s\S]*?Data=(.+)/);
      _0x232aac.epic = {
        installed: true
      };
    }
  } catch {}
  return _0x232aac;
}
async function fetchSteamAchievements(_0x985bfa) {
  const _0x2f21a8 = loadSettings();
  const _0x1c8636 = await findSteamPath();
  const _0x1fa66d = _0x1c8636 ? detectSteamUser(_0x1c8636) : null;
  const _0x3b5145 = (_0x2f21a8.steamId64 || "").trim() || (_0x1fa66d ? _0x1fa66d.steamId : null);
  if (!_0x3b5145) {
    return null;
  }
  const _0x2513ac = effectiveSteamKey(_0x2f21a8);
  try {
    const _0x4f7d79 = await fetchJson("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=" + _0x985bfa + "&key=" + encodeURIComponent(_0x2513ac) + "&steamid=" + _0x3b5145 + "&l=" + steamLang(), {}, 8000);
    const _0x1ab867 = _0x4f7d79?.playerstats?.achievements;
    if (Array.isArray(_0x1ab867) && _0x1ab867.length) {
      const _0x5c3682 = _0x1ab867.filter(_0x6bd625 => _0x6bd625.achieved === 1).length;
      return {
        total: _0x1ab867.length,
        unlocked: _0x5c3682,
        achievements: _0x1ab867.map(_0x31e918 => ({
          apiname: _0x31e918.apiname,
          achieved: _0x31e918.achieved === 1,
          name: _0x31e918.name || _0x31e918.apiname,
          description: _0x31e918.description || ""
        }))
      };
    }
  } catch (_0x1bbf16) {
    console.error("Fehler beim Laden der Steam-Erfolge:", _0x1bbf16);
  }
  return null;
}
function braceContentAt(_0x119cd8, _0x3e8cdb) {
  const _0x1a2171 = _0x119cd8.indexOf("{", _0x3e8cdb);
  if (_0x1a2171 < 0) {
    return "";
  }
  let _0x35e3d9 = 0;
  for (let _0x204875 = _0x1a2171; _0x204875 < _0x119cd8.length; _0x204875++) {
    if (_0x119cd8[_0x204875] === "{") {
      _0x35e3d9++;
    } else if (_0x119cd8[_0x204875] === "}") {
      _0x35e3d9--;
      if (_0x35e3d9 === 0) {
        return _0x119cd8.slice(_0x1a2171 + 1, _0x204875);
      }
    }
  }
  return "";
}
function scanSteamFriendsLocal(_0x54ce37) {
  if (!_0x54ce37) {
    return null;
  }
  const _0x2406df = path.join(_0x54ce37, "userdata");
  let _0x19f727 = [];
  try {
    _0x19f727 = fs.readdirSync(_0x2406df).filter(_0x130813 => /^\d+$/.test(_0x130813));
  } catch {
    return null;
  }
  const _0x3d17b3 = [];
  const _0x2da4d3 = new Set();
  for (const _0x327361 of _0x19f727) {
    let _0x38beb1;
    try {
      _0x38beb1 = fs.readFileSync(path.join(_0x2406df, _0x327361, "config", "localconfig.vdf"), "utf8");
    } catch {
      continue;
    }
    const _0x27a69e = vdfBlock(_0x38beb1, "friends");
    if (!_0x27a69e) {
      continue;
    }
    const _0x2e7a4b = /"(\d{6,10})"\s*\{/g;
    let _0x268101;
    while ((_0x268101 = _0x2e7a4b.exec(_0x27a69e)) !== null) {
      const _0x5858c0 = _0x268101[1];
      if (_0x5858c0 === _0x327361 || _0x2da4d3.has(_0x5858c0)) {
        continue;
      }
      const _0x4ca65a = braceContentAt(_0x27a69e, _0x268101.index);
      const _0xafae75 = (_0x4ca65a.match(/"name"\s*"([^"]*)"/i) || [])[1];
      if (!_0xafae75) {
        continue;
      }
      _0x2da4d3.add(_0x5858c0);
      const _0x2aecfe = (_0x4ca65a.match(/"avatar"\s*"([a-f0-9]{40})"/i) || [])[1];
      _0x3d17b3.push({
        name: _0xafae75,
        avatar: _0x2aecfe ? "https://avatars.steamstatic.com/" + _0x2aecfe + "_full.jpg" : null,
        status: "unknown",
        gameId: null,
        gameTitle: null,
        steamId: (BigInt("76561197960265728") + BigInt(_0x5858c0)).toString()
      });
    }
  }
  _0x3d17b3.sort((_0x4e2978, _0x3ef269) => _0x4e2978.name.localeCompare(_0x3ef269.name, "de"));
  if (_0x3d17b3.length) {
    return _0x3d17b3;
  } else {
    return null;
  }
}
async function fetchSteamFriends() {
  const _0x29075d = loadSettings();
  const _0x3d4efd = await findSteamPath();
  const _0x2cc4fd = _0x3d4efd ? detectSteamUser(_0x3d4efd) : null;
  const _0x5db4fa = (_0x29075d.steamId64 || "").trim() || (_0x2cc4fd ? _0x2cc4fd.steamId : null);
  const _0x505032 = effectiveSteamKey(_0x29075d);
  if (!_0x5db4fa || !_0x505032) {
    return scanSteamFriendsLocal(_0x3d4efd);
  }
  try {
    const _0xe3ee99 = await fetchJson("https://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=" + encodeURIComponent(_0x505032) + "&steamid=" + _0x5db4fa + "&relationship=friend", {}, 8000);
    const _0xb33b61 = _0xe3ee99?.friendslist?.friends;
    if (Array.isArray(_0xb33b61) && _0xb33b61.length) {
      const _0x4e2c01 = _0xb33b61.map(_0x44d31a => _0x44d31a.steamid).slice(0, 40).join(",");
      const _0x388bb3 = await fetchJson("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=" + encodeURIComponent(_0x505032) + "&steamids=" + _0x4e2c01, {}, 8000);
      const _0x56f31b = _0x388bb3?.response?.players;
      if (Array.isArray(_0x56f31b)) {
        return _0x56f31b.map(_0x34700d => {
          let _0x9fa8f5 = "offline";
          if (_0x34700d.gameid) {
            _0x9fa8f5 = "playing";
          } else if (_0x34700d.personastate > 0) {
            _0x9fa8f5 = "online";
          }
          return {
            name: _0x34700d.personaname,
            avatar: _0x34700d.avatarfull || _0x34700d.avatarmedium || _0x34700d.avatar || null,
            status: _0x9fa8f5,
            gameId: _0x34700d.gameid || null,
            gameTitle: _0x34700d.gameextrainfo || null,
            steamId: _0x34700d.steamid || null
          };
        });
      }
    }
  } catch (_0x561903) {
    console.error("Fehler beim Laden der Steam-Freunde:", _0x561903);
  }
  return scanSteamFriendsLocal(_0x3d4efd);
}
async function fetchSteamPlayerSummary(_0x52741f) {
  const _0x4ba42f = loadSettings();
  const _0x2dbb60 = effectiveSteamKey(_0x4ba42f);
  _0x52741f = String(_0x52741f || "").trim();
  if (!_0x52741f) {
    return {
      ok: false,
      error: "Keine Steam-ID."
    };
  }
  if (!_0x2dbb60) {
    return {
      ok: false,
      error: "Kein Steam-Key.",
      profileUrl: "https://steamcommunity.com/profiles/" + _0x52741f
    };
  }
  const _0x379911 = {
    ok: true,
    steamId: _0x52741f,
    profileUrl: "https://steamcommunity.com/profiles/" + _0x52741f
  };
  try {
    const _0x2b5a8f = await fetchJson("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=" + encodeURIComponent(_0x2dbb60) + "&steamids=" + _0x52741f, {}, 8000);
    const _0x4e5779 = _0x2b5a8f?.response?.players?.[0];
    if (_0x4e5779) {
      _0x379911.name = _0x4e5779.personaname || null;
      _0x379911.avatar = _0x4e5779.avatarfull || _0x4e5779.avatarmedium || _0x4e5779.avatar || null;
      _0x379911.profileUrl = _0x4e5779.profileurl || _0x379911.profileUrl;
      _0x379911.realName = _0x4e5779.realname || null;
      _0x379911.country = _0x4e5779.loccountrycode || null;
      _0x379911.createdAt = _0x4e5779.timecreated ? _0x4e5779.timecreated * 1000 : null;
      _0x379911.lastLogoff = _0x4e5779.lastlogoff ? _0x4e5779.lastlogoff * 1000 : null;
      _0x379911.visibility = _0x4e5779.communityvisibilitystate;
      _0x379911.gameTitle = _0x4e5779.gameextrainfo || null;
      _0x379911.gameId = _0x4e5779.gameid || null;
      let _0x547fa1 = "offline";
      if (_0x4e5779.gameid) {
        _0x547fa1 = "playing";
      } else if (_0x4e5779.personastate > 0) {
        _0x547fa1 = "online";
      }
      _0x379911.status = _0x547fa1;
    }
  } catch (_0x31cf76) {
    console.error("GetPlayerSummaries fehlgeschlagen:", _0x31cf76);
  }
  try {
    const _0x3aec05 = await fetchJson("https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=" + encodeURIComponent(_0x2dbb60) + "&steamid=" + _0x52741f, {}, 6000);
    if (_0x3aec05?.response?.player_level != null) {
      _0x379911.level = _0x3aec05.response.player_level;
    }
  } catch {}
  try {
    const _0x426c77 = await fetchJson("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=" + encodeURIComponent(_0x2dbb60) + "&steamid=" + _0x52741f + "&count=6", {}, 7000);
    const _0x210f6b = _0x426c77?.response?.games;
    if (Array.isArray(_0x210f6b)) {
      _0x379911.recentGames = _0x210f6b.map(_0x1f88e3 => ({
        appid: _0x1f88e3.appid,
        name: _0x1f88e3.name,
        minutes2weeks: _0x1f88e3.playtime_2weeks || 0,
        minutesTotal: _0x1f88e3.playtime_forever || 0,
        image: "https://steamcdn-a.akamaihd.net/steam/apps/" + _0x1f88e3.appid + "/capsule_231x87.jpg"
      }));
    }
  } catch {}
  return _0x379911;
}
const EPIC_TOKEN_URL = "https://api.epicgames.dev/epic/oauth/v2/token";
const EPIC_ACCOUNTS_URL = "https://api.epicgames.dev/epic/id/v2/accounts";
const EPIC_FRIENDS_URL = _0x9dcc73 => "https://api.epicgames.dev/epic/friends/v1/" + _0x9dcc73 + "/friends";
const EPIC_SCOPES = "basic_profile friends_list presence";
function epicConfigured(_0x310513) {
  return !!_0x310513.epicClientId && !!_0x310513.epicClientSecret && !!_0x310513.epicDeploymentId;
}
function epicAuthorizeUrl(_0x59b755, _0x45823f) {
  const _0x288f1b = new URLSearchParams({
    client_id: _0x59b755.epicClientId,
    response_type: "code",
    scope: EPIC_SCOPES
  });
  if (_0x45823f) {
    _0x288f1b.set("redirect_uri", _0x45823f);
  }
  return "https://www.epicgames.com/id/authorize?" + _0x288f1b.toString();
}
async function epicExchangeCode(_0x1dfb0b, _0x557c40, _0x3ef747 = "authorization_code") {
  const _0x1af0d0 = "Basic " + Buffer.from(_0x1dfb0b.epicClientId + ":" + _0x1dfb0b.epicClientSecret).toString("base64");
  const _0x474c88 = new URLSearchParams({
    grant_type: _0x3ef747,
    deployment_id: _0x1dfb0b.epicDeploymentId,
    scope: EPIC_SCOPES
  });
  if (_0x3ef747 === "authorization_code") {
    _0x474c88.set("code", _0x557c40);
  } else if (_0x3ef747 === "refresh_token") {
    _0x474c88.set("refresh_token", _0x557c40);
  }
  const _0x4ec407 = await fetchJson(EPIC_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: _0x1af0d0,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: _0x474c88.toString()
  }, 12000);
  if (!_0x4ec407 || !_0x4ec407.access_token) {
    throw new Error(_0x4ec407?.errorMessage || "Kein Access-Token von Epic erhalten.");
  }
  _0x1dfb0b.epicAccessToken = _0x4ec407.access_token;
  _0x1dfb0b.epicRefreshToken = _0x4ec407.refresh_token || _0x1dfb0b.epicRefreshToken || "";
  _0x1dfb0b.epicAccountId = _0x4ec407.account_id || _0x1dfb0b.epicAccountId || "";
  _0x1dfb0b.epicTokenExpiresAt = Date.now() + (_0x4ec407.expires_in || 7000) * 1000 - 60000;
  saveSettings(_0x1dfb0b);
  return _0x4ec407;
}
async function epicEnsureToken(_0x5a2a81) {
  if (_0x5a2a81.epicAccessToken && Date.now() < (_0x5a2a81.epicTokenExpiresAt || 0)) {
    return _0x5a2a81.epicAccessToken;
  }
  if (_0x5a2a81.epicRefreshToken) {
    try {
      await epicExchangeCode(_0x5a2a81, _0x5a2a81.epicRefreshToken, "refresh_token");
      return _0x5a2a81.epicAccessToken;
    } catch (_0x3b7a19) {
      console.error("Epic-Token-Refresh fehlgeschlagen:", _0x3b7a19.message);
    }
  }
  return null;
}
async function epicResolveNames(_0x516a2e, _0x3c0a5d) {
  const _0x49d283 = {};
  for (let _0x4d290d = 0; _0x4d290d < _0x3c0a5d.length; _0x4d290d += 50) {
    const _0x39f104 = _0x3c0a5d.slice(_0x4d290d, _0x4d290d + 50);
    const _0x7ae2e = _0x39f104.map(_0x43e148 => "accountId=" + encodeURIComponent(_0x43e148)).join("&");
    try {
      const _0x29db85 = await fetchJson(EPIC_ACCOUNTS_URL + "?" + _0x7ae2e, {
        headers: {
          Authorization: "Bearer " + _0x516a2e
        }
      }, 10000);
      if (Array.isArray(_0x29db85)) {
        for (const _0x29aeee of _0x29db85) {
          _0x49d283[_0x29aeee.accountId] = _0x29aeee.displayName || _0x29aeee.accountId;
        }
      }
    } catch (_0xa0745c) {
      console.error("Epic-Namensauflösung fehlgeschlagen:", _0xa0745c.message);
    }
  }
  return _0x49d283;
}
async function fetchEpicFriends() {
  const _0x546204 = loadSettings();
  if (!epicConfigured(_0x546204) || !_0x546204.epicAccountId) {
    return {
      ok: false,
      error: "Epic nicht verbunden.",
      friends: []
    };
  }
  const _0x4dac0f = await epicEnsureToken(_0x546204);
  if (!_0x4dac0f) {
    return {
      ok: false,
      error: "Epic-Anmeldung abgelaufen – bitte neu verbinden.",
      friends: []
    };
  }
  try {
    const _0x17a692 = await fetchJson(EPIC_FRIENDS_URL(_0x546204.epicAccountId), {
      headers: {
        Authorization: "Bearer " + _0x4dac0f
      }
    }, 10000);
    const _0x260cb2 = Array.isArray(_0x17a692) ? _0x17a692 : _0x17a692?.friends || [];
    const _0x23ef29 = _0x260cb2.filter(_0x53fb26 => !_0x53fb26.status || /friend|accept/i.test(_0x53fb26.status));
    const _0x206798 = _0x23ef29.map(_0x139bde => _0x139bde.accountId).filter(Boolean);
    const _0x151a53 = await epicResolveNames(_0x4dac0f, _0x206798);
    const _0x4a3b5d = _0x23ef29.map(_0x572c34 => ({
      name: _0x572c34.nickname || _0x151a53[_0x572c34.accountId] || _0x572c34.accountId,
      avatar: null,
      status: "unknown",
      gameId: null,
      gameTitle: null,
      platform: "epic",
      epicId: _0x572c34.accountId
    }));
    return {
      ok: true,
      friends: _0x4a3b5d
    };
  } catch (_0x2967d2) {
    console.error("Epic-Freunde laden fehlgeschlagen:", _0x2967d2.message);
    return {
      ok: false,
      error: "Epic-Freunde konnten nicht geladen werden (Zustimmung/Scopes prüfen).",
      friends: []
    };
  }
}
async function epicLogin() {
  const _0x44101d = loadSettings();
  if (!epicConfigured(_0x44101d)) {
    return {
      ok: false,
      needsConfig: true,
      error: "Bitte zuerst Epic Client-ID, Secret und Deployment-ID in den Einstellungen eintragen (aus dem Epic Dev Portal)."
    };
  }
  const _0xcodeAus = _0xu => {
    try {
      const _0xq = new URL(_0xu).searchParams;
      return _0xq.get("code") || _0xq.get("authorizationCode");
    } catch {
      return null;
    }
  };
  return await echterBrowserLogin({
    url: epicAuthorizeUrl(_0x44101d),
    titel: "Mit Epic Games anmelden",
    trefferPruefung: _0xu => !!_0xcodeAus(_0xu),
    codeHolen: async _0xu => {
      const _0x35b552 = await epicExchangeCode(_0x44101d, _0xcodeAus(_0xu));
      try {
        const _0x7e6ce2 = await epicResolveNames(_0x44101d.epicAccessToken, [_0x35b552.account_id]);
        _0x44101d.epicDisplayName = _0x7e6ce2[_0x35b552.account_id] || "";
        _0x44101d.connectEpic = true;
        saveSettings(_0x44101d);
      } catch {}
      return {
        ok: true,
        accountId: _0x44101d.epicAccountId,
        displayName: _0x44101d.epicDisplayName
      };
    }
  });
}
const EPIC_LAUNCHER_CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a";
const EPIC_LAUNCHER_SECRET = "daafbccc737745039dffe53d94fc76cf";
const EPIC_OAUTH_TOKEN_URL = "https://account-public-service-prod.ol.epicgames.com/account/removed";
const EPIC_LIBRARY_URL = "https://library-service.live.use1a.on.epicgames.com/library/api/public/items";
const EPIC_CATALOG_BASE = "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared";
const EPIC_REDIRECT_URL = "https://www.epicgames.com/id/api/redirect?clientId=" + EPIC_LAUNCHER_CLIENT_ID + "&responseType=code";
const EPIC_UA = "UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.19041.1.256.64bit";
function epicLauncherBasic() {
  return "basic " + Buffer.from(EPIC_LAUNCHER_CLIENT_ID + ":" + EPIC_LAUNCHER_SECRET).toString("base64");
}
async function epicLauncherExchange(_0xe95e67, _0x372e37) {
  const _0x50f04a = new URLSearchParams({
    grant_type: _0xe95e67,
    token_type: "eg1"
  });
  if (_0xe95e67 === "authorization_code") {
    _0x50f04a.set("code", _0x372e37);
  } else if (_0xe95e67 === "refresh_token") {
    _0x50f04a.set("refresh_token", _0x372e37);
  }
  const _0x21324a = await fetchJson(EPIC_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: epicLauncherBasic(),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": EPIC_UA
    },
    body: _0x50f04a.toString()
  }, 15000);
  if (!_0x21324a || !_0x21324a.access_token) {
    throw new Error("Kein Epic-Launcher-Token erhalten (Code abgelaufen oder ungültig?).");
  }
  const _0x51e7e4 = loadSettings();
  _0x51e7e4.epicLauncherAccessToken = _0x21324a.access_token;
  _0x51e7e4.epicLauncherRefreshToken = _0x21324a.refresh_token || _0x51e7e4.epicLauncherRefreshToken || "";
  _0x51e7e4.epicLauncherAccountId = _0x21324a.account_id || _0x51e7e4.epicLauncherAccountId || "";
  _0x51e7e4.epicLauncherDisplayName = _0x21324a.displayName || _0x51e7e4.epicLauncherDisplayName || "";
  _0x51e7e4.epicLauncherExpiresAt = _0x21324a.expires_at ? Date.parse(_0x21324a.expires_at) - 60000 : Date.now() + (_0x21324a.expires_in || 7200) * 1000 - 60000;
  _0x51e7e4.connectEpic = true;
  saveSettings(_0x51e7e4);
  return _0x21324a;
}
async function epicLauncherEnsureToken() {
  const _0x2f2f9d = loadSettings();
  if (_0x2f2f9d.epicLauncherAccessToken && Date.now() < (_0x2f2f9d.epicLauncherExpiresAt || 0)) {
    return _0x2f2f9d.epicLauncherAccessToken;
  }
  if (_0x2f2f9d.epicLauncherRefreshToken) {
    try {
      await epicLauncherExchange("refresh_token", _0x2f2f9d.epicLauncherRefreshToken);
      return loadSettings().epicLauncherAccessToken;
    } catch (_0x583a68) {
      console.error("Epic-Launcher-Refresh fehlgeschlagen:", _0x583a68.message);
    }
  }
  return null;
}
async function epicLauncherLogin() {
  return await echterBrowserLogin({
    url: "https://www.epicgames.com/id/login?redirectUrl=" + encodeURIComponent(EPIC_REDIRECT_URL),
    titel: "Mit Epic Games anmelden (Bibliothek)",
    trefferPruefung: _0xu => _0xu.includes("/id/api/redirect"),
    codeHolen: async (_0xu, _0xseite) => {
      const _0xtext = await Promise.resolve(_0xseite.executeJavaScript("document.body ? document.body.innerText : ''", true)).catch(() => null);
      let _0xcode = null;
      if (_0xtext) {
        try {
          _0xcode = JSON.parse(_0xtext).authorizationCode;
        } catch {}
      }
      if (!_0xcode) {
        try {
          _0xcode = new URL(_0xu).searchParams.get("code");
        } catch {}
      }
      // Noch nicht angemeldet: die Seite zeigt authorizationCode=null -> weiter warten.
      if (!_0xcode) {
        return null;
      }
      await epicLauncherExchange("authorization_code", _0xcode);
      const _0xs = loadSettings();
      return {
        ok: true,
        accountId: _0xs.epicLauncherAccountId,
        displayName: _0xs.epicLauncherDisplayName
      };
    }
  });
}
// ─────────────────────────────────────────────────────────────────────────────
// GOG + Ubisoft: Kontoverknüpfung
//
// SICHERHEIT: Der Launcher hat KEIN eigenes Passwortfeld für Plattformen und
// nimmt NIEMALS ein Plattform-Passwort entgegen. Der Nutzer meldet sich immer
// auf der Original-Anmeldeseite der jeweiligen Plattform in einem eingebetteten
// BrowserWindow an. Wir lesen ausschliesslich den Rueckgabe-Code bzw. das
// fertige Ticket aus – niemals Eingabefelder. Genau wie beim Epic-Weg.
// ─────────────────────────────────────────────────────────────────────────────

// Gemeinsamer Fenster-Login. Optionen:
//   url            – Adresse der Original-Anmeldeseite
//   titel          – Fenstertitel
//   trefferPruefung(adresse) → true, wenn es sich lohnt, codeHolen aufzurufen
//   codeHolen(adresse, webContents) → Ergebnis-Objekt | null (null = weiter warten)
//   pollMs         – optional: zusaetzlich regelmaessig nachsehen (fuer Seiten
//                    ohne eindeutige Rueckleitungs-Adresse, z. B. Ubisoft)
//   maxDauerMs     – Notaus, damit nichts endlos haengt (Standard 5 Minuten)
function oauthFensterLogin(_0xoptFL) {
  const _0xoFL = _0xoptFL || {};
  return new Promise(_0xfertigFL => {
    let _0xerledigtFL = false;
    let _0xlaeuftFL = false;
    let _0xfensterFL = null;
    let _0xnotausFL = null;
    let _0xpollFL = null;
    const _0xbeendenFL = _0xergFL => {
      if (_0xerledigtFL) {
        return;
      }
      _0xerledigtFL = true;
      if (_0xnotausFL) {
        clearTimeout(_0xnotausFL);
        _0xnotausFL = null;
      }
      if (_0xpollFL) {
        clearInterval(_0xpollFL);
        _0xpollFL = null;
      }
      try {
        if (_0xfensterFL && !_0xfensterFL.isDestroyed()) {
          _0xfensterFL.close();
        }
      } catch {}
      _0xfertigFL(_0xergFL);
    };
    try {
      _0xfensterFL = new BrowserWindow({
        width: _0xoFL.breite || 520,
        height: _0xoFL.hoehe || 760,
        title: _0xoFL.titel || "Anmelden",
        autoHideMenuBar: true,
        parent: mainWindow || undefined,
        modal: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
    } catch (_0xe1FL) {
      _0xfertigFL({
        ok: false,
        error: "Anmeldefenster konnte nicht geöffnet werden: " + (_0xe1FL && _0xe1FL.message || "unbekannt")
      });
      return;
    }
    _0xnotausFL = setTimeout(() => _0xbeendenFL({
      ok: false,
      error: "Zeitüberschreitung – die Anmeldung wurde nicht abgeschlossen."
    }), _0xoFL.maxDauerMs || 300000);
    const _0xadresseFL = () => {
      try {
        return _0xfensterFL && !_0xfensterFL.isDestroyed() ? _0xfensterFL.webContents.getURL() : "";
      } catch {
        return "";
      }
    };
    const _0xpruefenFL = async _0xrohFL => {
      if (_0xerledigtFL || _0xlaeuftFL) {
        return;
      }
      if (!_0xfensterFL || _0xfensterFL.isDestroyed()) {
        return;
      }
      const _0xadrFL = String(_0xrohFL || "");
      let _0xtrefferFL = false;
      try {
        _0xtrefferFL = typeof _0xoFL.trefferPruefung === "function" ? !!_0xoFL.trefferPruefung(_0xadrFL) : true;
      } catch {
        _0xtrefferFL = false;
      }
      if (!_0xtrefferFL) {
        return;
      }
      _0xlaeuftFL = true;
      try {
        const _0xergFL = await _0xoFL.codeHolen(_0xadrFL, _0xfensterFL.webContents);
        if (_0xergFL) {
          _0xbeendenFL(_0xergFL);
        }
      } catch (_0xe2FL) {
        _0xbeendenFL({
          ok: false,
          error: _0xe2FL && _0xe2FL.message || "Anmeldung fehlgeschlagen."
        });
      } finally {
        _0xlaeuftFL = false;
      }
    };
    try {
      _0xfensterFL.webContents.on("did-navigate", (_0xa1FL, _0xu1FL) => _0xpruefenFL(_0xu1FL));
      _0xfensterFL.webContents.on("did-redirect-navigation", (_0xa2FL, _0xu2FL) => _0xpruefenFL(_0xu2FL));
      _0xfensterFL.webContents.on("did-navigate-in-page", (_0xa3FL, _0xu3FL) => _0xpruefenFL(_0xu3FL));
      _0xfensterFL.webContents.on("did-frame-navigate", (_0xa4FL, _0xu4FL) => _0xpruefenFL(_0xu4FL));
      _0xfensterFL.webContents.on("did-finish-load", () => _0xpruefenFL(_0xadresseFL()));
      _0xfensterFL.webContents.on("did-fail-load", (_0xa5FL, _0xcodeFL, _0xbeschrFL, _0xurlFL, _0xhauptFL) => {
        // -3 = ERR_ABORTED (normal bei Weiterleitungen) → ignorieren.
        if (_0xhauptFL && _0xcodeFL !== -3 && !_0xerledigtFL) {
          _0xbeendenFL({
            ok: false,
            error: "Anmeldeseite nicht erreichbar (" + (_0xbeschrFL || _0xcodeFL) + ") – Internetverbindung prüfen."
          });
        }
      });
    } catch {}
    if (_0xoFL.pollMs) {
      _0xpollFL = setInterval(() => _0xpruefenFL(_0xadresseFL()), _0xoFL.pollMs);
    }
    _0xfensterFL.on("closed", () => {
      if (_0xnotausFL) {
        clearTimeout(_0xnotausFL);
        _0xnotausFL = null;
      }
      if (_0xpollFL) {
        clearInterval(_0xpollFL);
        _0xpollFL = null;
      }
      if (!_0xerledigtFL) {
        _0xerledigtFL = true;
        _0xfertigFL({
          ok: false,
          canceled: true
        });
      }
    });
    try {
      _0xfensterFL.loadURL(_0xoFL.url);
    } catch {
      _0xbeendenFL({
        ok: false,
        error: "Anmeldeseite konnte nicht geladen werden."
      });
    }
  });
}

// ── Anmelden im echten Browser ───────────────────────────────────────────────
// Gleiche Optionen wie oauthFensterLogin, aber die Anmeldeseite oeffnet sich in
// einem echten Edge/Chrome mit eigenem, dauerhaftem Vystra-Profil. Epic, GOG und
// Microsoft leiten auf ihre EIGENEN festen Seiten zurueck - ein Rueckweg in den
// Launcher existiert nicht. Deshalb liest der Launcher die Tabs ueber den
// DevTools-Port (nur 127.0.0.1) mit und holt den Code dort ab. Das Profil ist
// absichtlich nicht das normale Browser-Profil: Chrome/Edge erlauben den
// DevTools-Port fuer das Standardprofil nicht mehr.
// Ohne Edge/Chrome faellt alles auf das bisherige Launcher-Fenster zurueck.
let _anmeldeBrowser = null;
function anmeldeProfilOrdner() {
  const _0xbasis = path.join(app.getPath("userData"), "webprofiles", "anmelden");
  try {
    const _0xst = fs.statfsSync(path.parse(_0xbasis).root);
    // Ein frisches Browser-Profil braucht schnell 100 MB und mehr.
    if (_0xst.bavail * _0xst.bsize < 400 * 1024 * 1024) {
      return path.join(os.tmpdir(), "vystra-anmelde-profil");
    }
  } catch {}
  return _0xbasis;
}
function freierLokalPort() {
  return new Promise((_0xok, _0xfehler) => {
    const _0xsrv = require("net").createServer();
    _0xsrv.unref();
    _0xsrv.on("error", _0xfehler);
    _0xsrv.listen(0, "127.0.0.1", () => {
      const _0xport = _0xsrv.address().port;
      _0xsrv.close(() => _0xok(_0xport));
    });
  });
}
function cdpSenden(_0xwsUrl, _0xmethode, _0xparams) {
  return new Promise(_0xok => {
    let _0xWS = null;
    try {
      _0xWS = require("ws").WebSocket;
    } catch {
      return _0xok(null);
    }
    let _0xsock = null;
    let _0xtimer = null;
    const _0xende = _0xwert => {
      clearTimeout(_0xtimer);
      try {
        _0xsock.close();
      } catch {}
      _0xok(_0xwert);
    };
    _0xtimer = setTimeout(() => _0xende(null), 5000);
    try {
      _0xsock = new _0xWS(_0xwsUrl, { perMessageDeflate: false });
    } catch {
      return _0xende(null);
    }
    _0xsock.on("open", () => _0xsock.send(JSON.stringify({ id: 1, method: _0xmethode, params: _0xparams || {} })));
    _0xsock.on("message", _0xdaten => {
      try {
        const _0xm = JSON.parse(String(_0xdaten));
        if (_0xm.id === 1) {
          _0xende(_0xm.result || null);
        }
      } catch {}
    });
    _0xsock.on("error", () => _0xende(null));
  });
}
async function cdpAusfuehren(_0xwsUrl, _0xausdruck) {
  const _0xerg = await cdpSenden(_0xwsUrl, "Runtime.evaluate", { expression: _0xausdruck, returnByValue: true, awaitPromise: true });
  return _0xerg && _0xerg.result ? _0xerg.result.value : null;
}
async function echterBrowserLogin(_0xoptEB) {
  const _0xo = _0xoptEB || {};
  const _0xexe = findAppBrowser();
  if (!_0xexe) {
    return oauthFensterLogin(_0xo);
  }
  if (_anmeldeBrowser) {
    try {
      _anmeldeBrowser.proc.kill();
    } catch {}
    _anmeldeBrowser = null;
    await new Promise(_0xr => setTimeout(_0xr, 800));
  }
  const _0xprofil = anmeldeProfilOrdner();
  try {
    fs.mkdirSync(_0xprofil, { recursive: true });
  } catch {}
  let _0xport = 0;
  let _0xproc = null;
  try {
    _0xport = await freierLokalPort();
    _0xproc = spawn(_0xexe, ["--remote-debugging-port=" + _0xport, "--user-data-dir=" + _0xprofil, "--no-first-run", "--no-default-browser-check", "--new-window", _0xo.url], { stdio: "ignore" });
    _0xproc.on("error", () => {});
  } catch {
    return oauthFensterLogin(_0xo);
  }
  const _0xbrowser = { proc: _0xproc, port: _0xport };
  _anmeldeBrowser = _0xbrowser;
  const _0xbasisUrl = "http://127.0.0.1:" + _0xport;
  return await new Promise(_0xfertig => {
    let _0xerledigt = false;
    let _0xlaeuft = false;
    let _0xverbunden = false;
    let _0xfehlversuche = 0;
    const _0xstart = Date.now();
    let _0xpoll = null;
    let _0xnotaus = null;
    const _0xbrowserZu = async () => {
      try {
        const _0xv = await (await fetch(_0xbasisUrl + "/json/version", { signal: AbortSignal.timeout(2000) })).json();
        if (_0xv && _0xv.webSocketDebuggerUrl) {
          await cdpSenden(_0xv.webSocketDebuggerUrl, "Browser.close");
        }
      } catch {}
      setTimeout(() => {
        try {
          _0xproc.kill();
        } catch {}
      }, 1500);
      if (_anmeldeBrowser === _0xbrowser) {
        _anmeldeBrowser = null;
      }
    };
    const _0xbeenden = (_0xerg, _0xbrowserSchliessen = true) => {
      if (_0xerledigt) {
        return;
      }
      _0xerledigt = true;
      clearInterval(_0xpoll);
      clearTimeout(_0xnotaus);
      if (_0xbrowserSchliessen) {
        _0xbrowserZu();
      }
      if (_0xerg && _0xerg.ok) {
        hauptfensterZeigen();
      }
      _0xfertig(_0xerg);
    };
    const _0xrunde = async () => {
      if (_0xerledigt || _0xlaeuft) {
        return;
      }
      _0xlaeuft = true;
      try {
        let _0xziele = null;
        try {
          _0xziele = await (await fetch(_0xbasisUrl + "/json/list", { signal: AbortSignal.timeout(2000) })).json();
        } catch {}
        if (!Array.isArray(_0xziele)) {
          _0xfehlversuche++;
          if (_0xverbunden && _0xfehlversuche >= 3) {
            // Nutzer hat das Browserfenster geschlossen.
            _0xbeenden({ ok: false, canceled: true }, false);
          } else if (!_0xverbunden && Date.now() - _0xstart > 20000) {
            // Port nie erreichbar (z. B. Richtlinie blockt DevTools) -> Launcher-Fenster.
            _0xerledigt = true;
            clearInterval(_0xpoll);
            clearTimeout(_0xnotaus);
            _0xbrowserZu();
            _0xfertig(await oauthFensterLogin(_0xo));
          }
          return;
        }
        _0xverbunden = true;
        _0xfehlversuche = 0;
        for (const _0xz of _0xziele) {
          if (_0xerledigt || !_0xz || _0xz.type !== "page" || !_0xz.url || !_0xz.webSocketDebuggerUrl) {
            continue;
          }
          let _0xtreffer = false;
          try {
            _0xtreffer = typeof _0xo.trefferPruefung === "function" ? !!_0xo.trefferPruefung(_0xz.url) : true;
          } catch {}
          if (!_0xtreffer) {
            continue;
          }
          const _0xseite = {
            getURL: () => _0xz.url,
            executeJavaScript: _0xcode => cdpAusfuehren(_0xz.webSocketDebuggerUrl, _0xcode)
          };
          const _0xerg = await _0xo.codeHolen(_0xz.url, _0xseite);
          if (_0xerg) {
            _0xbeenden(_0xerg);
            break;
          }
        }
      } catch (_0xe) {
        _0xbeenden({ ok: false, error: _0xe && _0xe.message || "Anmeldung fehlgeschlagen." });
      } finally {
        _0xlaeuft = false;
      }
    };
    _0xpoll = setInterval(_0xrunde, 800);
    _0xnotaus = setTimeout(() => _0xbeenden({ ok: false, error: "Zeitüberschreitung – die Anmeldung wurde nicht abgeschlossen." }), _0xo.maxDauerMs || 300000);
  });
}

// Liest einen kompletten Registry-Teilbaum (reg query … /s) und liefert
// [{ key, name, values:{…} }]. Ohne Windows immer leer.
function regQueryTree(_0xpfadRT) {
  if (!IS_WIN) {
    return Promise.resolve([]);
  }
  return new Promise(_0xokRT => {
    execFile("reg", ["query", _0xpfadRT, "/s"], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    }, (_0xerrRT, _0xoutRT) => {
      if (_0xerrRT || !_0xoutRT) {
        return _0xokRT([]);
      }
      const _0xblockRT = [];
      let _0xaktRT = null;
      for (const _0xzeileRT of String(_0xoutRT).split(/\r?\n/)) {
        if (/^HKEY_/i.test(_0xzeileRT)) {
          const _0xkeyRT = _0xzeileRT.trim();
          _0xaktRT = {
            key: _0xkeyRT,
            name: _0xkeyRT.split("\\").pop(),
            values: {}
          };
          _0xblockRT.push(_0xaktRT);
          continue;
        }
        const _0xtrRT = _0xzeileRT.match(/^\s+(.+?)\s{2,}REG_(?:SZ|EXPAND_SZ|MULTI_SZ|DWORD|QWORD|BINARY|NONE)\s{2,}(.*)$/);
        if (_0xtrRT && _0xaktRT) {
          _0xaktRT.values[_0xtrRT[1].trim()] = _0xtrRT[2].trim();
        }
      }
      return _0xokRT(_0xblockRT);
    });
  });
}

// ── GOG ─────────────────────────────────────────────────────────────────────
// Client-Daten des offiziellen GOG-Galaxy-Clients (öffentlich bekannt).
const GOG_CLIENT_ID = "46899977096215655";
const GOG_CLIENT_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const GOG_REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client";
const GOG_AUTH_URL = "https://auth.gog.com/auth?client_id=" + GOG_CLIENT_ID + "&redirect_uri=" + encodeURIComponent(GOG_REDIRECT_URI) + "&response_type=code&layout=client2";
const GOG_TOKEN_URL = "https://auth.gog.com/token";
const GOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function gogBildUrl(_0xrohGB) {
  const _0xwGB = String(_0xrohGB || "").trim();
  if (!_0xwGB) {
    return null;
  }
  if (_0xwGB.startsWith("//")) {
    return "https:" + _0xwGB;
  }
  if (/^https?:\/\//i.test(_0xwGB)) {
    return _0xwGB;
  }
  return null;
}

function gogTextOhneHtml(_0xrohGT) {
  return String(_0xrohGT || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Tauscht Code bzw. Refresh-Token gegen ein Zugangs-Token.
// Hinweis: GOG erwartet die Parameter am Token-Endpunkt als Query – das ist der
// offizielle Weg des Galaxy-Clients. Die Adresse wird nirgends protokolliert.
async function gogTokenTauschen(_0xartGT, _0xwertGT) {
  const _0xpGT = new URLSearchParams({
    client_id: GOG_CLIENT_ID,
    client_secret: GOG_CLIENT_SECRET,
    grant_type: _0xartGT
  });
  if (_0xartGT === "authorization_code") {
    _0xpGT.set("code", String(_0xwertGT || ""));
    _0xpGT.set("redirect_uri", GOG_REDIRECT_URI);
  } else {
    _0xpGT.set("refresh_token", String(_0xwertGT || ""));
  }
  const _0xaGT = await fetchJson(GOG_TOKEN_URL + "?" + _0xpGT.toString(), {}, 15000);
  if (!_0xaGT || !_0xaGT.access_token) {
    throw new Error("Kein GOG-Token erhalten (Code abgelaufen oder GOG nicht erreichbar).");
  }
  const _0xsGT = loadSettings();
  _0xsGT.gogAccessToken = _0xaGT.access_token;
  _0xsGT.gogRefreshToken = _0xaGT.refresh_token || _0xsGT.gogRefreshToken || "";
  _0xsGT.gogExpiresAt = Date.now() + (Number(_0xaGT.expires_in) || 3600) * 1000 - 60000;
  _0xsGT.gogUserId = _0xaGT.user_id ? String(_0xaGT.user_id) : _0xsGT.gogUserId || "";
  _0xsGT.connectGOG = true;
  saveSettings(_0xsGT);
  return _0xaGT;
}

async function gogEnsureToken() {
  const _0xsGE = loadSettings();
  if (_0xsGE.gogAccessToken && Date.now() < (_0xsGE.gogExpiresAt || 0)) {
    return _0xsGE.gogAccessToken;
  }
  if (_0xsGE.gogRefreshToken) {
    try {
      await gogTokenTauschen("refresh_token", _0xsGE.gogRefreshToken);
      return loadSettings().gogAccessToken || null;
    } catch (_0xeGE) {
      console.error("GOG-Token konnte nicht erneuert werden:", _0xeGE && _0xeGE.message || "unbekannt");
    }
  }
  return null;
}

async function gogNutzerdaten(_0xtokGN) {
  if (!_0xtokGN) {
    return null;
  }
  return await fetchJson("https://embed.gog.com/userData.json", {
    headers: {
      Authorization: "Bearer " + _0xtokGN
    }
  }, 12000);
}

async function gogLogin() {
  return await echterBrowserLogin({
    url: GOG_AUTH_URL,
    titel: "Mit GOG anmelden",
    breite: 520,
    hoehe: 760,
    trefferPruefung: _0xuGL => _0xuGL.includes("on_login_success") && _0xuGL.includes("code="),
    codeHolen: async _0xuGL => {
      let _0xcodeGL = null;
      try {
        _0xcodeGL = new URL(_0xuGL).searchParams.get("code");
      } catch {}
      if (!_0xcodeGL) {
        return null;
      }
      await gogTokenTauschen("authorization_code", _0xcodeGL);
      const _0xsGL = loadSettings();
      let _0xnameGL = "";
      let _0xavatarGL = "";
      try {
        const _0xudGL = await gogNutzerdaten(_0xsGL.gogAccessToken);
        if (_0xudGL) {
          _0xnameGL = _0xudGL.username || "";
          _0xavatarGL = gogBildUrl(_0xudGL.avatar) || "";
          if (_0xudGL.userId) {
            _0xsGL.gogUserId = String(_0xudGL.userId);
          }
        }
      } catch {}
      _0xsGL.gogUsername = _0xnameGL || _0xsGL.gogUsername || "";
      _0xsGL.gogAvatar = _0xavatarGL || _0xsGL.gogAvatar || "";
      _0xsGL.connectGOG = true;
      saveSettings(_0xsGL);
      return {
        ok: true,
        username: _0xsGL.gogUsername,
        userId: _0xsGL.gogUserId || "",
        avatar: _0xsGL.gogAvatar || ""
      };
    }
  });
}

// Bibliothek: erst die Besitz-IDs, dann Details in Bloecken zu 10 mit kurzer
// Pause (GOG bremst sonst). Ergebnis liegt 24 h im Settings-Zwischenspeicher.
async function fetchGogOwnedLibrary(_0xerzwingenGO) {
  const _0xtokGO = await gogEnsureToken();
  if (!_0xtokGO) {
    return {
      ok: false,
      error: "GOG-Konto nicht verbunden.",
      games: []
    };
  }
  const _0xsGO = loadSettings();
  const _0xcacheGO = _0xsGO.gogGamesCache && Array.isArray(_0xsGO.gogGamesCache.games) ? _0xsGO.gogGamesCache : null;
  if (!_0xerzwingenGO && _0xcacheGO && _0xcacheGO.games.length && Date.now() - (_0xcacheGO.t || 0) < GOG_CACHE_TTL_MS) {
    return {
      ok: true,
      games: _0xcacheGO.games,
      count: _0xcacheGO.games.length,
      cached: true,
      username: _0xsGO.gogUsername || ""
    };
  }
  try {
    const _0xkopfGO = {
      Authorization: "Bearer " + _0xtokGO
    };
    const _0xbesitzGO = await fetchJson("https://embed.gog.com/user/data/games", {
      headers: _0xkopfGO
    }, 15000);
    const _0xidsGO = _0xbesitzGO && Array.isArray(_0xbesitzGO.owned) ? _0xbesitzGO.owned.map(_0xiGO => String(_0xiGO)) : [];
    if (!_0xidsGO.length) {
      if (_0xcacheGO && _0xcacheGO.games.length) {
        return {
          ok: true,
          games: _0xcacheGO.games,
          count: _0xcacheGO.games.length,
          cached: true,
          stale: true,
          username: _0xsGO.gogUsername || ""
        };
      }
      return {
        ok: false,
        error: "GOG lieferte keine Bibliothek (Anmeldung abgelaufen oder GOG nicht erreichbar).",
        games: []
      };
    }
    // Bereits bekannte Details wiederverwenden – nur wirklich Neues abfragen.
    const _0xaltGO = new Map();
    if (_0xcacheGO) {
      for (const _0xgGO of _0xcacheGO.games) {
        if (_0xgGO && _0xgGO.id && _0xgGO.title) {
          _0xaltGO.set(String(_0xgGO.id), _0xgGO);
        }
      }
    }
    const _0xspieleGO = [];
    const _0xoffenGO = [];
    for (const _0xidGO of _0xidsGO) {
      const _0xtrefferGO = _0xaltGO.get(_0xidGO);
      if (_0xtrefferGO) {
        _0xspieleGO.push(_0xtrefferGO);
      } else {
        _0xoffenGO.push(_0xidGO);
      }
    }
    for (let _0xposGO = 0; _0xposGO < _0xoffenGO.length; _0xposGO += 10) {
      const _0xblockGO = _0xoffenGO.slice(_0xposGO, _0xposGO + 10);
      const _0xteilGO = await Promise.all(_0xblockGO.map(async _0xpidGO => {
        const _0xpGO = await fetchJson("https://api.gog.com/products/" + encodeURIComponent(_0xpidGO) + "?expand=description", {}, 12000);
        if (!_0xpGO || !_0xpGO.title) {
          return null;
        }
        const _0xbilderGO = _0xpGO.images || {};
        return {
          platform: "gog",
          id: String(_0xpidGO),
          title: String(_0xpGO.title),
          slug: _0xpGO.slug || "",
          image: gogBildUrl(_0xbilderGO.logo2x || _0xbilderGO.logo || _0xbilderGO.image || _0xbilderGO.background),
          wide: gogBildUrl(_0xbilderGO.background || _0xbilderGO.logo2x),
          shortDescription: gogTextOhneHtml(_0xpGO.description && _0xpGO.description.lead).slice(0, 400),
          description: gogTextOhneHtml(_0xpGO.description && _0xpGO.description.full).slice(0, 4000),
          storeUrl: _0xpGO.links && _0xpGO.links.product_card || (_0xpGO.slug ? "https://www.gog.com/game/" + _0xpGO.slug : ""),
          installPath: null,
          owned: true
        };
      }));
      for (const _0xeGO of _0xteilGO) {
        if (_0xeGO) {
          _0xspieleGO.push(_0xeGO);
        }
      }
      if (_0xposGO + 10 < _0xoffenGO.length) {
        await new Promise(_0xrGO => setTimeout(_0xrGO, 350));
      }
    }
    const _0xgesehenGO = new Set();
    const _0xfertigGO = _0xspieleGO.filter(_0xgGO => {
      if (!_0xgGO || _0xgesehenGO.has(String(_0xgGO.id))) {
        return false;
      }
      _0xgesehenGO.add(String(_0xgGO.id));
      return true;
    });
    _0xfertigGO.sort((_0xa6GO, _0xb6GO) => String(_0xa6GO.title).localeCompare(String(_0xb6GO.title), "de"));
    const _0xspeichernGO = loadSettings();
    _0xspeichernGO.gogGamesCache = {
      t: Date.now(),
      games: _0xfertigGO
    };
    saveSettings(_0xspeichernGO);
    return {
      ok: true,
      games: _0xfertigGO,
      count: _0xfertigGO.length,
      username: _0xspeichernGO.gogUsername || ""
    };
  } catch (_0xe3GO) {
    return {
      ok: false,
      error: _0xe3GO && _0xe3GO.message || "GOG-Bibliothek konnte nicht geladen werden.",
      games: []
    };
  }
}

// Lokal installierte GOG-Spiele aus der Registry.
async function scanGogInstalled() {
  if (!IS_WIN) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  let _0xblockGS = [];
  for (const _0xwurzelGS of ["HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games", "HKLM\\SOFTWARE\\GOG.com\\Games"]) {
    try {
      const _0xteilGS = await regQueryTree(_0xwurzelGS);
      if (_0xteilGS.length) {
        _0xblockGS = _0xblockGS.concat(_0xteilGS);
      }
    } catch {}
  }
  const _0xspieleGS = [];
  const _0xgesehenGS = new Set();
  for (const _0xbGS of _0xblockGS) {
    const _0xvGS = _0xbGS.values || {};
    const _0xidGS = String(_0xvGS.gameID || _0xbGS.name || "").trim();
    if (!/^\d+$/.test(_0xidGS) || _0xgesehenGS.has(_0xidGS)) {
      continue;
    }
    const _0xpfadGS = String(_0xvGS.path || _0xvGS.PATH || "").trim();
    let _0xexeGS = String(_0xvGS.exe || _0xvGS.exeFile || "").trim();
    if (_0xexeGS && _0xpfadGS && !path.isAbsolute(_0xexeGS)) {
      _0xexeGS = path.join(_0xpfadGS, _0xexeGS);
    }
    let _0xexeOkGS = null;
    try {
      _0xexeOkGS = _0xexeGS && fs.existsSync(_0xexeGS) ? _0xexeGS : null;
    } catch {
      _0xexeOkGS = null;
    }
    _0xgesehenGS.add(_0xidGS);
    _0xspieleGS.push({
      platform: "gog",
      id: _0xidGS,
      title: String(_0xvGS.gameName || _0xvGS.startMenu || "").trim() || (_0xpfadGS ? path.basename(_0xpfadGS.replace(/[\\/]+$/, "")) : "GOG-Spiel (ID: " + _0xidGS + ")"),
      installPath: _0xpfadGS || null,
      exePath: _0xexeOkGS,
      installed: true
    });
  }
  _0xspieleGS.sort((_0xa7GS, _0xb7GS) => String(_0xa7GS.title).localeCompare(String(_0xb7GS.title), "de"));
  return {
    installed: _0xspieleGS.length > 0,
    path: null,
    games: _0xspieleGS
  };
}

// ── Ubisoft ─────────────────────────────────────────────────────────────────
// Achtung: Das hier ist eine private Schnittstelle von Ubisoft. Sie liefert
// nur Profildaten – es gibt KEINE verlaessliche oeffentliche Bibliotheks-API.
// Als Bibliothek dienen deshalb die lokal installierten Spiele.
const UBI_APP_ID = "314d4fef-e568-4f85-b7f7-9dc2c1b26fcd";
const UBI_GENOME_ID = "85c8228e-2a18-4d95-9be6-c5ee6a3f6ecb";
const UBI_LOGIN_URL = "https://connect.ubisoft.com/login?appId=" + UBI_APP_ID + "&genomeId=" + UBI_GENOME_ID;
const UBI_TITEL = {
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

function ubisoftTicketNormalisieren(_0xrohUN) {
  if (!_0xrohUN) {
    return null;
  }
  let _0xwertUN = String(_0xrohUN).trim();
  if (_0xwertUN.startsWith("{") || _0xwertUN.startsWith("\"")) {
    try {
      const _0xjUN = JSON.parse(_0xwertUN);
      if (typeof _0xjUN === "string") {
        _0xwertUN = _0xjUN;
      } else if (_0xjUN && typeof _0xjUN === "object") {
        _0xwertUN = _0xjUN.ticket || _0xjUN.value || _0xjUN.token || "";
      }
    } catch {}
  }
  _0xwertUN = String(_0xwertUN || "").trim();
  if (/^ubi_v1\s+t=/i.test(_0xwertUN)) {
    _0xwertUN = _0xwertUN.replace(/^ubi_v1\s+t=/i, "").trim();
  }
  return _0xwertUN.length > 20 ? _0xwertUN : null;
}

async function ubisoftTicketAusSeite(_0xwcUT) {
  let _0xrohUT = null;
  try {
    _0xrohUT = await _0xwcUT.executeJavaScript("(function(){try{var s=window.localStorage;return s.getItem('PRODUCTION_UBISERVICES_ticket')||s.getItem('UBISERVICES_ticket')||s.getItem('ubiservices_ticket')||null;}catch(e){return null;}})()", true).catch(() => null);
  } catch {}
  if (!_0xrohUT) {
    try {
      const _0xtxtUT = await _0xwcUT.executeJavaScript("(function(){try{return document.body?document.body.innerText:'';}catch(e){return '';}})()", true).catch(() => null);
      const _0xkurzUT = String(_0xtxtUT || "").trim();
      if (_0xkurzUT.startsWith("{")) {
        const _0xjUT = JSON.parse(_0xkurzUT);
        _0xrohUT = _0xjUT && (_0xjUT.ticket || _0xjUT.data && _0xjUT.data.ticket) || null;
      }
    } catch {}
  }
  return ubisoftTicketNormalisieren(_0xrohUT);
}

async function ubisoftProfilLaden(_0xtUP) {
  if (!_0xtUP) {
    return null;
  }
  return await fetchJson("https://public-ubiservices.ubi.com/v1/profiles/me", {
    headers: {
      Authorization: "Ubi_v1 t=" + _0xtUP,
      "Ubi-AppId": UBI_APP_ID,
      "Ubi-RequestedPlatformType": "uplay",
      "Content-Type": "application/json"
    }
  }, 12000);
}

async function ubisoftLogin() {
  return await echterBrowserLogin({
    url: UBI_LOGIN_URL,
    titel: "Mit Ubisoft Connect anmelden",
    breite: 560,
    hoehe: 780,
    pollMs: 2000,
    trefferPruefung: _0xuUT => /^https:\/\/([\w-]+\.)*(ubisoft\.com|ubi\.com)\//i.test(_0xuUT),
    codeHolen: async (_0xuUL, _0xwcUL) => {
      const _0xticketUL = await ubisoftTicketAusSeite(_0xwcUL);
      if (!_0xticketUL) {
        return null;
      }
      const _0xprofilUL = await ubisoftProfilLaden(_0xticketUL);
      if (!_0xprofilUL) {
        throw new Error("Ubisoft-Ticket gefunden, aber das Profil konnte nicht geladen werden – Ubisoft hat die Schnittstelle evtl. geändert.");
      }
      const _0xsUL = loadSettings();
      _0xsUL.ubisoftTicket = _0xticketUL;
      _0xsUL.ubisoftProfileId = _0xprofilUL.profileId || _0xprofilUL.userId || "";
      _0xsUL.ubisoftName = _0xprofilUL.nameOnPlatform || _0xprofilUL.username || _0xprofilUL.email || "";
      _0xsUL.ubisoftTicketAt = Date.now();
      _0xsUL.connectUbisoft = true;
      saveSettings(_0xsUL);
      return {
        ok: true,
        name: _0xsUL.ubisoftName,
        profileId: _0xsUL.ubisoftProfileId
      };
    }
  });
}

// Lokal installierte Ubisoft-Spiele aus der Registry.
async function scanUbisoftInstalled() {
  if (!IS_WIN) {
    return {
      installed: false,
      path: null,
      games: []
    };
  }
  let _0xblockUS = [];
  try {
    _0xblockUS = await regQueryTree("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs");
  } catch {
    _0xblockUS = [];
  }
  const _0xspieleUS = [];
  const _0xgesehenUS = new Set();
  for (const _0xbUS of _0xblockUS) {
    const _0xidUS = String(_0xbUS.name || "").trim();
    if (!/^\d+$/.test(_0xidUS) || _0xgesehenUS.has(_0xidUS)) {
      continue;
    }
    const _0xvUS = _0xbUS.values || {};
    const _0xdirUS = String(_0xvUS.InstallDir || _0xvUS.installdir || _0xvUS.Installdir || "").trim().replace(/\//g, "\\");
    let _0xtitelUS = UBI_TITEL[_0xidUS] || "";
    if (!_0xtitelUS && _0xdirUS) {
      // uplay_install.state ist ein Binaerformat – der Ordnername ist die
      // verlaesslichste lesbare Quelle fuer einen Titel.
      _0xtitelUS = path.basename(_0xdirUS.replace(/[\\/]+$/, ""));
    }
    if (!_0xtitelUS) {
      _0xtitelUS = "Ubisoft-Spiel (ID: " + _0xidUS + ")";
    }
    let _0xdaUS = false;
    try {
      _0xdaUS = !!_0xdirUS && fs.existsSync(_0xdirUS);
    } catch {
      _0xdaUS = false;
    }
    _0xgesehenUS.add(_0xidUS);
    _0xspieleUS.push({
      platform: "ubisoft",
      id: _0xidUS,
      title: _0xtitelUS,
      installPath: _0xdirUS || null,
      installed: _0xdaUS,
      image: null
    });
  }
  _0xspieleUS.sort((_0xa8US, _0xb8US) => String(_0xa8US.title).localeCompare(String(_0xb8US.title), "de"));
  return {
    installed: _0xspieleUS.length > 0,
    path: null,
    games: _0xspieleUS
  };
}

let cfWindow = null;
let cfBusy = Promise.resolve();
function getCfWindow() {
  if (cfWindow && !cfWindow.isDestroyed()) {
    return cfWindow;
  }
  cfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: "persist:epicstore",
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  cfWindow.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  cfWindow.on("closed", () => {
    cfWindow = null;
  });
  return cfWindow;
}
function fetchViaBrowser(_0x20f69c, _0x88c460 = 25000) {
  const _0xe8aea4 = cfBusy.then(() => new Promise(_0xcda2c5 => {
    let _0x21c150 = false;
    let _0x7c598c = null;
    const _0x416ea1 = Date.now();
    const _0x4b813d = getCfWindow();
    const _0x1350c1 = _0x50c2ac => {
      if (_0x21c150) {
        return;
      }
      _0x21c150 = true;
      if (_0x7c598c) {
        clearInterval(_0x7c598c);
      }
      _0xcda2c5(_0x50c2ac);
    };
    const _0x3ea012 = async () => {
      if (_0x21c150) {
        return;
      }
      if (!_0x4b813d || _0x4b813d.isDestroyed()) {
        return _0x1350c1(null);
      }
      try {
        const _0x1df044 = (await _0x4b813d.webContents.executeJavaScript("document.body?document.body.innerText:\"\"").catch(() => "")).trim();
        if (_0x1df044.startsWith("{") || _0x1df044.startsWith("[")) {
          try {
            return _0x1350c1(JSON.parse(_0x1df044));
          } catch {}
        }
      } catch {}
      if (Date.now() - _0x416ea1 > _0x88c460) {
        _0x1350c1(null);
      }
    };
    _0x4b813d.webContents.once("did-finish-load", _0x3ea012);
    _0x7c598c = setInterval(_0x3ea012, 1200);
    _0x4b813d.loadURL(_0x20f69c).catch(() => _0x1350c1(null));
  }));
  cfBusy = _0xe8aea4.catch(() => {});
  return _0xe8aea4;
}
async function enrichEpicStoreItems(_0x4dfbee) {
  const _0x196a91 = await epicLauncherEnsureToken();
  if (!_0x196a91 || !_0x4dfbee.length) {
    return;
  }
  const _0x33ee2d = {
    Authorization: "bearer " + _0x196a91,
    "User-Agent": EPIC_UA
  };
  const _0x4b4161 = new Map();
  for (const _0x280e87 of _0x4dfbee) {
    if (!_0x4b4161.has(_0x280e87.namespace)) {
      _0x4b4161.set(_0x280e87.namespace, []);
    }
    _0x4b4161.get(_0x280e87.namespace).push(_0x280e87);
  }
  const _0x573dc5 = [..._0x4b4161.entries()];
  let _0x23a9fa = 0;
  async function _0xffa39b() {
    while (_0x23a9fa < _0x573dc5.length) {
      const [_0x1f2543, _0xd9bfa9] = _0x573dc5[_0x23a9fa++];
      const _0x729544 = _0xd9bfa9.slice(0, 50).map(_0x4d57b6 => "id=" + encodeURIComponent(_0x4d57b6.id)).join("&");
      const _0x52d74a = EPIC_CATALOG_BASE + "/namespace/" + encodeURIComponent(_0x1f2543) + "/bulk/offers?" + _0x729544 + "&country=DE&locale=de";
      const _0x325072 = await fetchJson(_0x52d74a, {
        headers: _0x33ee2d
      }, 12000);
      if (!_0x325072) {
        continue;
      }
      for (const _0x94a6d9 of _0xd9bfa9) {
        const _0xf693e6 = _0x325072[_0x94a6d9.id];
        if (!_0xf693e6) {
          continue;
        }
        const _0x241f2d = _0xf693e6.keyImages || [];
        const _0x10a49a = (_0x241f2d.find(_0x1bb838 => _0x1bb838.type === "OfferImageWide") || _0x241f2d.find(_0x27476d => _0x27476d.type === "DieselStoreFrontWide") || _0x241f2d.find(_0x55ed0d => _0x55ed0d.type === "Thumbnail") || {}).url;
        const _0x30d484 = (_0x241f2d.find(_0x1aea17 => _0x1aea17.type === "OfferImageTall") || _0x241f2d.find(_0x30ff0a => _0x30ff0a.type === "DieselGameBoxTall") || {}).url;
        if (_0x10a49a || _0x30d484) {
          _0x94a6d9.image = _0x10a49a || _0x30d484;
        }
        if (_0x30d484) {
          _0x94a6d9.portrait = _0x30d484;
        }
        if (_0xf693e6.title) {
          _0x94a6d9.title = _0xf693e6.title;
        }
        if (_0xf693e6.description) {
          _0x94a6d9.shortDescription = _0xf693e6.description;
        }
        if (_0xf693e6.longDescription) {
          _0x94a6d9.description = _0xf693e6.longDescription;
        }
        _0x94a6d9.seller = _0xf693e6.seller && _0xf693e6.seller.name || _0xf693e6.publisherDisplayName || _0x94a6d9.seller;
        if (typeof _0xf693e6.currentPrice === "number") {
          _0x94a6d9.priceCents = _0xf693e6.currentPrice;
        }
        if (typeof _0xf693e6.basePrice === "number" && _0xf693e6.basePrice > (_0xf693e6.currentPrice || 0)) {
          _0x94a6d9.originalPriceCents = _0xf693e6.basePrice;
          _0x94a6d9.discountPercent = Math.round((1 - (_0xf693e6.currentPrice || 0) / _0xf693e6.basePrice) * 100);
        }
        if (_0xf693e6.urlSlug) {
          _0x94a6d9.urlSlug = epicCleanSlug(_0xf693e6.urlSlug);
          _0x94a6d9.storeUrl = "https://store.epicgames.com/de/p/" + _0x94a6d9.urlSlug;
        }
        if (!_0x94a6d9.catalogNamespace && _0x94a6d9.namespace) {
          _0x94a6d9.catalogNamespace = _0x94a6d9.namespace;
        }
        if (!_0x94a6d9.catalogItemId) {
          _0x94a6d9.catalogItemId = _0x94a6d9.id;
        }
        if (_0xf693e6.releaseDate) {
          _0x94a6d9.releaseDate = _0xf693e6.releaseDate;
        }
      }
    }
  }
  await Promise.all(Array.from({
    length: Math.min(6, _0x573dc5.length)
  }, _0xffa39b));
}
async function fetchEpicStorePage(_0xbe12b7 = 0, _0x35466c = 40) {
  const _0x43dcc9 = "https://egs-platform-service.store.epicgames.com/api/v1/egs/publisher-index?count=" + _0x35466c + "&locale=de&start=" + _0xbe12b7 + "&storeId=EGS";
  const _0xa3c2f = await fetchViaBrowser(_0x43dcc9);
  if (!_0xa3c2f || !Array.isArray(_0xa3c2f.data)) {
    return {
      items: [],
      total: 0,
      nextStart: _0xbe12b7,
      done: true
    };
  }
  const _0x437ce8 = [];
  const _0x59a251 = new Set();
  for (const _0x4aa435 of _0xa3c2f.data) {
    for (const _0x4c8f04 of _0x4aa435.offers || []) {
      if (!_0x4c8f04.id || !_0x4c8f04.namespace || !_0x4c8f04.title || _0x59a251.has(_0x4c8f04.id)) {
        continue;
      }
      _0x59a251.add(_0x4c8f04.id);
      const _0x5ee88f = _0x4c8f04.releaseDate || _0x4c8f04.releaseDateUtc || null;
      _0x437ce8.push({
        platform: "epic",
        category: "Epic Store",
        id: _0x4c8f04.id,
        namespace: _0x4c8f04.namespace,
        catalogNamespace: _0x4c8f04.namespace,
        catalogItemId: _0x4c8f04.id,
        title: _0x4c8f04.title,
        seller: _0x4aa435.sellerName || "Epic Games",
        image: null,
        priceCents: null,
        releaseDate: _0x5ee88f,
        comingSoon: isUnreleased(_0x5ee88f),
        storeUrl: "https://store.epicgames.com/de/browse?q=" + encodeURIComponent(_0x4c8f04.title) + "&sortBy=relevancy"
      });
    }
  }
  await enrichEpicStoreItems(_0x437ce8);
  const _0x12f3cd = _0xa3c2f.paging && _0xa3c2f.paging.total || 0;
  const _0x255655 = _0xa3c2f.paging ? (_0xa3c2f.paging.start ?? _0xbe12b7) + (_0xa3c2f.paging.count ?? _0x35466c) : _0xbe12b7 + _0x35466c;
  return {
    items: _0x437ce8,
    total: _0x12f3cd,
    nextStart: _0x255655,
    done: _0x255655 >= _0x12f3cd || _0xa3c2f.data.length === 0
  };
}
async function fetchEpicOwnedLibrary() {
  // Bibliothek kommt nur lokal vom EpicScanner — keine Epic Library-API.
  return loadLocalEpicLibrary();
}
function epicScannerPaths() {
  return [path.join("F:", "EpicScanner"), path.join("E:", "EpicScanner"), path.join(app.getPath("home"), "EpicScanner")];
}
function importEpicScannerZugang() {
  for (const _0xroot of epicScannerPaths()) {
    const _0xp = path.join(_0xroot, "daten", "zugang.json");
    if (!fs.existsSync(_0xp)) {
      continue;
    }
    let _0xd;
    try {
      _0xd = JSON.parse(fs.readFileSync(_0xp, "utf8"));
    } catch {
      continue;
    }
    if (!_0xd || !_0xd.refresh_token && !_0xd.access_token) {
      continue;
    }
    const _0xs = loadSettings();
    if (_0xs.epicLauncherRefreshToken && _0xs.epicLauncherAccessToken && Date.now() < (_0xs.epicLauncherExpiresAt || 0)) {
      return;
    }
    if (_0xd.access_token) {
      _0xs.epicLauncherAccessToken = _0xd.access_token;
    }
    if (_0xd.refresh_token) {
      _0xs.epicLauncherRefreshToken = _0xd.refresh_token;
    }
    if (_0xd.konto_id) {
      _0xs.epicLauncherAccountId = _0xd.konto_id;
    }
    if (_0xd.anzeigename) {
      _0xs.epicLauncherDisplayName = _0xd.anzeigename;
    }
    if (_0xd.gueltig_bis) {
      _0xs.epicLauncherExpiresAt = Math.floor(Number(_0xd.gueltig_bis) * 1000) - 60000;
    }
    _0xs.connectEpic = true;
    saveSettings(_0xs);
    return;
  }
}
function mapEpicScannerSpiele(_0xspiele, _0xroot) {
  const _0xseen = new Set();
  const _0xgames = [];
  for (const _0xs of _0xspiele) {
    if (!_0xs) {
      continue;
    }
    const _0xtitel = _0xs.titel || _0xs.title;
    if (!_0xtitel) {
      continue;
    }
    const _0xid = String(_0xs.app_name || _0xs.id || _0xs.katalog_id || _0xtitel);
    if (_0xseen.has(_0xid)) {
      continue;
    }
    _0xseen.add(_0xid);
    let _0ximg = _0xs.image || _0xs.bilder && (_0xs.bilder.hoch || _0xs.bilder.breit) || null;
    if (_0xs.bild_datei && _0xroot) {
      const _0xlocal = path.isAbsolute(_0xs.bild_datei) ? _0xs.bild_datei : path.join(_0xroot, "Bibliothek", _0xs.bild_datei);
      if (fs.existsSync(_0xlocal)) {
        _0ximg = "file:///" + _0xlocal.replace(/\\/g, "/");
      }
    }
    _0xgames.push({
      platform: "epic",
      id: _0xid,
      title: _0xtitel,
      image: _0ximg,
      wide: _0xs.wide || _0xs.bilder && _0xs.bilder.breit || null,
      screenshots: _0xs.screenshots || [],
      shortDescription: _0xs.shortDescription || _0xs.beschreibung || "",
      description: _0xs.description || _0xs.lang_beschreibung || "",
      developer: _0xs.developer || _0xs.entwickler || "",
      publisher: _0xs.publisher || _0xs.herausgeber || "",
      catalogNamespace: _0xs.catalogNamespace || _0xs.namespace || "",
      catalogItemId: _0xs.catalogItemId || _0xs.katalog_id || "",
      installPath: _0xs.installPath || _0xs.installation && _0xs.installation.install_location || null,
      owned: true,
      fromEpicScanner: true
    });
  }
  _0xgames.sort((_0xa, _0xb) => _0xa.title.localeCompare(_0xb.title, "de"));
  return _0xgames;
}
function loadLocalEpicLibrary() {
  const _0xpaths = [];
  try {
    _0xpaths.push(path.join(app.getPath("userData"), "epic-bibliothek.json"));
  } catch {}
  for (const _0xroot of epicScannerPaths()) {
    _0xpaths.push(path.join(_0xroot, "Bibliothek", "bibliothek.json"));
  }
  for (const _0xp of _0xpaths) {
    if (!fs.existsSync(_0xp)) {
      continue;
    }
    let _0xd;
    try {
      _0xd = JSON.parse(fs.readFileSync(_0xp, "utf8"));
    } catch {
      continue;
    }
    let _0xspiele = [];
    let _0xroot = null;
    if (Array.isArray(_0xd && _0xd.games) && _0xd.games.length) {
      _0xspiele = _0xd.games;
    } else if (Array.isArray(_0xd && _0xd.spiele) && _0xd.spiele.length) {
      _0xspiele = _0xd.spiele;
      _0xroot = path.dirname(path.dirname(_0xp));
    }
    if (!_0xspiele.length) {
      continue;
    }
    const _0xgames = mapEpicScannerSpiele(_0xspiele, _0xroot);
    if (!_0xgames.length) {
      continue;
    }
    return {
      ok: true,
      games: _0xgames,
      count: _0xgames.length,
      source: "local"
    };
  }
  return {
    ok: false,
    games: [],
    error: "Keine lokale Epic-Bibliothek. EpicScanner einmal scannen."
  };
}
function loadEpicScannerLibraryFallback() {
  return loadLocalEpicLibrary();
}
async function fetchEpicLauncherFriends() {
  const _0x4692af = await epicLauncherEnsureToken();
  const _0x40cd6d = loadSettings();
  const _0x47f61e = _0x40cd6d.epicLauncherAccountId;
  if (!_0x4692af || !_0x47f61e) {
    return {
      ok: false,
      error: "Epic-Konto nicht verbunden.",
      friends: []
    };
  }
  const _0x184d51 = {
    Authorization: "bearer " + _0x4692af,
    "User-Agent": EPIC_UA
  };
  try {
    const _0x4c602b = await fetchJson("https://friends-public-service-prod.ol.epicgames.com/friends/api/public/friends/" + _0x47f61e + "?includePending=false", {
      headers: _0x184d51
    }, 12000);
    const _0x3f6c5a = Array.isArray(_0x4c602b) ? _0x4c602b : [];
    const _0x4f7fd6 = _0x3f6c5a.filter(_0x51136f => !_0x51136f.status || _0x51136f.status === "ACCEPTED");
    const _0x34493d = _0x4f7fd6.map(_0x14a110 => _0x14a110.accountId).filter(Boolean);
    const _0x403124 = {};
    for (let _0x32a99b = 0; _0x32a99b < _0x34493d.length; _0x32a99b += 100) {
      const _0x378655 = _0x34493d.slice(_0x32a99b, _0x32a99b + 100);
      const _0x155b33 = _0x378655.map(_0x5f4e72 => "accountId=" + encodeURIComponent(_0x5f4e72)).join("&");
      const _0xd0f5af = await fetchJson("https://account-public-service-prod.ol.epicgames.com/account/api/public/account?" + _0x155b33, {
        headers: _0x184d51
      }, 12000);
      if (Array.isArray(_0xd0f5af)) {
        for (const _0x1ffba0 of _0xd0f5af) {
          _0x403124[_0x1ffba0.id] = _0x1ffba0.displayName || _0x1ffba0.id;
        }
      }
    }
    const _0x69ed6b = _0x4f7fd6.map(_0x215d9f => ({
      name: _0x403124[_0x215d9f.accountId] || _0x215d9f.accountId,
      avatar: null,
      status: "unknown",
      gameId: null,
      gameTitle: null,
      platform: "epic",
      epicId: _0x215d9f.accountId,
      favorite: !!_0x215d9f.favorite
    }));
    _0x69ed6b.sort((_0x33144f, _0x194446) => Number(_0x194446.favorite) - Number(_0x33144f.favorite) || _0x33144f.name.localeCompare(_0x194446.name, "de"));
    return {
      ok: true,
      friends: _0x69ed6b
    };
  } catch (_0x3ed231) {
    return {
      ok: false,
      error: "Epic-Freunde konnten nicht geladen werden.",
      friends: []
    };
  }
}
const XBOX_CLIENT_ID_DEFAULT = "000000004C12AE6F";
const XBOX_REDIRECT = "https://login.live.com/oauth20_desktop.srf";
const XBOX_SCOPE = "service::user.auth.xboxlive.com::MBI_SSL";
function xboxAuthorizeUrl() {
  const _0xa5183e = new URLSearchParams({
    client_id: loadSettings().xboxClientId || XBOX_CLIENT_ID_DEFAULT,
    response_type: "code",
    approval_prompt: "auto",
    scope: XBOX_SCOPE,
    redirect_uri: XBOX_REDIRECT
  });
  return "https://login.live.com/oauth20_authorize.srf?" + _0xa5183e.toString();
}
async function xboxExchangeCode(_0x4e82a0) {
  const _0x4b4c2c = new URLSearchParams({
    client_id: loadSettings().xboxClientId || XBOX_CLIENT_ID_DEFAULT,
    code: _0x4e82a0,
    grant_type: "authorization_code",
    redirect_uri: XBOX_REDIRECT,
    scope: XBOX_SCOPE
  });
  const _0x472c78 = await fetch("https://login.live.com/oauth20_token.srf", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: _0x4b4c2c.toString()
  });
  const _0x11b02a = await _0x472c78.json().catch(() => null);
  if (!_0x472c78.ok || !_0x11b02a || !_0x11b02a.access_token) {
    throw new Error("Token-Tausch fehlgeschlagen (" + _0x472c78.status + (_0x11b02a && _0x11b02a.error ? ", " + _0x11b02a.error : "") + ").");
  }
  return _0x11b02a.access_token;
}
function xboxErrText(_0x38c04c, _0x471ffc) {
  const _0x30a401 = {
    "2148916233": "Zu diesem Microsoft-Konto gehört kein Xbox-Profil. Leg auf xbox.com einmal ein Profil an.",
    "2148916235": "Xbox Live ist im Land dieses Kontos nicht verfügbar.",
    "2148916236": "Das Konto braucht eine Erwachsenen-Verifizierung.",
    "2148916237": "Das Konto braucht eine Erwachsenen-Verifizierung.",
    "2148916238": "Das ist ein Kinderkonto – es muss einer Familie zugeordnet sein."
  };
  return _0x30a401[String(_0x38c04c)] || "Xbox lehnte die Anmeldung ab (" + _0x471ffc + (_0x38c04c ? ", XErr " + _0x38c04c : "") + ").";
}
async function xboxAuthenticate(_0xcaa28) {
  const _0xbe5927 = async (_0x42cb63, _0x529638) => {
    const _0x40e454 = await fetch(_0x42cb63, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-xbl-contract-version": "1"
      },
      body: JSON.stringify(_0x529638)
    });
    const _0x2eb14f = await _0x40e454.text();
    let _0x34d69d = null;
    try {
      _0x34d69d = JSON.parse(_0x2eb14f);
    } catch {}
    return {
      ok: _0x40e454.ok,
      status: _0x40e454.status,
      data: _0x34d69d,
      txt: _0x2eb14f
    };
  };
  let _0x2300f7 = null;
  let _0x10a676 = "";
  for (const _0x1dd6b0 of ["t=", "d=", ""]) {
    const _0x1cbb44 = await _0xbe5927("https://user.auth.xboxlive.com/user/authenticate", {
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: "" + _0x1dd6b0 + _0xcaa28
      }
    });
    if (_0x1cbb44.ok && _0x1cbb44.data && _0x1cbb44.data.Token) {
      _0x2300f7 = _0x1cbb44.data;
      console.log("Xbox: RPS-Ticket-Format \"" + (_0x1dd6b0 || "roh") + "\" akzeptiert.");
      break;
    }
    _0x10a676 = "XBL " + _0x1cbb44.status + (_0x1cbb44.data && _0x1cbb44.data.XErr ? " XErr " + _0x1cbb44.data.XErr : "") + " (Format \"" + (_0x1dd6b0 || "roh") + "\")";
    console.error("Xbox-Auth fehlgeschlagen:", _0x10a676, _0x1cbb44.txt ? _0x1cbb44.txt.slice(0, 160) : "");
  }
  if (!_0x2300f7) {
    throw new Error(_0x10a676 + ". Kein Ticket-Format wurde akzeptiert – siehe Hinweise im Launcher.");
  }
  const _0x1332d1 = await _0xbe5927("https://xsts.auth.xboxlive.com/xsts/authorize", {
    RelyingParty: "http://xboxlive.com",
    TokenType: "JWT",
    Properties: {
      UserTokens: [_0x2300f7.Token],
      SandboxId: "RETAIL"
    }
  });
  if (!_0x1332d1.ok) {
    throw new Error(xboxErrText(_0x1332d1.data && _0x1332d1.data.XErr, "XSTS " + _0x1332d1.status));
  }
  const _0x250839 = _0x1332d1.data;
  const _0x230087 = _0x250839 && _0x250839.DisplayClaims && _0x250839.DisplayClaims.xui && _0x250839.DisplayClaims.xui[0];
  if (!_0x250839 || !_0x250839.Token || !_0x230087) {
    throw new Error("Kein XSTS-Token erhalten.");
  }
  const _0x2224c7 = loadSettings();
  _0x2224c7.xboxToken = _0x250839.Token;
  _0x2224c7.xboxUserHash = _0x230087.uhs;
  _0x2224c7.xboxXuid = _0x230087.xid || "";
  _0x2224c7.xboxGamertag = _0x230087.gtg || "";
  _0x2224c7.xboxTokenExpiresAt = _0x250839.NotAfter ? Date.parse(_0x250839.NotAfter) - 60000 : Date.now() + 43200000;
  _0x2224c7.connectXbox = true;
  saveSettings(_0x2224c7);
  return {
    xuid: _0x2224c7.xboxXuid,
    gamertag: _0x2224c7.xboxGamertag
  };
}
function xboxAuthHeader(_0x1fb27b) {
  if (!_0x1fb27b.xboxToken || !_0x1fb27b.xboxUserHash) {
    return null;
  }
  if (Date.now() >= (_0x1fb27b.xboxTokenExpiresAt || 0)) {
    return null;
  }
  return "XBL3.0 x=" + _0x1fb27b.xboxUserHash + ";" + _0x1fb27b.xboxToken;
}
async function xboxLogin() {
  return await echterBrowserLogin({
    url: xboxAuthorizeUrl(),
    titel: "Mit Xbox / Microsoft anmelden",
    trefferPruefung: _0xu => _0xu.startsWith(XBOX_REDIRECT),
    codeHolen: async _0xu => {
      let _0xcode = null;
      let _0xtoken = null;
      let _0xfehler = null;
      try {
        const _0xq = new URL(_0xu).searchParams;
        const _0xh = new URLSearchParams(_0xu.split("#")[1] || "");
        _0xcode = _0xq.get("code") || _0xh.get("code");
        _0xtoken = _0xq.get("access_token") || _0xh.get("access_token");
        _0xfehler = _0xq.get("error_description") || _0xq.get("error") || _0xh.get("error_description") || _0xh.get("error");
      } catch {}
      if (_0xfehler && !_0xcode && !_0xtoken) {
        throw new Error("Microsoft-Anmeldung: " + _0xfehler);
      }
      if (!_0xcode && !_0xtoken) {
        return null;
      }
      const _0xmsToken = _0xtoken || (await xboxExchangeCode(_0xcode));
      return {
        ok: true,
        ...(await xboxAuthenticate(_0xmsToken))
      };
    }
  });
}
async function fetchXboxProfile() {
  const _0x2319e0 = loadSettings();
  const _0x5d3c96 = xboxAuthHeader(_0x2319e0);
  if (!_0x5d3c96) {
    return {
      ok: false,
      error: "Xbox nicht verbunden."
    };
  }
  try {
    const _0x578f0a = await fetch("https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,GameDisplayPicRaw,Gamerscore,AccountTier", {
      headers: {
        Authorization: _0x5d3c96,
        "x-xbl-contract-version": "2",
        Accept: "application/json"
      }
    });
    if (!_0x578f0a.ok) {
      return {
        ok: false,
        error: "Profil " + _0x578f0a.status
      };
    }
    const _0x2072a9 = await _0x578f0a.json();
    const _0x370cfd = ((_0x2072a9.profileUsers || [])[0] || {}).settings || [];
    const _0x2a947b = _0x29fea9 => (_0x370cfd.find(_0x2eed52 => _0x2eed52.id === _0x29fea9) || {}).value || "";
    return {
      ok: true,
      xuid: ((_0x2072a9.profileUsers || [])[0] || {}).id || _0x2319e0.xboxXuid,
      gamertag: _0x2a947b("Gamertag") || _0x2319e0.xboxGamertag,
      avatar: _0x2a947b("GameDisplayPicRaw"),
      gamerscore: _0x2a947b("Gamerscore")
    };
  } catch (_0x36c619) {
    return {
      ok: false,
      error: _0x36c619.message
    };
  }
}
async function fetchXboxStorePage(_0x536fcc = 0, _0x539391 = 10) {
  const _0x3efaa9 = "https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=DE&languages=de-DE&fieldsTemplate=Details&count=" + _0x539391 + "&$skip=" + _0x536fcc;
  const _0x130e8a = await fetchJson(_0x3efaa9, {
    headers: {
      Accept: "application/json"
    }
  }, 12000);
  if (!_0x130e8a || !Array.isArray(_0x130e8a.Products)) {
    return {
      items: [],
      total: 0,
      nextStart: _0x536fcc,
      done: true
    };
  }
  const _0x403d58 = [];
  for (const _0x2c243d of _0x130e8a.Products) {
    const _0xitemXb = xboxProduktZuItem(_0x2c243d);
    if (_0xitemXb) {
      _0x403d58.push(_0xitemXb);
    }
  }
  const _0x3ec0b3 = _0x130e8a.TotalResultCount || 0;
  const _0x492c4e = _0x536fcc + _0x539391;
  return {
    items: _0x403d58,
    total: _0x3ec0b3,
    nextStart: _0x492c4e,
    done: !_0x130e8a.HasMorePages || _0x492c4e >= _0x3ec0b3
  };
}
function xboxProduktZuItem(_0x2c243d) {
  {
    if (_0x2c243d.ProductType !== "Game") {
      return null;
    }
    const _0x36d548 = (_0x2c243d.LocalizedProperties || [])[0] || {};
    if (!_0x36d548.ProductTitle) {
      return null;
    }
    const _0x1af36a = _0x36d548.Images || [];
    const _0x507836 = (..._0x11fbaa) => (_0x1af36a.find(_0x3642c0 => _0x11fbaa.some(_0x1101a3 => new RegExp(_0x1101a3, "i").test(_0x3642c0.ImagePurpose))) || {}).Uri;
    let _0x14597e = _0x507836("SuperHeroArt", "FeaturePromotionalSquareArt", "Poster", "BoxArt", "Logo") || (_0x1af36a[0] || {}).Uri || null;
    if (_0x14597e && _0x14597e.startsWith("//")) {
      _0x14597e = "https:" + _0x14597e;
    }
    let _0x4627f6 = _0x507836("Poster", "BoxArt");
    if (_0x4627f6 && _0x4627f6.startsWith("//")) {
      _0x4627f6 = "https:" + _0x4627f6;
    }
    const _0xshotsXb = [];
    const _0xseenXb = new Set();
    for (const _0ximgXb of _0x1af36a) {
      if (!_0ximgXb || !/screenshot/i.test(String(_0ximgXb.ImagePurpose || ""))) {
        continue;
      }
      let _0xuriXb = _0ximgXb.Uri || "";
      if (_0xuriXb.startsWith("//")) {
        _0xuriXb = "https:" + _0xuriXb;
      }
      if (!_0xuriXb || _0xseenXb.has(_0xuriXb)) {
        continue;
      }
      _0xseenXb.add(_0xuriXb);
      _0xshotsXb.push({
        thumb: _0xuriXb,
        full: _0xuriXb
      });
    }
    const _0x1f8b91 = (_0x2c243d.DisplaySkuAvailabilities || [])[0] || {};
    const _0x22e133 = (_0x1f8b91.Availabilities || [])[0] || {};
    const _0x563aa3 = (_0x22e133.OrderManagementData || {}).Price || {};
    const _0x1adddb = ((_0x2c243d.MarketProperties || [])[0] || {}).OriginalReleaseDate || null;
    const _0x4dfc29 = (_0x22e133.Actions || []).map(_0x5cdc08 => String(_0x5cdc08).toLowerCase());
    const _0x3f96b9 = _0x4dfc29.includes("preorder");
    const _0x48fe18 = _0x3f96b9 || isUnreleased(_0x1adddb) && !_0x4dfc29.includes("purchase");
    const _0x5585d1 = typeof _0x563aa3.ListPrice === "number" ? _0x563aa3.ListPrice : null;
    const _0x29e09c = typeof _0x563aa3.MSRP === "number" ? _0x563aa3.MSRP : null;
    const _0x3737c0 = _0x5585d1 != null ? Math.round(_0x5585d1 * 100) : null;
    const _0x350645 = _0x29e09c != null && _0x5585d1 != null && _0x29e09c > _0x5585d1 ? Math.round(_0x29e09c * 100) : null;
    // AllowedPlatforms ist unbrauchbar (GTA VI meldet dort Desktop). Aussagekraeftig sind
    // die Paket-Plattformen; unveroeffentlichte Spiele haben noch keine Pakete, tragen aber
    // Konsolen-Attribute wie ConsoleGen9Optimized.
    const _0xpaketPlattformen = new Set();
    const _0xattribute = new Set();
    for (const _0xdsa of _0x2c243d.DisplaySkuAvailabilities || []) {
      const _0xskuProps = (_0xdsa && _0xdsa.Sku && _0xdsa.Sku.Properties) || {};
      for (const _0xpkg of _0xskuProps.Packages || []) {
        for (const _0xdep of (_0xpkg && _0xpkg.PlatformDependencies) || []) {
          if (_0xdep && _0xdep.PlatformName) {
            _0xpaketPlattformen.add(_0xdep.PlatformName);
          }
        }
      }
    }
    for (const _0xattr of (_0x2c243d.Properties && _0x2c243d.Properties.Attributes) || []) {
      if (_0xattr && _0xattr.Name) {
        _0xattribute.add(_0xattr.Name);
      }
    }
    const _0xhatPc = _0xpaketPlattformen.has("Windows.Desktop") || _0xpaketPlattformen.has("Windows.Universal");
    const _0xhatKonsole = _0xpaketPlattformen.has("Windows.Xbox") || [..._0xattribute].some(_0xa => /^Console/i.test(_0xa));
    const _0xnurKonsole = _0xhatKonsole && !_0xhatPc;
    const _0xseriesXS = _0xattribute.has("ConsoleGen9Optimized") || _0xattribute.has("XboxSeriesXOptimized");
    return {
      konsole: _0xnurKonsole ? "xbox" : null,
      systemName: _0xnurKonsole ? (_0xseriesXS ? "Xbox Series X|S" : "Xbox One / Series X|S") : null,
      platform: "xbox",
      category: "Xbox Store",
      id: _0x2c243d.ProductId,
      title: _0x36d548.ProductTitle,
      image: _0x14597e,
      portrait: _0x4627f6,
      screenshots: _0xshotsXb,
      shortDescription: _0x36d548.ShortDescription || "",
      description: _0x36d548.ProductDescription || "",
      developer: _0x36d548.DeveloperName || "",
      seller: _0x36d548.PublisherName || "Microsoft",
      priceCents: _0x3737c0,
      originalPriceCents: _0x350645,
      discountPercent: _0x350645 ? Math.round((1 - (_0x3737c0 || 0) / _0x350645) * 100) : 0,
      currency: _0x563aa3.CurrencyCode || "EUR",
      releaseDate: _0x1adddb,
      comingSoon: _0x48fe18,
      preorder: _0x3f96b9,
      // Checkout in die NATIVE Store-App leiten (ms-windows-store://pdp) - dort laeuft
      // Kauf/Installation. Die Web-Seite als Fallback fuer "im Browser ansehen".
      storeUrl: "ms-windows-store://pdp/?ProductId=" + _0x2c243d.ProductId,
      webUrl: "https://www.microsoft.com/de-de/p/-/" + _0x2c243d.ProductId
    };
  }
}
// Nintendo eShop (Europa): oeffentlicher Solr-Katalog, ohne Login/Key.
function nintendoDocZuItem(_0xd) {
  if (!_0xd || !_0xd.title) {
    return null;
  }
  const _0xnum = _0xv => {
    const _0xn = typeof _0xv === "number" ? _0xv : parseFloat(String(_0xv || "").replace(",", "."));
    return Number.isFinite(_0xn) ? _0xn : null;
  };
  const _0xregular = _0xnum(_0xd.price_regular_f);
  const _0xlowest = _0xnum(_0xd.price_lowest_f);
  const _0xrabatt = !!_0xd.price_has_discount_b && _0xregular != null && _0xlowest != null && _0xlowest < _0xregular;
  const _0xpreis = _0xrabatt ? _0xlowest : _0xregular;
  const _0xsystem = Array.isArray(_0xd.system_names_txt) ? _0xd.system_names_txt.join(", ") : _0xd.system_names_txt || "Nintendo Switch";
  const _0xdatum = _0xd.dates_released_dts ? String(Array.isArray(_0xd.dates_released_dts) ? _0xd.dates_released_dts[0] : _0xd.dates_released_dts).slice(0, 10) : null;
  return {
    platform: "nintendo",
    category: "Nintendo eShop",
    id: String(_0xd.fs_id || (Array.isArray(_0xd.nsuid_txt) ? _0xd.nsuid_txt[0] : _0xd.nsuid_txt) || _0xd.title),
    nsuid: Array.isArray(_0xd.nsuid_txt) ? _0xd.nsuid_txt[0] : _0xd.nsuid_txt || null,
    title: _0xd.title,
    image: _0xd.image_url_h2x1_s || _0xd.image_url_h16x9_s || _0xd.image_url_sq_s || _0xd.image_url || null,
    portrait: _0xd.image_url_sq_s || null,
    wide: _0xd.image_url_h16x9_s || _0xd.image_url_h2x1_s || null,
    shortDescription: _0xd.excerpt || "",
    description: _0xd.excerpt || "",
    developer: _0xd.developer || _0xd.publisher || "",
    seller: "Nintendo eShop",
    publishers: _0xd.publisher ? [_0xd.publisher] : [],
    genres: Array.isArray(_0xd.pretty_game_categories_txt) ? _0xd.pretty_game_categories_txt : _0xd.pretty_game_categories_txt ? [_0xd.pretty_game_categories_txt] : [],
    priceCents: _0xpreis != null ? Math.round(_0xpreis * 100) : null,
    originalPriceCents: _0xrabatt ? Math.round(_0xregular * 100) : null,
    discountPercent: _0xrabatt ? Math.round(_0xnum(_0xd.price_discount_percentage_f) || (1 - _0xlowest / _0xregular) * 100) : 0,
    currency: "EUR",
    releaseDate: _0xdatum,
    comingSoon: isUnreleased(_0xdatum),
    requiredAge: _0xnum(_0xd.age_rating_value) || 0,
    konsole: "switch",
    systemName: _0xsystem,
    storeUrl: _0xd.url ? "https://www.nintendo.com" + _0xd.url : "https://www.nintendo.com/de-de/Spiele/Spiele-347085.html"
  };
}
async function fetchNintendoStorePage(_0xstart = 0, _0xcount = 24, _0xterm = "") {
  const _0xq = String(_0xterm || "").trim();
  const _0xurl = "https://searching.nintendo-europe.com/de/select?q=" + encodeURIComponent(_0xq || "*") + "&fq=" + encodeURIComponent("type:GAME AND system_type:nintendoswitch*") + "&rows=" + _0xcount + "&start=" + _0xstart + (_0xq ? "" : "&sort=" + encodeURIComponent("popularity asc")) + "&wt=json";
  const _0xdata = await fetchJson(_0xurl, {
    headers: { Accept: "application/json" }
  }, 12000);
  const _0xresp = _0xdata && _0xdata.response;
  if (!_0xresp || !Array.isArray(_0xresp.docs)) {
    return { items: [], total: 0, nextStart: _0xstart, done: true };
  }
  const _0xitems = _0xresp.docs.map(nintendoDocZuItem).filter(Boolean);
  const _0xnext = _0xstart + _0xcount;
  return {
    items: _0xitems,
    total: _0xresp.numFound || 0,
    nextStart: _0xnext,
    done: _0xnext >= (_0xresp.numFound || 0) || !_0xresp.docs.length
  };
}
// PlayStation Store: dieselbe GraphQL-Abfrage, die store.playstation.com selbst nutzt.
// Ohne Content-Type-Header lehnt Sony die Anfrage als CSRF ab.
const PS_GQL_HASH = "4ce7d410a4db2c8b635a48c1dcec375906ff63b19dadd87e073f8fd0c0481d35";
const PS_KATEGORIEN = { ps5: "4cbf39e2-5749-4970-ba81-93a489e4570c", ps4: "44d8bb20-653e-431e-8ad0-c0a365f68d2f" };
function psPreisCents(_0xtext) {
  const _0xm = String(_0xtext || "").replace(/\./g, "").match(/(\d+),(\d{2})/);
  return _0xm ? parseInt(_0xm[1], 10) * 100 + parseInt(_0xm[2], 10) : null;
}
function psProduktZuItem(_0xp) {
  if (!_0xp || !_0xp.id || !_0xp.name) {
    return null;
  }
  const _0xbilder = (_0xp.media || []).filter(_0xm => _0xm && _0xm.type === "IMAGE");
  const _0xbild = (..._0xrollen) => {
    for (const _0xr of _0xrollen) {
      const _0xf = _0xbilder.find(_0xm => _0xm.role === _0xr);
      if (_0xf && _0xf.url) {
        return _0xf.url;
      }
    }
    return null;
  };
  const _0xpreis = _0xp.price || {};
  const _0xfrei = !!_0xpreis.isFree;
  const _0xbasis = _0xfrei ? 0 : psPreisCents(_0xpreis.basePrice);
  const _0xaktuell = _0xfrei ? 0 : psPreisCents(_0xpreis.discountedPrice);
  const _0xrabatt = _0xbasis != null && _0xaktuell != null && _0xaktuell < _0xbasis;
  const _0xplattformen = Array.isArray(_0xp.platforms) ? _0xp.platforms : [];
  const _0xvorbestellung = (_0xp.skus || []).some(_0xs => _0xs && _0xs.type === "PREORDER");
  return {
    platform: "playstation",
    category: "PlayStation Store",
    id: _0xp.id,
    title: _0xp.name,
    image: _0xbild("SIXTEEN_BY_NINE_BANNER", "MASTER", "GAMEHUB_COVER_ART", "FOUR_BY_THREE_BANNER"),
    portrait: _0xbild("PORTRAIT_BANNER", "MASTER"),
    wide: _0xbild("BACKGROUND", "SIXTEEN_BY_NINE_BANNER"),
    logo: _0xbild("LOGO"),
    screenshots: _0xbilder.filter(_0xm => _0xm.role === "SCREENSHOT").map(_0xm => ({ thumb: _0xm.url, full: _0xm.url })),
    videos: (_0xp.media || []).filter(_0xm => _0xm && _0xm.type === "VIDEO" && _0xm.url).map(_0xm => _0xm.url),
    shortDescription: _0xp.localizedStoreDisplayClassification || "",
    seller: "PlayStation Store",
    priceCents: _0xaktuell,
    originalPriceCents: _0xrabatt ? _0xbasis : null,
    discountPercent: _0xrabatt ? Math.round((1 - _0xaktuell / _0xbasis) * 100) : 0,
    discountBadge: _0xrabatt && _0xpreis.discountText ? _0xpreis.discountText : undefined,
    currency: "EUR",
    preorder: _0xvorbestellung,
    konsole: "playstation",
    systemName: _0xplattformen.length ? _0xplattformen.join(" / ") : "PlayStation",
    storeUrl: "https://store.playstation.com/de-de/product/" + encodeURIComponent(_0xp.id)
  };
}
async function fetchPsKategorie(_0xkat, _0xoffset, _0xsize) {
  const _0xvars = { id: _0xkat, pageArgs: { size: _0xsize, offset: _0xoffset }, sortBy: { name: "productReleaseDate", isAscending: false }, filterBy: [], facetOptions: [] };
  const _0xurl = "https://web.np.playstation.com/api/graphql/v1/op?operationName=categoryGridRetrieve&variables=" + encodeURIComponent(JSON.stringify(_0xvars)) + "&extensions=" + encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: PS_GQL_HASH } }));
  const _0xdata = await fetchJson(_0xurl, {
    headers: { "Content-Type": "application/json", "Accept-Language": "de-DE", "x-psn-store-locale-override": "de-DE" }
  }, 20000);
  const _0xgrid = _0xdata && _0xdata.data && _0xdata.data.categoryGridRetrieve;
  return {
    items: ((_0xgrid && _0xgrid.products) || []).map(psProduktZuItem).filter(Boolean),
    total: (_0xgrid && _0xgrid.pageInfo && _0xgrid.pageInfo.totalCount) || 0
  };
}
async function fetchPsStorePage(_0xstart = 0, _0xcount = 48) {
  const _0xerg = await fetchPsKategorie(PS_KATEGORIEN.ps5, _0xstart, _0xcount);
  const _0xnext = _0xstart + _0xcount;
  return { items: _0xerg.items, total: _0xerg.total, nextStart: _0xnext, done: !_0xerg.items.length || _0xnext >= _0xerg.total };
}
// Sony bietet ohne Login keine Textsuche an: die Listen werden einmal komplett
// geholt (PS5 ~9.300, PS4 ~6.900 in 1000er-Seiten) und im Speicher durchsucht.
let _psSuchIndex = null;
let _psSuchIndexZeit = 0;
let _psSuchIndexLaeuft = null;
async function psSuchIndex() {
  if (_psSuchIndex && Date.now() - _psSuchIndexZeit < 12 * 60 * 60 * 1000) {
    return _psSuchIndex;
  }
  if (_psSuchIndexLaeuft) {
    return _psSuchIndexLaeuft;
  }
  _psSuchIndexLaeuft = (async () => {
    const _0xalle = new Map();
    for (const _0xkat of [PS_KATEGORIEN.ps5, PS_KATEGORIEN.ps4]) {
      const _0xerste = await fetchPsKategorie(_0xkat, 0, 1000);
      _0xerste.items.forEach(_0xi => _0xalle.has(_0xi.id) || _0xalle.set(_0xi.id, _0xi));
      const _0xoffsets = [];
      for (let _0xo = 1000; _0xo < Math.min(_0xerste.total, 20000); _0xo += 1000) {
        _0xoffsets.push(_0xo);
      }
      for (let _0xi = 0; _0xi < _0xoffsets.length; _0xi += 4) {
        const _0xteile = await Promise.all(_0xoffsets.slice(_0xi, _0xi + 4).map(_0xo => fetchPsKategorie(_0xkat, _0xo, 1000).catch(() => ({ items: [] }))));
        _0xteile.forEach(_0xt => _0xt.items.forEach(_0xit => _0xalle.has(_0xit.id) || _0xalle.set(_0xit.id, _0xit)));
      }
    }
    if (_0xalle.size) {
      _psSuchIndex = [..._0xalle.values()];
      _psSuchIndexZeit = Date.now();
    }
    return _psSuchIndex || [];
  })().finally(() => {
    _psSuchIndexLaeuft = null;
  });
  return _psSuchIndexLaeuft;
}
function konsolenSuchNorm(_0xt) {
  const _0xroemisch = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  return String(_0xt || "")
    .toLowerCase()
    .replace(/[™®©:–\-]/g, " ")
    .replace(/\bgta\b/g, "grand theft auto")
    .replace(/\brdr\b/g, "red dead redemption")
    .replace(/\bcod\b/g, "call of duty")
    .replace(/\b(viii|vii|vi|iv|ix|iii|ii|x|v|i)\b/g, _0xz => _0xroemisch[_0xz])
    .replace(/\s+/g, " ")
    .trim();
}
async function fetchPsSearch(_0xterm) {
  const _0xq = konsolenSuchNorm(_0xterm);
  if (!_0xq) {
    return { items: [] };
  }
  const _0xworte = _0xq.split(" ");
  const _0xindex = await psSuchIndex();
  const _0xtreffer = _0xindex.filter(_0xi => {
    const _0xn = konsolenSuchNorm(_0xi.title);
    return _0xworte.every(_0xw => (" " + _0xn + " ").includes(" " + _0xw) );
  });
  // Kurze Titel zuerst: "GTA VI" vor "GTA VI: Ultimate Edition".
  _0xtreffer.sort((_0xa, _0xb) => _0xa.title.length - _0xb.title.length);
  return { items: _0xtreffer.slice(0, 24), indexGroesse: _0xindex.length };
}
async function fetchXboxSearch(_0xterm) {
  const _0xq = String(_0xterm || "").trim();
  if (!_0xq) {
    return { items: [] };
  }
  // Microsoft findet nur volle Titel: "gta 6" liefert nichts, "grand theft auto vi" schon.
  const _0xroemisch = { 1: "i", 2: "ii", 3: "iii", 4: "iv", 5: "v", 6: "vi", 7: "vii", 8: "viii", 9: "ix", 10: "x" };
  const _0xlang = _0xq.replace(/\bgta\b/gi, "grand theft auto").replace(/\bcod\b/gi, "call of duty").replace(/\brdr\b/gi, "red dead redemption").replace(/\bfh\b/gi, "forza horizon");
  const _0xvarianten = [...new Set([_0xq, _0xlang, _0xlang.replace(/\b(10|[1-9])\b/g, _0xz => _0xroemisch[_0xz])].map(_0xv => _0xv.trim()).filter(Boolean))];
  const _0xantworten = await Promise.all(_0xvarianten.map(_0xv => fetchJson("https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=DE&languages=de-DE&productFamilyNames=Games&query=" + encodeURIComponent(_0xv), {
    headers: { Accept: "application/json" }
  }, 10000)));
  const _0xids = [];
  for (const _0xsug of _0xantworten.reverse()) {
    for (const _0xres of (_0xsug && _0xsug.Results) || []) {
      for (const _0xp of _0xres.Products || []) {
        // Spiele haben IDs mit "9…"; Add-ons/Waehrung beginnen mit B/C.
        if (_0xp && /^9/.test(String(_0xp.ProductId || "")) && !_0xids.includes(_0xp.ProductId)) {
          _0xids.push(_0xp.ProductId);
        }
      }
    }
  }
  if (!_0xids.length) {
    return { items: [] };
  }
  const _0xdet = await fetchJson("https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=" + _0xids.slice(0, 20).join(",") + "&market=DE&languages=de-DE&fieldsTemplate=Details", {
    headers: { Accept: "application/json" }
  }, 12000);
  const _0xitems = [];
  for (const _0xid of _0xids) {
    const _0xprod = ((_0xdet && _0xdet.Products) || []).find(_0xp => _0xp.ProductId === _0xid);
    const _0xit = _0xprod ? xboxProduktZuItem(_0xprod) : null;
    // Platzhalter-Eintraege (Release 9998, Preis 0, nicht kaufbar) wuerden sonst als gratis erscheinen.
    if (_0xit && !/^99\d\d/.test(String(_0xit.releaseDate || ""))) {
      _0xitems.push(_0xit);
    }
  }
  return { items: _0xitems };
}
async function fetchXboxDetails(_0xgame) {
  const _0xid = _0xgame && (_0xgame.id || _0xgame.ProductId) || "";
  if (!_0xid) {
    return null;
  }
  // Schon vorhandene Screenshots aus dem Katalog-Eintrag nutzen, wenn genug da.
  const _0xcachedShots = Array.isArray(_0xgame.screenshots) ? _0xgame.screenshots : [];
  let _0xprod = null;
  const _0xurl = "https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=" + encodeURIComponent(_0xid) + "&market=DE&languages=de-DE&fieldsTemplate=Details";
  const _0xdata = await fetchJson(_0xurl, {
    headers: {
      Accept: "application/json"
    }
  }, 12000);
  if (_0xdata && Array.isArray(_0xdata.Products) && _0xdata.Products[0]) {
    _0xprod = _0xdata.Products[0];
  }
  const _0xlp = _0xprod && (_0xprod.LocalizedProperties || [])[0] || {};
  const _0ximages = Array.isArray(_0xlp.Images) ? _0xlp.Images : [];
  const _0xpick = (..._0xpurposes) => {
    const _0xfound = _0ximages.find(_0xim => _0xpurposes.some(_0xp => new RegExp(_0xp, "i").test(_0xim.ImagePurpose || "")));
    let _0xu = _0xfound && _0xfound.Uri || null;
    if (_0xu && _0xu.startsWith("//")) {
      _0xu = "https:" + _0xu;
    }
    return _0xu;
  };
  const _0xshots = [];
  const _0xseen = new Set();
  const _0xpush = _0xu => {
    let _0xurlS = typeof _0xu === "string" ? _0xu : _0xu && (_0xu.full || _0xu.thumb || _0xu.Uri) || "";
    if (_0xurlS.startsWith("//")) {
      _0xurlS = "https:" + _0xurlS;
    }
    if (!_0xurlS || _0xseen.has(_0xurlS)) {
      return;
    }
    _0xseen.add(_0xurlS);
    _0xshots.push({
      thumb: _0xurlS,
      full: _0xurlS
    });
  };
  for (const _0xim of _0ximages) {
    if (_0xim && /screenshot/i.test(String(_0xim.ImagePurpose || ""))) {
      _0xpush(_0xim.Uri);
    }
  }
  for (const _0xc of _0xcachedShots) {
    _0xpush(_0xc);
  }
  let _0xhero = _0xpick("SuperHeroArt", "FeaturePromotionalSquareArt", "Poster", "BoxArt") || _0xgame.image || null;
  if (!_0xshots.length && _0xhero) {
    _0xpush(_0xhero);
  }
  const _0xsku = _0xprod && (_0xprod.DisplaySkuAvailabilities || [])[0] || {};
  const _0xav = (_0xsku.Availabilities || [])[0] || {};
  const _0xprice = (_0xav.OrderManagementData || {}).Price || {};
  const _0xlist = typeof _0xprice.ListPrice === "number" ? Math.round(_0xprice.ListPrice * 100) : typeof _0xgame.priceCents === "number" ? _0xgame.priceCents : null;
  const _0xmsrp = typeof _0xprice.MSRP === "number" ? Math.round(_0xprice.MSRP * 100) : typeof _0xgame.originalPriceCents === "number" ? _0xgame.originalPriceCents : null;
  const _0xrel = _0xprod && ((_0xprod.MarketProperties || [])[0] || {}).OriginalReleaseDate || _0xgame.releaseDate || null;
  if (!_0xprod && !_0xshots.length && !_0xhero) {
    return null;
  }
  return {
    platform: "xbox",
    id: _0xid,
    title: _0xlp.ProductTitle || _0xgame.title || "",
    heroImage: _0xhero,
    screenshots: _0xshots,
    movies: [],
    editions: [],
    adult: false,
    contentNotes: null,
    shortDescription: (_0xlp.ShortDescription || _0xgame.shortDescription || "").slice(0, 300),
    description: htmlToText(_0xlp.ProductDescription || _0xgame.description || ""),
    developers: _0xlp.DeveloperName || _0xgame.developer ? [String(_0xlp.DeveloperName || _0xgame.developer)] : [],
    publishers: _0xlp.PublisherName || _0xgame.seller ? [String(_0xlp.PublisherName || _0xgame.seller)] : [],
    releaseDate: _0xrel ? new Date(_0xrel).toLocaleDateString("de-DE", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }) : null,
    genres: [],
    categories: [],
    priceCents: _0xlist,
    originalPriceCents: _0xmsrp != null && _0xlist != null && _0xmsrp > _0xlist ? _0xmsrp : null,
    discountPercent: _0xmsrp != null && _0xlist != null && _0xmsrp > _0xlist ? Math.round((1 - _0xlist / _0xmsrp) * 100) : 0,
    rating: null,
    requiredAge: 0,
    website: null,
    storeUrl: _0xgame.webUrl || _0xgame.storeUrl || "https://www.microsoft.com/de-de/p/-/" + _0xid
  };
}
async function fetchXboxLibrary() {
  const _0x5a3288 = loadSettings();
  const _0x1f82a2 = xboxAuthHeader(_0x5a3288);
  if (!_0x1f82a2 || !_0x5a3288.xboxXuid) {
    return {
      ok: false,
      error: "Xbox nicht verbunden.",
      games: []
    };
  }
  try {
    const _0xbc709e = await fetch("https://titlehub.xboxlive.com/users/xuid(" + _0x5a3288.xboxXuid + ")/titles/titlehistory/decoration/detail,image", {
      headers: {
        Authorization: _0x1f82a2,
        "x-xbl-contract-version": "2",
        Accept: "application/json",
        "Accept-Language": acceptLang()
      }
    });
    if (!_0xbc709e.ok) {
      return {
        ok: false,
        error: "Bibliothek " + _0xbc709e.status,
        games: []
      };
    }
    const _0x53bba2 = await _0xbc709e.json();
    const _0x35ca0e = (_0x53bba2.titles || []).filter(_0x373159 => (_0x373159.devices || []).some(_0x52c90d => /^(PC|Win32)$/i.test(_0x52c90d))).map(_0x5b8fb9 => ({
      platform: "xbox",
      id: String(_0x5b8fb9.titleId),
      title: _0x5b8fb9.name || "Unbekannt",
      image: _0x5b8fb9.displayImage || null,
      installPath: null,
      owned: true,
      lastPlayed: (_0x5b8fb9.titleHistory || {}).lastTimePlayed || null
    }));
    _0x35ca0e.sort((_0x28165b, _0x11175f) => _0x28165b.title.localeCompare(_0x11175f.title, "de"));
    return {
      ok: true,
      games: _0x35ca0e,
      count: _0x35ca0e.length
    };
  } catch (_0x7a61c6) {
    return {
      ok: false,
      error: _0x7a61c6.message,
      games: []
    };
  }
}
async function fetchXboxUserProfile(_0x5850b1) {
  const _0x2cf060 = loadSettings();
  const _0x48af28 = xboxAuthHeader(_0x2cf060);
  if (!_0x48af28 || !_0x5850b1) {
    return {
      ok: false,
      error: "Xbox nicht verbunden."
    };
  }
  try {
    const _0x4f8cf1 = await fetch("https://profile.xboxlive.com/users/batch/profile/settings", {
      method: "POST",
      headers: {
        Authorization: _0x48af28,
        "x-xbl-contract-version": "2",
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        userIds: [String(_0x5850b1)],
        settings: ["Gamertag", "GameDisplayPicRaw", "Gamerscore", "AccountTier", "TenureLevel"]
      })
    });
    if (!_0x4f8cf1.ok) {
      return {
        ok: false,
        error: "Profil " + _0x4f8cf1.status
      };
    }
    const _0x7b5e6d = await _0x4f8cf1.json();
    const _0x2f3eaf = (_0x7b5e6d.profileUsers || [])[0] || {};
    const _0x1ab966 = _0x429cda => ((_0x2f3eaf.settings || []).find(_0x4ebb5b => _0x4ebb5b.id === _0x429cda) || {}).value || "";
    return {
      ok: true,
      xuid: _0x2f3eaf.id || _0x5850b1,
      gamertag: _0x1ab966("Gamertag"),
      avatar: _0x1ab966("GameDisplayPicRaw"),
      gamerscore: _0x1ab966("Gamerscore"),
      tier: _0x1ab966("AccountTier"),
      tenure: _0x1ab966("TenureLevel")
    };
  } catch (_0x11c2d2) {
    return {
      ok: false,
      error: _0x11c2d2.message
    };
  }
}
async function fetchXboxFriendsDocumented(_0x120677) {
  const _0x71137c = await fetch("https://social.xboxlive.com/users/me/people", {
    headers: {
      Authorization: _0x120677,
      "x-xbl-contract-version": "2",
      Accept: "application/json"
    }
  });
  if (!_0x71137c.ok) {
    throw new Error("social " + _0x71137c.status);
  }
  const _0x45b4f1 = ((await _0x71137c.json()).people || []).filter(_0x1425ec => _0x1425ec.xuid);
  if (!_0x45b4f1.length) {
    return [];
  }
  const _0x5ada1c = _0x45b4f1.map(_0x1e2bb8 => String(_0x1e2bb8.xuid));
  const _0x18a13d = {};
  const _0x5afbe4 = {};
  for (let _0x5c1f0f = 0; _0x5c1f0f < _0x5ada1c.length; _0x5c1f0f += 200) {
    const _0xba1372 = _0x5ada1c.slice(_0x5c1f0f, _0x5c1f0f + 200);
    try {
      const _0x195d17 = await fetch("https://profile.xboxlive.com/users/batch/profile/settings", {
        method: "POST",
        headers: {
          Authorization: _0x120677,
          "x-xbl-contract-version": "2",
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          userIds: _0xba1372,
          settings: ["Gamertag", "GameDisplayPicRaw"]
        })
      });
      if (_0x195d17.ok) {
        for (const _0x539269 of (await _0x195d17.json()).profileUsers || []) {
          const _0x57a2ba = _0x19824e => ((_0x539269.settings || []).find(_0x4281e7 => _0x4281e7.id === _0x19824e) || {}).value || "";
          _0x18a13d[_0x539269.id] = {
            gamertag: _0x57a2ba("Gamertag"),
            avatar: _0x57a2ba("GameDisplayPicRaw")
          };
        }
      }
    } catch {}
    try {
      const _0x2a3d85 = await fetch("https://userpresence.xboxlive.com/users/batch", {
        method: "POST",
        headers: {
          Authorization: _0x120677,
          "x-xbl-contract-version": "3",
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          users: _0xba1372,
          level: "title"
        })
      });
      if (_0x2a3d85.ok) {
        for (const _0x7f7f65 of await _0x2a3d85.json()) {
          _0x5afbe4[_0x7f7f65.xuid] = _0x7f7f65;
        }
      }
    } catch {}
  }
  return _0x45b4f1.map(_0x1af9fd => {
    const _0x11a645 = _0x18a13d[_0x1af9fd.xuid] || {};
    const _0x407e04 = _0x5afbe4[_0x1af9fd.xuid] || {};
    const _0x43c7e1 = String(_0x407e04.state || "").toLowerCase() === "online";
    const _0x43c423 = ((_0x407e04.devices || [])[0] || {}).titles && ((_0x407e04.devices || [])[0].titles.find(_0x4bdbe1 => _0x4bdbe1.name && !/home/i.test(_0x4bdbe1.name)) || {});
    const _0x2907b1 = _0x43c423 && _0x43c423.name ? _0x43c423.name : null;
    return {
      name: _0x11a645.gamertag || _0x1af9fd.gamertag || String(_0x1af9fd.xuid),
      avatar: _0x11a645.avatar || null,
      status: _0x43c7e1 ? _0x2907b1 ? "playing" : "online" : "offline",
      gameId: null,
      gameTitle: _0x2907b1,
      platform: "xbox",
      xuid: String(_0x1af9fd.xuid),
      favorite: !!_0x1af9fd.isFavorite
    };
  });
}
async function fetchXboxFriends() {
  const _0x444c57 = loadSettings();
  const _0x44b85b = xboxAuthHeader(_0x444c57);
  if (!_0x44b85b) {
    return {
      ok: false,
      error: "Xbox nicht verbunden.",
      friends: []
    };
  }
  try {
    const _0x2ae75e = await fetch("https://peoplehub.xboxlive.com/users/me/people/social/decoration/presenceDetail", {
      headers: {
        Authorization: _0x44b85b,
        "x-xbl-contract-version": "5",
        Accept: "application/json",
        "Accept-Language": acceptLang()
      }
    });
    if (!_0x2ae75e.ok) {
      try {
        const _0xe0e48f = await fetchXboxFriendsDocumented(_0x44b85b);
        _0xe0e48f.sort((_0x1079fa, _0x33509c) => Number(_0x33509c.favorite) - Number(_0x1079fa.favorite) || _0x1079fa.name.localeCompare(_0x33509c.name, "de"));
        return {
          ok: true,
          friends: _0xe0e48f,
          via: "documented"
        };
      } catch (_0x2eaa0a) {
        return {
          ok: false,
          error: "Freunde " + _0x2ae75e.status + " / " + _0x2eaa0a.message,
          friends: []
        };
      }
    }
    const _0x5e4bdd = await _0x2ae75e.json();
    const _0x2cd7b3 = (_0x5e4bdd.people || []).map(_0x4c4df9 => {
      const _0xd2f513 = String(_0x4c4df9.presenceState || "").toLowerCase() === "online";
      const _0x10a63d = _0x4c4df9.presenceText || "";
      const _0x2d03a1 = _0xd2f513 && _0x10a63d && !/^(home|online)$/i.test(_0x10a63d);
      return {
        name: _0x4c4df9.gamertag || _0x4c4df9.displayName || _0x4c4df9.xuid,
        avatar: _0x4c4df9.displayPicRaw || null,
        status: _0x2d03a1 ? "playing" : _0xd2f513 ? "online" : "offline",
        gameId: null,
        gameTitle: _0x2d03a1 ? _0x10a63d : null,
        platform: "xbox",
        xuid: _0x4c4df9.xuid,
        favorite: !!_0x4c4df9.isFavorite
      };
    });
    _0x2cd7b3.sort((_0x3d3fa6, _0x495bd8) => Number(_0x495bd8.favorite) - Number(_0x3d3fa6.favorite) || _0x3d3fa6.name.localeCompare(_0x495bd8.name, "de"));
    return {
      ok: true,
      friends: _0x2cd7b3
    };
  } catch (_0x393307) {
    return {
      ok: false,
      error: _0x393307.message,
      friends: []
    };
  }
}
async function syncSteamKeysFromServer() {
  const _0x5f5ba7 = loadSettings();
  if (!_0x5f5ba7.user) {
    return {
      ok: false,
      error: "Nicht angemeldet."
    };
  }
  const _0x5cc94b = _0x5f5ba7.user.username;
  const _0x1ba87f = _0x5f5ba7.apiBaseUrl.replace(/\/$/, "");
  try {
    console.log("Synchronisiere Steam-Keys für " + _0x5cc94b + " von " + _0x1ba87f + "/removed...");
    const _0x53d912 = await fetchJson(_0x1ba87f + "/removed", {}, 5000);
    if (_0x53d912 && Array.isArray(_0x53d912.accounts)) {
      const _0x512868 = _0x53d912.accounts.find(_0x4dda28 => _0x4dda28.username === _0x5cc94b || _0x4dda28.email === _0x5cc94b || _0x4dda28.email === _0x5f5ba7.user.email);
      if (_0x512868) {
        _0x5f5ba7.steamId64 = (_0x512868.steamId64 || _0x5f5ba7.steamId64 || "").trim();
        _0x5f5ba7.steamApiKey = (_0x512868.steamApiKey || _0x5f5ba7.steamApiKey || "").trim();
        saveSettings(_0x5f5ba7);
        console.log("Steam-Keys erfolgreich synchronisiert:", _0x5f5ba7.steamId64 ? "SteamID vorhanden" : "Keine SteamID");
        return {
          ok: true,
          steamId64: _0x5f5ba7.steamId64,
          steamApiKey: _0x5f5ba7.steamApiKey
        };
      }
    }
  } catch (_0x2b62af) {
    console.error("Fehler beim Synchronisieren der Steam-Keys:", _0x2b62af);
  }
  return {
    ok: false,
    error: "Konnte Profildaten nicht synchronisieren – ist die Webseite erreichbar?"
  };
}
function registerIpc() {
  ipcMain.handle("platforms:scan", async () => {
    const _0x5bbb36 = loadManualStore();
    const _0x4bf1ae = new Set(_0x5bbb36.hidden || []);
    const [_0x55ada0, _0x3c3944, _0xde1896, _0x1286fd, _0x415ba9] = await Promise.all([scanSteam(), scanEpic(), scanUbisoft(), scanEA(), scanDesktop()]);
    const _0x4504d7 = scanXbox();
    const _0x57eb1c = scanMinecraft();
    const _0x4753b2 = new Set();
    const _0x2d65e0 = [];
    for (const _0x32824a of [..._0x415ba9, ..._0x57eb1c, ...(_0x5bbb36.games || [])]) {
      const _0x25de3c = (_0x32824a.exePath || _0x32824a.id || "").toLowerCase();
      if (!_0x25de3c || _0x4753b2.has(_0x25de3c) || _0x4bf1ae.has(_0x32824a.id)) {
        continue;
      }
      _0x4753b2.add(_0x25de3c);
      _0x2d65e0.push(_0x32824a);
    }
    const _0x4c941f = {
      installed: _0x4504d7.installed,
      games: (_0x4504d7.games || []).filter(_0x5353e5 => !_0x4bf1ae.has(_0x5353e5.id))
    };
    const _0x191402 = _0x5bbb36.overrides || {};
    for (const _0x58ca2a of [..._0x2d65e0, ..._0x4c941f.games]) {
      applyOverrides(_0x58ca2a, _0x191402);
    }
    await Promise.all([..._0x2d65e0, ..._0x4c941f.games].filter(_0x1cfb05 => !_0x1cfb05.image && _0x1cfb05.exePath).map(async _0x29814d => {
      _0x29814d.image = await iconDataUrl(_0x29814d.exePath);
      const _0x22736f = _0x191402[_0x29814d.id];
      if (_0x29814d.image) {
        _0x29814d.imageContain = _0x22736f && _0x22736f.imageContain !== undefined ? !!_0x22736f.imageContain : true;
      }
    }));
    return {
      steam: _0x55ada0,
      epic: _0x3c3944,
      ubisoft: _0xde1896,
      ea: _0x1286fd,
      microsoft: _0x4c941f,
      manual: {
        installed: _0x2d65e0.length > 0,
        games: _0x2d65e0
      }
    };
  });
  ipcMain.handle("banner:get", (_0x57c5db, _0x5d659c) => {
    try {
      const _0x6abcf5 = bannerFile(_0x5d659c);
      if (fs.existsSync(_0x6abcf5)) {
        return "data:image/png;base64," + fs.readFileSync(_0x6abcf5).toString("base64");
      }
    } catch {}
    return null;
  });
  ipcMain.handle("banner:save", (_0x5b806e, {
    id: _0x390483,
    dataUrl: _0x239802
  }) => {
    try {
      const _0x4f1e34 = String(_0x239802 || "").split(",")[1];
      if (_0x4f1e34) {
        fs.writeFileSync(bannerFile(_0x390483), Buffer.from(_0x4f1e34, "base64"));
      }
      return {
        ok: true
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  ipcMain.handle("banner:clear", (_0x58079f, _0x536772) => {
    try {
      fs.unlinkSync(bannerFile(_0x536772));
    } catch {}
    return {
      ok: true
    };
  });
  ipcMain.handle("hardware:get", () => hardwareInfo);
  ipcMain.handle("banner:prompt", async (_0x4755a5, {
    title: _0x4baa73,
    iconBase64: _0x478bbc
  }) => {
    const _0x140193 = loadSettings();
    if (!_0x140193.llamaEnabled || !hardwareInfo.aiCapable) {
      return null;
    }
    const _0x96d2f = (_0x140193.llamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    const _0x2d5938 = {
      model: _0x140193.llamaModel || "llama3.2-vision",
      prompt: "Du schreibst Prompts für einen Bildgenerator. Erstelle EINEN kurzen, bildhaften englischen Prompt (max. 40 Wörter) für ein dunkles, cinematisches Videospiel-Banner/Key-Art für ein Spiel namens \"" + _0x4baa73 + "\". Kein Text im Bild. Antworte NUR mit dem Prompt.",
      stream: false
    };
    if (_0x478bbc) {
      _0x2d5938.images = [_0x478bbc];
    }
    const _0x2e4d1d = await fetchJson(_0x96d2f + "/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(_0x2d5938)
    }, 60000);
    if (_0x2e4d1d && _0x2e4d1d.response) {
      return String(_0x2e4d1d.response).trim().replace(/^["']|["']$/g, "").slice(0, 400);
    }
    return null;
  });
  // Konsolen-Erkennung: ein Standbild des HDMI-Signals (base64, ohne data:-Praefix)
  // an die lokale Vision-KI (Ollama) geben und daraus die KONSOLE bestimmen (nicht
  // das Spiel - das ist ein spaeterer Schritt). Antwort wird auf eine bekannte
  // Typ-Kennung normalisiert. Ohne aktivierte KI/Hardware: { ok:false } - der
  // Aufrufer faellt dann auf die Label-Heuristik zurueck (keine Regression).
  ipcMain.handle("konsole:erkennen", async (_0xkeEv, _0xkeArg) => {
    if (!istEigenerRenderer(_0xkeEv)) {
      return { ok: false, error: "Nicht autorisiert." };
    }
    const _0xkeS = loadSettings();
    if (!_0xkeS.llamaEnabled || !hardwareInfo.aiCapable) {
      return { ok: false, error: "ki-aus" };
    }
    const _0xkeImg = _0xkeArg && _0xkeArg.imageBase64 ? String(_0xkeArg.imageBase64).replace(/^data:[^,]+,/, "") : "";
    if (!_0xkeImg) {
      return { ok: false, error: "kein-bild" };
    }
    const _0xkeUrl = (_0xkeS.llamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    const _0xkePrompt = "Auf diesem Bild ist der Bildschirm eines per HDMI angeschlossenen Geraets zu sehen. Welche Spielkonsole bzw. welches System ist es? Achte auf Startbildschirm, Dashboard/Menue-Design, Logos, Knopf-Hinweise. Antworte mit GENAU EINEM Wort aus dieser Liste: switch, playstation, xbox, vystra, kamera, andere. Nimm \"vystra\" wenn \"Vystra Station\" zu sehen ist. Nimm \"kamera\" wenn es ein Webcam-Bild von einer Person oder einem Raum ist. Nur das eine Wort, sonst nichts.";
    try {
      const _0xkeRes = await fetchJson(_0xkeUrl + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: _0xkeS.llamaModel || "llama3.2-vision",
          prompt: _0xkePrompt,
          images: [_0xkeImg],
          stream: false
        })
      }, 60000);
      const _0xkeRaw = _0xkeRes && _0xkeRes.response ? String(_0xkeRes.response).toLowerCase() : "";
      if (!_0xkeRaw) {
        return { ok: false, error: "keine-antwort" };
      }
      // Erstes bekanntes Stichwort im Text gewinnt (das Modell haengt manchmal
      // Erklaerungen an). Reihenfolge egal - es kommt praktisch nur eins vor.
      const _0xkeTypen = ["playstation", "xbox", "switch", "vystra", "kamera", "andere"];
      let _0xkeTyp = null;
      for (const _0xt of _0xkeTypen) {
        if (_0xkeRaw.indexOf(_0xt) !== -1) { _0xkeTyp = _0xt; break; }
      }
      // Synonyme/Umschreibungen abfangen, falls das Modell den Listenbegriff verfehlt.
      if (!_0xkeTyp) {
        if (/ps5|ps4|playstation/.test(_0xkeRaw)) _0xkeTyp = "playstation";
        else if (/xbox|series x|series s/.test(_0xkeRaw)) _0xkeTyp = "xbox";
        else if (/switch|nintendo/.test(_0xkeRaw)) _0xkeTyp = "switch";
      }
      if (!_0xkeTyp) {
        return { ok: false, error: "unklar", raw: _0xkeRaw.slice(0, 120) };
      }
      return { ok: true, typ: _0xkeTyp, raw: _0xkeRaw.slice(0, 120) };
    } catch (_0xkeErr) {
      return { ok: false, error: _0xkeErr && _0xkeErr.message ? _0xkeErr.message : "netz" };
    }
  });
  ipcMain.handle("banner:flux", async (_0x3d423a, {
    prompt: _0x59433d,
    width: _0x26bef0,
    height: _0x437f9a
  }) => {
    const _0xd311ed = loadSettings();
    if (!_0xd311ed.fluxEnabled || !hardwareInfo.aiCapable) {
      return null;
    }
    const _0x964bc5 = (_0xd311ed.fluxUrl || "http://127.0.0.1:7860").replace(/\/$/, "");
    const _0x33569a = await fetchJson(_0x964bc5 + "/sdapi/v1/txt2img", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: _0x59433d,
        negative_prompt: "text, watermark, logo, letters, blurry, low quality",
        steps: 20,
        width: _0x26bef0 || 512,
        height: _0x437f9a || 288,
        cfg_scale: 3.5,
        sampler_name: "Euler"
      })
    }, 180000);
    if (_0x33569a && Array.isArray(_0x33569a.images) && _0x33569a.images[0]) {
      return "data:image/png;base64," + _0x33569a.images[0];
    }
    return null;
  });
  ipcMain.handle("manual:pick-folder", async () => {
    const _0x5ce82d = await dialog.showOpenDialog(mainWindow, {
      title: "Spiel-Ordner auswählen",
      properties: ["openDirectory"]
    });
    if (_0x5ce82d.canceled || !_0x5ce82d.filePaths[0]) {
      return {
        ok: false,
        canceled: true
      };
    }
    const _0x3f1ff1 = _0x5ce82d.filePaths[0];
    const _0x1830e7 = findGameExe(_0x3f1ff1);
    if (!_0x1830e7) {
      return {
        ok: false,
        error: "In diesem Ordner wurde keine startbare .exe gefunden."
      };
    }
    const _0x1346c5 = {
      platform: "manual",
      source: "folder",
      id: "fld-" + hashPath(_0x1830e7),
      title: path.basename(_0x3f1ff1),
      exePath: _0x1830e7,
      installPath: _0x3f1ff1,
      image: null
    };
    const _0x536a04 = loadManualStore();
    _0x536a04.games = (_0x536a04.games || []).filter(_0x2a99f1 => _0x2a99f1.id !== _0x1346c5.id);
    _0x536a04.games.push(_0x1346c5);
    _0x536a04.hidden = (_0x536a04.hidden || []).filter(_0x391ddc => _0x391ddc !== _0x1346c5.id);
    saveManualStore(_0x536a04);
    return {
      ok: true,
      game: _0x1346c5
    };
  });
  ipcMain.handle("manual:hide", async (_0x3dd11c, _0x42ce1e) => {
    const _0x25aaea = loadManualStore();
    _0x25aaea.hidden = [...new Set([...(_0x25aaea.hidden || []), _0x42ce1e])];
    _0x25aaea.games = (_0x25aaea.games || []).filter(_0x272aa7 => _0x272aa7.id !== _0x42ce1e);
    if (_0x25aaea.overrides) {
      delete _0x25aaea.overrides[_0x42ce1e];
    }
    deleteGameArt(_0x42ce1e);
    saveManualStore(_0x25aaea);
    return {
      ok: true
    };
  });
  ipcMain.handle("manual:set-meta", async (_0x209254, {
    id: _0x334f33,
    title: _0x1792c2,
    description: _0x2edf01,
    imageDataUrl: _0xa0f58,
    imageContain: _0x797e3f
  }) => {
    if (!_0x334f33) {
      return {
        ok: false,
        error: "Kein Spiel angegeben."
      };
    }
    const _0x15551e = loadManualStore();
    const _0x2aa8a5 = _0x15551e.overrides || {};
    const _0x95eb91 = {
      ...(_0x2aa8a5[_0x334f33] || {})
    };
    const _0x34f1d5 = String(_0x1792c2 == null ? "" : _0x1792c2).trim();
    if (_0x34f1d5) {
      _0x95eb91.title = _0x34f1d5;
    } else {
      delete _0x95eb91.title;
    }
    const _0x8ae19f = String(_0x2edf01 == null ? "" : _0x2edf01).trim();
    if (_0x8ae19f) {
      _0x95eb91.description = _0x8ae19f;
    } else {
      delete _0x95eb91.description;
    }
    if (_0xa0f58 === null) {
      deleteGameArt(_0x334f33);
      delete _0x95eb91.imageFile;
      delete _0x95eb91.imageMime;
    } else if (typeof _0xa0f58 === "string" && _0xa0f58.startsWith("data:")) {
      const _0x1eec32 = /^data:([^;,]+)[^,]*,([\s\S]*)$/.exec(_0xa0f58);
      if (!_0x1eec32) {
        return {
          ok: false,
          error: "Bild konnte nicht gelesen werden."
        };
      }
      try {
        fs.writeFileSync(gameArtFile(_0x334f33), Buffer.from(_0x1eec32[2], "base64"));
        _0x95eb91.imageFile = true;
        _0x95eb91.imageMime = _0x1eec32[1];
      } catch {
        return {
          ok: false,
          error: "Bild konnte nicht gespeichert werden."
        };
      }
    }
    if (_0x797e3f !== undefined) {
      _0x95eb91.imageContain = !!_0x797e3f;
    }
    if (Object.keys(_0x95eb91).length) {
      _0x2aa8a5[_0x334f33] = _0x95eb91;
    } else {
      delete _0x2aa8a5[_0x334f33];
    }
    _0x15551e.overrides = _0x2aa8a5;
    saveManualStore(_0x15551e);
    return {
      ok: true
    };
  });
  ipcMain.handle("manual:reset-meta", async (_0x1b9116, _0x129d24) => {
    const _0x504ae3 = loadManualStore();
    if (_0x504ae3.overrides) {
      delete _0x504ae3.overrides[_0x129d24];
    }
    deleteGameArt(_0x129d24);
    saveManualStore(_0x504ae3);
    return {
      ok: true
    };
  });
  ipcMain.handle("manual:pick-image", async () => {
    const _0x5db675 = await dialog.showOpenDialog(mainWindow, {
      title: "Bild auswählen",
      properties: ["openFile"],
      filters: [{
        name: "Bilder",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"]
      }]
    });
    if (_0x5db675.canceled || !_0x5db675.filePaths[0]) {
      return {
        ok: false,
        canceled: true
      };
    }
    const _0x45cb06 = _0x5db675.filePaths[0];
    try {
      if (fs.statSync(_0x45cb06).size > 8388608) {
        return {
          ok: false,
          error: "Bild ist zu groß (max. 8 MB)."
        };
      }
      const _0x461d6e = path.extname(_0x45cb06).slice(1).toLowerCase();
      const _0x452301 = _0x461d6e === "jpg" ? "jpeg" : _0x461d6e;
      return {
        ok: true,
        dataUrl: "data:image/" + _0x452301 + ";base64," + fs.readFileSync(_0x45cb06).toString("base64")
      };
    } catch {
      return {
        ok: false,
        error: "Bild konnte nicht gelesen werden."
      };
    }
  });
  // ── Chat: beliebige Dateien senden/speichern ──────────────────────────────
  // Eingebettet wird derzeit die komplette Datei in die Chat-Nachricht, darum
  // die harte Groessengrenze.
  const CHAT_FILE_MAX_BYTES = 2 * 1024 * 1024;
  // Grobe MIME-Tabelle nach Endung – reicht fuer Anzeige und Speichern.
  const CHAT_MIME_TABLE = {
    txt: "text/plain", md: "text/markdown", csv: "text/csv", log: "text/plain",
    json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html",
    css: "text/css", js: "text/javascript", py: "text/x-python",
    pdf: "application/pdf", rtf: "application/rtf",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
    tar: "application/x-tar", gz: "application/gzip",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime",
    exe: "application/octet-stream", dll: "application/octet-stream"
  };
  function chatMimeVonName(_0xcmName) {
    const _0xcmExt = String(_0xcmName || "").toLowerCase().split(".").pop();
    return Object.prototype.hasOwnProperty.call(CHAT_MIME_TABLE, _0xcmExt) ? CHAT_MIME_TABLE[_0xcmExt] : "application/octet-stream";
  }
  // Dateinamen entschaerfen: nur der Basename, keine Pfadtrenner, keine "..",
  // damit ein Absender nicht steuern kann, wo etwas landet.
  function chatSichererDateiname(_0xcsnRaw) {
    let _0xcsn = typeof _0xcsnRaw === "string" ? _0xcsnRaw : "";
    _0xcsn = _0xcsn.replace(/[\\/]+/g, "_");
    try { _0xcsn = path.basename(_0xcsn); } catch {}
    _0xcsn = _0xcsn.replace(/\.\./g, "_");
    _0xcsn = _0xcsn.replace(/[\u0000-\u001f<>:"|?*]+/g, "_");
    _0xcsn = _0xcsn.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
    if (_0xcsn.length > 120) {
      _0xcsn = _0xcsn.slice(0, 120);
    }
    return _0xcsn || "datei";
  }
  ipcMain.handle("chat:pick-file", async _0xcpEv => {
    if (!istEigenerRenderer(_0xcpEv)) {
      return {
        ok: false
      };
    }
    try {
      // Keine Filter: bewusst alle Dateitypen erlaubt.
      const _0xcpRes = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"]
      });
      if (_0xcpRes.canceled || !_0xcpRes.filePaths || !_0xcpRes.filePaths[0]) {
        return {
          ok: false,
          canceled: true
        };
      }
      const _0xcpPath = _0xcpRes.filePaths[0];
      const _0xcpStat = fs.statSync(_0xcpPath);
      if (!_0xcpStat.isFile()) {
        return {
          ok: false,
          error: "Das ist keine Datei."
        };
      }
      if (_0xcpStat.size > CHAT_FILE_MAX_BYTES) {
        return {
          ok: false,
          error: "Datei zu groß (max. 2 MB). Größere Dateien gehen noch nicht."
        };
      }
      const _0xcpName = chatSichererDateiname(path.basename(_0xcpPath));
      const _0xcpMime = chatMimeVonName(_0xcpName);
      const _0xcpBuf = fs.readFileSync(_0xcpPath);
      return {
        ok: true,
        name: _0xcpName,
        size: _0xcpStat.size,
        mime: _0xcpMime,
        dataUrl: "data:" + _0xcpMime + ";base64," + _0xcpBuf.toString("base64")
      };
    } catch (_0xcpErr) {
      return {
        ok: false,
        error: _0xcpErr && _0xcpErr.message ? _0xcpErr.message : String(_0xcpErr)
      };
    }
  });
  ipcMain.handle("chat:save-file", async (_0xcsEv, _0xcsArg) => {
    if (!istEigenerRenderer(_0xcsEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xcsName = chatSichererDateiname(_0xcsArg && _0xcsArg.name);
      const _0xcsUrl = _0xcsArg && typeof _0xcsArg.dataUrl === "string" ? _0xcsArg.dataUrl : "";
      if (!_0xcsUrl) {
        return {
          ok: false,
          error: "Keine Daten erhalten"
        };
      }
      const _0xcsB64At = _0xcsUrl.indexOf("base64,");
      let _0xcsBuf;
      if (_0xcsB64At >= 0) {
        _0xcsBuf = Buffer.from(_0xcsUrl.slice(_0xcsB64At + 7), "base64");
      } else {
        const _0xcsComma = _0xcsUrl.indexOf(",");
        _0xcsBuf = Buffer.from(decodeURIComponent(_0xcsUrl.slice(_0xcsComma + 1)), "utf8");
      }
      if (!_0xcsBuf || !_0xcsBuf.length) {
        return {
          ok: false,
          error: "Datei ist leer"
        };
      }
      const _0xcsRes = await dialog.showSaveDialog(mainWindow, {
        defaultPath: _0xcsName
      });
      if (_0xcsRes.canceled || !_0xcsRes.filePath) {
        return {
          ok: false,
          canceled: true
        };
      }
      fs.writeFileSync(_0xcsRes.filePath, _0xcsBuf);
      return {
        ok: true,
        path: _0xcsRes.filePath
      };
    } catch (_0xcsErr) {
      return {
        ok: false,
        error: _0xcsErr && _0xcsErr.message ? _0xcsErr.message : String(_0xcsErr)
      };
    }
  });
  // ── Hintergrund/Wallpaper-Feature ─────────────────────────────────────────
  ipcMain.handle("bg:pick-image", async _0xbgEv => {
    if (!istEigenerRenderer(_0xbgEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xbgRes = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        filters: [{
          name: "Bilder",
          extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"]
        }]
      });
      if (_0xbgRes.canceled || !_0xbgRes.filePaths || !_0xbgRes.filePaths[0]) {
        return {
          ok: false
        };
      }
      const _0xbgPath = _0xbgRes.filePaths[0];
      const _0xbgExt = path.extname(_0xbgPath).slice(1).toLowerCase();
      const _0xbgMime = _0xbgExt === "jpg" ? "jpeg" : _0xbgExt === "svg" ? "svg+xml" : _0xbgExt;
      const _0xbgData = fs.readFileSync(_0xbgPath);
      // Große Bilder werden trotzdem zurückgegeben — der Renderer skaliert selbst.
      const _0xbgUrl = "data:image/" + _0xbgMime + ";base64," + _0xbgData.toString("base64");
      return {
        ok: true,
        dataUrl: _0xbgUrl
      };
    } catch (_0xbgErr) {
      return {
        ok: false,
        error: _0xbgErr && _0xbgErr.message ? _0xbgErr.message : String(_0xbgErr)
      };
    }
  });
  ipcMain.handle("bg:set-wallpaper", (_0xwpEv, _0xwpPngDataUrl) => {
    try {
      if (process.platform !== "win32") {
        return {
          ok: false,
          error: "Nur unter Windows verfügbar"
        };
      }
      if (typeof _0xwpPngDataUrl !== "string" || !_0xwpPngDataUrl) {
        return {
          ok: false,
          error: "Kein Bild übergeben"
        };
      }
      const _0xwpB64 = _0xwpPngDataUrl.replace(/^data:image\/[^;]+;base64,/, "");
      const _0xwpBuf = Buffer.from(_0xwpB64, "base64");
      if (!_0xwpBuf.length) {
        return {
          ok: false,
          error: "Leeres Bild erhalten"
        };
      }
      // Jedes Mal eine neue Datei: Windows haelt die aktive Hintergrund-Datei
      // gelegentlich offen, ein Ueberschreiben schlaegt dann fehl. Alte Dateien
      // raeumen wir danach best effort weg.
      const _0xwpDir = app.getPath("userData");
      const _0xwpPath = path.join(_0xwpDir, "vystra-wallpaper-" + Date.now().toString(36) + ".png");
      fs.writeFileSync(_0xwpPath, _0xwpBuf);
      try {
        for (const _0xalt of fs.readdirSync(_0xwpDir)) {
          if (/^vystra-wallpaper(-[a-z0-9]+)?\.png$/i.test(_0xalt) && path.join(_0xwpDir, _0xalt) !== _0xwpPath) {
            try {
              fs.unlinkSync(path.join(_0xwpDir, _0xalt));
            } catch {}
          }
        }
      } catch {}
      const _0xwpEsc = _0xwpPath.replace(/'/g, "''");
      // Fuellend statt gestreckt (10 = Fill) + kein Kacheln, sonst wirkt das Bild verzerrt.
      const _0xwpCmd = "Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '10' -ErrorAction SilentlyContinue; " + "Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0' -ErrorAction SilentlyContinue; " + "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Wp { [DllImport(\"user32.dll\", CharSet=CharSet.Auto)] public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni); }'; " + "$r = [Wp]::SystemParametersInfo(20,0,'" + _0xwpEsc + "',3); if ($r -ne 1) { Write-Error 'SystemParametersInfo fehlgeschlagen' }";
      return new Promise(_0xwpResolve => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", _0xwpCmd], {
          windowsHide: true
        }, _0xwpCbErr => {
          if (_0xwpCbErr) {
            _0xwpResolve({
              ok: false,
              error: _0xwpCbErr && _0xwpCbErr.message ? _0xwpCbErr.message : String(_0xwpCbErr)
            });
          } else {
            _0xwpResolve({
              ok: true,
              path: _0xwpPath
            });
          }
        });
      });
    } catch (_0xwpErr) {
      return {
        ok: false,
        error: _0xwpErr && _0xwpErr.message ? _0xwpErr.message : String(_0xwpErr)
      };
    }
  });
  ipcMain.handle("bg:export-file", async (_0xexEv, _0xexArg) => {
    if (!istEigenerRenderer(_0xexEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xexName = _0xexArg && typeof _0xexArg.filename === "string" && _0xexArg.filename ? _0xexArg.filename : "hintergrund";
      const _0xexContent = _0xexArg && typeof _0xexArg.content === "string" ? _0xexArg.content : "";
      if (!_0xexContent) {
        return {
          ok: false,
          error: "Kein Inhalt"
        };
      }
      const _0xexSafe = _0xexName.replace(/[^A-Za-z0-9_\- ]+/g, "_").trim().slice(0, 60) || "hintergrund";
      const _0xexRes = await dialog.showSaveDialog(mainWindow, {
        defaultPath: _0xexSafe + ".vybg",
        filters: [{
          name: "Vystra Hintergrund",
          extensions: ["vybg"]
        }]
      });
      if (_0xexRes.canceled || !_0xexRes.filePath) {
        return {
          ok: false,
          canceled: true
        };
      }
      fs.writeFileSync(_0xexRes.filePath, _0xexContent, "utf8");
      return {
        ok: true,
        path: _0xexRes.filePath
      };
    } catch (_0xexErr) {
      return {
        ok: false,
        error: _0xexErr && _0xexErr.message ? _0xexErr.message : String(_0xexErr)
      };
    }
  });
  // ── Launcher verknuepfen ───────────────────────────────────────────────────
  // Liefert eine Task-Manager-artige Liste laufender Programme. Nur oeffentliche
  // Windows-Metadaten: Prozessname, PID, Pfad, eingebettetes Icon. Keine
  // Injektion, kein Auslesen fremder APIs.
  ipcMain.handle("launcher:prozesse", async _0xlpEv => {
    if (!istEigenerRenderer(_0xlpEv)) {
      return {
        ok: false
      };
    }
    if (!IS_WIN) {
      return {
        ok: false,
        fehler: "Nur unter Windows verfuegbar"
      };
    }
    try {
      // ConvertTo-Json liefert bei genau einem Treffer ein Objekt statt eines
      // Arrays - psJson() glaettet das bereits auf ein Array.
      const _0xlpRoh = await psJson("Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ExecutablePath | ConvertTo-Json -Compress", 8000);
      // Kleine Sperrliste offensichtlicher Hintergrunddienste. Bewusst knapp
      // gehalten: die Liste soll grob filtern, nicht kuratieren - der grobe
      // C:\Windows-Filter unten faengt den grossen Rest.
      const _0xlpSperre = new Set(["svchost.exe", "runtimebroker.exe", "dllhost.exe", "conhost.exe", "searchhost.exe", "textinputhost.exe", "sihost.exe", "taskhostw.exe", "ctfmon.exe", "fontdrvhost.exe", "smartscreen.exe", "wmiprvse.exe", "audiodg.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe", "spoolsv.exe", "explorer.exe", "backgroundtaskhost.exe", "applicationframehost.exe", "shellexperiencehost.exe", "startmenuexperiencehost.exe", "systemsettings.exe", "widgets.exe", "widgetservice.exe", "securityhealthsystray.exe"]);
      const _0xlpGesehen = new Set();
      const _0xlpListe = [];
      for (const _0xlpP of _0xlpRoh) {
        const _0xlpPfad = _0xlpP && _0xlpP.ExecutablePath ? String(_0xlpP.ExecutablePath) : "";
        if (!_0xlpPfad) {
          continue;
        }
        const _0xlpKlein = _0xlpPfad.toLowerCase();
        // System raus: alles unter C:\Windows.
        if (/[\\/]windows[\\/]/i.test(_0xlpKlein)) {
          continue;
        }
        const _0xlpBasis = path.basename(_0xlpKlein);
        if (_0xlpSperre.has(_0xlpBasis)) {
          continue;
        }
        // Nach Pfad entdoppeln: ein Programm laeuft oft in vielen Prozessen.
        if (_0xlpGesehen.has(_0xlpKlein)) {
          continue;
        }
        _0xlpGesehen.add(_0xlpKlein);
        _0xlpListe.push({
          name: _0xlpP.Name ? String(_0xlpP.Name).replace(/\.exe$/i, "") : path.basename(_0xlpPfad, path.extname(_0xlpPfad)),
          pid: _0xlpP.ProcessId || 0,
          exePath: _0xlpPfad
        });
      }
      // Icon je Eintrag holen. getFileIcon ist async und kann fehlschlagen -
      // dann eben icon: null, statt den ganzen Aufruf scheitern zu lassen.
      for (const _0xlpE of _0xlpListe) {
        try {
          const _0xlpIcon = await app.getFileIcon(_0xlpE.exePath, {
            size: "normal"
          });
          _0xlpE.icon = _0xlpIcon && !_0xlpIcon.isEmpty() ? _0xlpIcon.toDataURL() : null;
        } catch {
          _0xlpE.icon = null;
        }
      }
      _0xlpListe.sort((_0xa, _0xb) => _0xa.name.localeCompare(_0xb.name, "de", {
        sensitivity: "base"
      }));
      return {
        ok: true,
        prozesse: _0xlpListe
      };
    } catch (_0xlpErr) {
      return {
        ok: false,
        fehler: _0xlpErr && _0xlpErr.message ? _0xlpErr.message : String(_0xlpErr)
      };
    }
  });
  // Untersucht eine .exe: Versionsinfo (offen in jeder Windows-.exe hinterlegt),
  // eingebettetes Logo und den umgebenden Ordner. Faellt ein Urteil, ob es sich
  // um einen Launcher, ein Spiel oder etwas Unklares handelt.
  ipcMain.handle("launcher:analyse", async (_0xlaEv, _0xlaArg) => {
    if (!istEigenerRenderer(_0xlaEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xlaPfad = _0xlaArg && typeof _0xlaArg.exePath === "string" ? _0xlaArg.exePath : "";
      if (!_0xlaPfad || !fs.existsSync(_0xlaPfad)) {
        return {
          ok: false,
          fehler: "Datei nicht gefunden"
        };
      }
      const _0xlaDateiName = path.basename(_0xlaPfad).replace(/\.exe$/i, "");
      // Versionsinfo per PowerShell. Nur unter Windows verfuegbar - sonst bleibt
      // es beim Dateinamen. Single-Quote im Pfad fuer PowerShell verdoppeln.
      let _0xlaVi = {};
      if (IS_WIN) {
        const _0xlaEsc = _0xlaPfad.replace(/'/g, "''");
        const _0xlaViRoh = await psJson("(Get-Item -LiteralPath '" + _0xlaEsc + "').VersionInfo | Select-Object ProductName,FileDescription,CompanyName,ProductVersion,FileVersion | ConvertTo-Json -Compress", 8000);
        _0xlaVi = _0xlaViRoh[0] || {};
      }
      const _0xlaName = [_0xlaVi.ProductName, _0xlaVi.FileDescription, _0xlaDateiName].map(_0xv => _0xv ? String(_0xv).trim() : "").find(_0xv => _0xv) || _0xlaDateiName;
      const _0xlaVersion = [_0xlaVi.ProductVersion, _0xlaVi.FileVersion].map(_0xv => _0xv ? String(_0xv).trim() : "").find(_0xv => _0xv) || "";
      // Logo aus der .exe (grosses Icon). iconDataUrl faengt Fehler selbst ab.
      const _0xlaLogo = await iconDataUrl(_0xlaPfad);
      const _0xlaOrdner = path.dirname(_0xlaPfad);
      const _0xlaScan = launcherOrdnerScan(_0xlaOrdner);
      // Urteil: die Seite mit mehr Punkten gewinnt, bei Gleichstand oder ganz
      // ohne Signaturen bleibt es "unklar".
      let _0xlaTyp = "unklar";
      if (_0xlaScan.launcherPunkte > _0xlaScan.spielPunkte && _0xlaScan.launcherPunkte > 0) {
        _0xlaTyp = "launcher";
      } else if (_0xlaScan.spielPunkte > _0xlaScan.launcherPunkte && _0xlaScan.spielPunkte > 0) {
        _0xlaTyp = "spiel";
      }
      return {
        ok: true,
        name: _0xlaName,
        logo: _0xlaLogo,
        version: _0xlaVersion,
        ordner: _0xlaOrdner,
        typ: _0xlaTyp,
        details: {
          unterordner: _0xlaScan.unterordner,
          exeAnzahl: _0xlaScan.exeAnzahl,
          gefunden: _0xlaScan.gefunden
        }
      };
    } catch (_0xlaErr) {
      return {
        ok: false,
        fehler: _0xlaErr && _0xlaErr.message ? _0xlaErr.message : String(_0xlaErr)
      };
    }
  });
  // Startet die .exe eines verknuepften Launchers. Analog zum manual-Zweig in
  // game:launch: Pfad pruefen, dann detached spawnen (im eigenen Ordner, damit
  // ein Launcher seine relativen Dateien findet). Keine Argumente durchreichen,
  // damit sich hierueber nichts einschleusen laesst.
  ipcMain.handle("launcher:starten", async (_0xlsEv, _0xlsArg) => {
    if (!istEigenerRenderer(_0xlsEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xlsPfad = _0xlsArg && typeof _0xlsArg.exePath === "string" ? _0xlsArg.exePath : "";
      if (!_0xlsPfad || !/\.exe$/i.test(_0xlsPfad) || !fs.existsSync(_0xlsPfad)) {
        return {
          ok: false,
          fehler: "Datei nicht gefunden - wurde der Launcher verschoben?"
        };
      }
      const _0xlsCwd = path.dirname(_0xlsPfad);
      spawn(_0xlsPfad, [], {
        detached: true,
        stdio: "ignore",
        cwd: _0xlsCwd
      }).unref();
      return {
        ok: true
      };
    } catch (_0xlsErr) {
      return {
        ok: false,
        fehler: _0xlsErr && _0xlsErr.message ? _0xlsErr.message : String(_0xlsErr)
      };
    }
  });
  // Oeffnet im fremden Launcher zuerst die Bibliothek-Ansicht (UI-Automation:
  // sucht Knopf/Tab "Bibliothek" / "My Library" / aehnlich und klickt ihn).
  // Danach kann der Ordner-Scan sinnvoller laufen. Kein OCR – nur Windows UIA.
  ipcMain.handle("launcher:oeffneBibliothek", async (_0xlobEv, _0xlobArg) => {
    if (!istEigenerRenderer(_0xlobEv)) {
      return {
        ok: false
      };
    }
    if (!IS_WIN) {
      return {
        ok: false,
        fehler: "nur Windows"
      };
    }
    try {
      const _0xlobPfad = _0xlobArg && typeof _0xlobArg.exePath === "string" ? _0xlobArg.exePath : "";
      if (!_0xlobPfad || !/\.exe$/i.test(_0xlobPfad) || !fs.existsSync(_0xlobPfad)) {
        return {
          ok: false,
          fehler: "Datei nicht gefunden"
        };
      }
      const _0xlobScript = path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, "app.asar.unpacked"), "tools", "finde-bibliothek.ps1");
      if (!fs.existsSync(_0xlobScript)) {
        return {
          ok: false,
          fehler: "finde-bibliothek.ps1 fehlt"
        };
      }
      const _0xlobEsc = _0xlobPfad.replace(/'/g, "''");
      const _0xlobScriptEsc = _0xlobScript.replace(/'/g, "''");
      const _0xlobCmd = "& '" + _0xlobScriptEsc + "' -ExePath '" + _0xlobEsc + "' -TimeoutSec 28";
      const _0xlobRows = await psJson(_0xlobCmd, 45000);
      const _0xlobRes = _0xlobRows && _0xlobRows[0] ? _0xlobRows[0] : null;
      if (!_0xlobRes) {
        return {
          ok: false,
          fehler: "keine Antwort vom UI-Scan"
        };
      }
      return _0xlobRes;
    } catch (_0xlobErr) {
      return {
        ok: false,
        fehler: _0xlobErr && _0xlobErr.message ? _0xlobErr.message : String(_0xlobErr)
      };
    }
  });
  // Scannt die Bibliotheks-/Installationsordner eines verknuepften Launchers nach
  // installierten Spielen. Bekommt den kompletten vl-Eintrag (name/ordner/bibliotheken),
  // damit vlKandidatenOrdner die richtigen Orte findet - der Launcher-.exe-Ordner
  // allein reicht bei den meisten Launchern nicht.
  ipcMain.handle("launcher:spieleScannen", async (_0xlssEv, _0xlssArg) => {
    if (!istEigenerRenderer(_0xlssEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xlssVl = _0xlssArg && typeof _0xlssArg === "object" ? _0xlssArg : {};
      const _0xlssOrdner = vlKandidatenOrdner(_0xlssVl);
      // 1) Launcher oeffnen, Bibliothek-Knopf suchen/klicken, Raster drueberlegen.
      let _0xlssUiTitel = [];
      let _0xlssUi = null;
      const _0xlssExe = typeof _0xlssVl.exePath === "string" ? _0xlssVl.exePath : "";
      if (IS_WIN && _0xlssExe && fs.existsSync(_0xlssExe)) {
        try {
          const _0xlssScript = path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, "app.asar.unpacked"), "tools", "finde-bibliothek.ps1");
          if (fs.existsSync(_0xlssScript)) {
            const _0xlssCmd = "& '" + _0xlssScript.replace(/'/g, "''") + "' -ExePath '" + _0xlssExe.replace(/'/g, "''") + "' -TimeoutSec 28";
            const _0xlssRows = await psJson(_0xlssCmd, 70000);
            _0xlssUi = _0xlssRows && _0xlssRows[0] ? _0xlssRows[0] : null;
            if (_0xlssUi && Array.isArray(_0xlssUi.titel)) {
              _0xlssUiTitel = _0xlssUi.titel.map(_0xt => String(_0xt || "").trim()).filter(_0xt => _0xt.length > 1);
            }
          }
        } catch {}
      }
      // 2) Ordner-Scan (konfigurierte + bekannte Orte).
      let _0xlssSpiele = vlSpieleScan(_0xlssOrdner);
      // Voll-Scan ALLER Platten nur auf Wunsch (tief=true): teuer, laeuft im
      // Hintergrund mit Fortschritt. Ergebnisse werden dazugemischt (dedupe).
      if (_0xlssVl.tief) {
        const _0xlssId = _0xlssVl.id || "";
        const _0xlssTief = await launcherScan.spieleTiefenScan({
          extraRoots: _0xlssOrdner,
          onProgress: _0xp => {
            try {
              if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send("launcher:vlScanProgress", {
                  id: _0xlssId,
                  checked: _0xp.checked,
                  hits: _0xp.hits,
                  currentPath: _0xp.currentPath
                });
              }
            } catch {}
          }
        });
        const _0xseen = new Set(_0xlssSpiele.map(_0xs => String(_0xs.exePath).toLowerCase()));
        for (const _0xs of _0xlssTief.spiele || []) {
          const _0xk = String(_0xs.exePath).toLowerCase();
          if (!_0xseen.has(_0xk)) {
            _0xseen.add(_0xk);
            _0xlssSpiele.push(_0xs);
          }
        }
        _0xlssSpiele.sort((_0xa, _0xb) => String(_0xa.name).localeCompare(String(_0xb.name), "de"));
      }
      // UI-Titel wie bei Epic eintragen: fehlt der Ordner-Treffer, bleibt der
      // Name trotzdem in der Bibliothek (owned, ohne exe).
      const _0xlssNamen = new Set(_0xlssSpiele.map(_0xs => String(_0xs.name || "").toLowerCase()));
      for (const _0xt of _0xlssUiTitel) {
        const _0xk = _0xt.toLowerCase();
        if (_0xlssNamen.has(_0xk)) {
          continue;
        }
        _0xlssNamen.add(_0xk);
        _0xlssSpiele.push({
          id: "vlui-" + _0xk.replace(/[^\w]+/g, "-").slice(0, 48),
          name: _0xt,
          exePath: null,
          fromUi: true
        });
      }
      _0xlssSpiele.sort((_0xa, _0xb) => String(_0xa.name).localeCompare(String(_0xb.name), "de"));
      // Lokal speichern wie EpicScanner → Launcher liest ohne API erneut.
      try {
        const _0xlssId = String(_0xlssVl.id || "vl").replace(/[^\w.-]+/g, "_");
        const _0xlssZiel = path.join(app.getPath("userData"), "vl-" + _0xlssId + "-bibliothek.json");
        const _0xlssGames = (_0xlssSpiele || []).map(_0xs => ({
          platform: "vlauncher",
          id: _0xs.id || _0xs.exePath || _0xs.name,
          title: _0xs.name || _0xs.title || "",
          image: _0xs.image || null,
          installPath: _0xs.installPath || path.dirname(_0xs.exePath || "") || null,
          exePath: _0xs.exePath || null,
          owned: true,
          fromVlScan: true,
          launcherId: _0xlssVl.id || null
        }));
        fs.writeFileSync(_0xlssZiel, JSON.stringify({
          ok: true,
          source: "vl-scan",
          launcherId: _0xlssVl.id || null,
          launcherName: _0xlssVl.name || "",
          count: _0xlssGames.length,
          games: _0xlssGames
        }, null, 1), "utf8");
      } catch {}
      return {
        ok: true,
        spiele: _0xlssSpiele,
        // Welche Ordner tatsaechlich existierten - fuer eine ehrliche Anzeige
        // ("nichts gefunden" vs. "Ordner existiert gar nicht").
        ui: _0xlssUi ? {
          gefunden: !!_0xlssUi.gefunden,
          geklickt: !!_0xlssUi.geklickt,
          label: _0xlssUi.label || "",
          titel: _0xlssUiTitel.length
        } : null,
        geprueft: _0xlssOrdner.filter(_0xo => {
          try {
            return fs.existsSync(_0xo);
          } catch {
            return false;
          }
        })
      };
    } catch (_0xlssErr) {
      return {
        ok: false,
        fehler: _0xlssErr && _0xlssErr.message ? _0xlssErr.message : String(_0xlssErr)
      };
    }
  });
  ipcMain.handle("launcher:freundeScannen", async (_0xlfEv, _0xlfArg) => {
    if (!istEigenerRenderer(_0xlfEv)) {
      return { ok: false };
    }
    try {
      const _0xlf = _0xlfArg && typeof _0xlfArg === "object" ? _0xlfArg : {};
      const _0xres = await launcherFreundeUiScan(_0xlf);
      if (_0xres && _0xres.ok) {
        launcherFreundeSpeichern(_0xlf.platform || "launcher", _0xres);
        launcherFreundeAufKonto(_0xlf.platform || "", _0xres);
      }
      return _0xres;
    } catch (_0xe) {
      return { ok: false, fehler: _0xe && _0xe.message ? _0xe.message : String(_0xe) };
    }
  });
  ipcMain.handle("launcher:freundeCache", _0xlfcEv => {
    if (!istEigenerRenderer(_0xlfcEv)) {
      return { ok: false, launchers: [] };
    }
    return { ok: true, launchers: launcherFreundeCacheLesen() };
  });
  ipcMain.handle("launcher:freundeSync", async _0xlfsEv => {
    if (!istEigenerRenderer(_0xlfsEv)) {
      return { ok: false };
    }
    const _0xliste = [];
    try {
      const _0xsteam = await findSteamPath();
      const _0xsteamExe = _0xsteam ? path.join(_0xsteam, "steam.exe") : "";
      if (_0xsteamExe && fs.existsSync(_0xsteamExe)) {
        launcherFreundeFortschritt("Steam: Profil, ID und Freunde …", "steam");
        const _0xr = await launcherFreundeUiScan({ exePath: _0xsteamExe, platform: "steam" });
        _0xr.platform = "steam";
        if (_0xr.ok) {
          launcherFreundeSpeichern("steam", _0xr);
          launcherFreundeAufKonto("steam", _0xr);
        }
        _0xliste.push(_0xr);
      }
      const _0xepic = await findEpicLauncherExe();
      if (_0xepic) {
        launcherFreundeFortschritt("Epic: Profil, ID und Freunde …", "epic");
        const _0xr = await launcherFreundeUiScan({ exePath: _0xepic, platform: "epic" });
        _0xr.platform = "epic";
        if (_0xr.ok) {
          launcherFreundeSpeichern("epic", _0xr);
          launcherFreundeAufKonto("epic", _0xr);
        }
        _0xliste.push(_0xr);
      }
      const _0xset = loadSettings();
      if (_0xset.connectXbox) {
        launcherFreundeFortschritt("Xbox: Profil, ID und Freunde …", "xbox");
        const _0xr = await launcherFreundeUiScan({ processName: "XboxPcApp", platform: "xbox" });
        _0xr.platform = "xbox";
        if (_0xr.ok) {
          launcherFreundeSpeichern("xbox", _0xr);
        }
        _0xliste.push(_0xr);
      }
      const _0xvl = Array.isArray(_0xset.verknuepfteLauncher) ? _0xset.verknuepfteLauncher : [];
      for (const _0xe of _0xvl) {
        if (!_0xe || !_0xe.exePath || !fs.existsSync(_0xe.exePath)) {
          continue;
        }
        launcherFreundeFortschritt((_0xe.name || "Launcher") + ": Profil, ID und Freunde …", "vlauncher");
        const _0xr = await launcherFreundeUiScan({ exePath: _0xe.exePath, platform: "vlauncher" });
        _0xr.platform = "vlauncher";
        _0xr.launcherId = _0xe.id || "";
        if (_0xr.ok) {
          launcherFreundeSpeichern("vl-" + (_0xe.id || "x"), _0xr);
        }
        _0xliste.push(_0xr);
      }
      launcherFreundeFortschritt("Fertig", "");
      return { ok: true, launchers: _0xliste };
    } catch (_0xe) {
      return { ok: false, fehler: _0xe && _0xe.message ? _0xe.message : String(_0xe), launchers: _0xliste };
    }
  });
  // GeForce-NOW-Liste an den Renderer geben (oeffentliche Metadaten, gecacht).
  ipcMain.handle("gfn:liste", async _0xgfnEv => {
    if (!istEigenerRenderer(_0xgfnEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xs = await gfnListeHolen();
      return {
        ok: true,
        spiele: Array.isArray(_0xs) ? _0xs : []
      };
    } catch (_0xgfnErr) {
      return {
        ok: false,
        spiele: [],
        fehler: _0xgfnErr && _0xgfnErr.message ? _0xgfnErr.message : String(_0xgfnErr)
      };
    }
  });
  // Ordner-Auswahl fuer die Bibliothek eines verknuepften Launchers (der Nutzer
  // zeigt, wo seine Spiele liegen). Gibt nur den Pfad zurueck - gespeichert wird
  // im Renderer in den vl-Eintrag (bibliotheken).
  ipcMain.handle("launcher:ordnerWaehlen", async _0xlowEv => {
    if (!istEigenerRenderer(_0xlowEv)) {
      return {
        ok: false
      };
    }
    const _0xlowRes = await dialog.showOpenDialog(mainWindow, {
      title: "Bibliothek-Ordner des Launchers auswählen",
      properties: ["openDirectory"]
    });
    if (_0xlowRes.canceled || !_0xlowRes.filePaths[0]) {
      return {
        ok: false,
        canceled: true
      };
    }
    return {
      ok: true,
      ordner: _0xlowRes.filePaths[0]
    };
  });
  // ── Teilbare Bibliotheks-Karte ─────────────────────────────────────────────
  // Die Karte entsteht im Renderer auf einem <canvas> und kommt als dataURL
  // herueber. Datei schreiben und Zwischenablage gehen nur im Hauptprozess,
  // deshalb diese beiden Handler.
  function karteBildAusDataUrl(_0xkdUrl) {
    // Streng auf PNG-dataURL pruefen: sonst liesse sich ueber diesen Weg
    // beliebiger Inhalt in die Zwischenablage oder auf die Platte schieben.
    if (typeof _0xkdUrl !== "string" || !/^data:image\/png;base64,/i.test(_0xkdUrl)) {
      return null;
    }
    const _0xkdImg = nativeImage.createFromDataURL(_0xkdUrl);
    return _0xkdImg && !_0xkdImg.isEmpty() ? _0xkdImg : null;
  }
  ipcMain.handle("karte:speichern", async (_0xkspEv, _0xkspArg) => {
    if (!istEigenerRenderer(_0xkspEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xkspImg = karteBildAusDataUrl(_0xkspArg && _0xkspArg.dataUrl);
      if (!_0xkspImg) {
        return {
          ok: false,
          error: "Kein gueltiges Bild"
        };
      }
      const _0xkspName = _0xkspArg && typeof _0xkspArg.filename === "string" && _0xkspArg.filename ? _0xkspArg.filename : "vystra-bibliothek";
      const _0xkspSafe = _0xkspName.replace(/[^A-Za-z0-9_\- ]+/g, "_").trim().slice(0, 60) || "vystra-bibliothek";
      const _0xkspRes = await dialog.showSaveDialog(mainWindow, {
        defaultPath: _0xkspSafe + ".png",
        filters: [{
          name: "PNG-Bild",
          extensions: ["png"]
        }]
      });
      if (_0xkspRes.canceled || !_0xkspRes.filePath) {
        return {
          ok: false,
          canceled: true
        };
      }
      fs.writeFileSync(_0xkspRes.filePath, _0xkspImg.toPNG());
      return {
        ok: true,
        path: _0xkspRes.filePath
      };
    } catch (_0xkspErr) {
      return {
        ok: false,
        error: _0xkspErr && _0xkspErr.message ? _0xkspErr.message : String(_0xkspErr)
      };
    }
  });
  ipcMain.handle("karte:kopieren", async (_0xkkoEv, _0xkkoArg) => {
    if (!istEigenerRenderer(_0xkkoEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xkkoImg = karteBildAusDataUrl(_0xkkoArg && _0xkkoArg.dataUrl);
      if (!_0xkkoImg) {
        return {
          ok: false,
          error: "Kein gueltiges Bild"
        };
      }
      // Als Bild (nicht als Text) in die Zwischenablage - nur so laesst es sich
      // direkt in Discord oder WhatsApp einfuegen, und genau so wird es geteilt.
      clipboard.writeImage(_0xkkoImg);
      return {
        ok: true
      };
    } catch (_0xkkoErr) {
      return {
        ok: false,
        error: _0xkkoErr && _0xkkoErr.message ? _0xkkoErr.message : String(_0xkkoErr)
      };
    }
  });
  ipcMain.handle("bg:import-file", async _0ximEv => {
    if (!istEigenerRenderer(_0ximEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0ximRes = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        filters: [{
          name: "Vystra Hintergrund",
          extensions: ["vybg", "json"]
        }]
      });
      if (_0ximRes.canceled || !_0ximRes.filePaths || !_0ximRes.filePaths[0]) {
        return {
          ok: false,
          canceled: true
        };
      }
      const _0ximPath = _0ximRes.filePaths[0];
      const _0ximStat = fs.statSync(_0ximPath);
      if (_0ximStat.size > 40 * 1024 * 1024) {
        return {
          ok: false,
          error: "Datei zu groß (max. 40 MB)"
        };
      }
      const _0ximTxt = fs.readFileSync(_0ximPath, "utf8");
      return {
        ok: true,
        content: _0ximTxt,
        filename: path.basename(_0ximPath)
      };
    } catch (_0ximErr) {
      return {
        ok: false,
        error: _0ximErr && _0ximErr.message ? _0ximErr.message : String(_0ximErr)
      };
    }
  });
  // ---- Vystra Musik-Player starten -------------------------------------
  // Suchreihenfolge steckt in findMusicPlayerExe() (auch von music:status genutzt).
  ipcMain.handle("music:open", async _0xmuEv => {
    if (!istEigenerRenderer(_0xmuEv)) {
      return {
        ok: false
      };
    }
    const _0xexe = findMusicPlayerExe();
    if (!_0xexe) {
      return {
        ok: false,
        needInstall: true,
        needPick: true,
        error: "Vystra Player wurde nicht gefunden."
      };
    }
    try {
      const _0xchild = spawn(_0xexe, [], {
        detached: true,
        stdio: "ignore",
        cwd: path.dirname(_0xexe)
      });
      _0xchild.unref();
      return {
        ok: true,
        path: _0xexe
      };
    } catch (_0xmuErr) {
      return {
        ok: false,
        error: _0xmuErr && _0xmuErr.message ? _0xmuErr.message : String(_0xmuErr)
      };
    }
  });
  // Pfad zur Player-exe selbst auswaehlen (falls die Suche nichts findet)
  ipcMain.handle("music:pick", async _0xmpEv => {
    if (!istEigenerRenderer(_0xmpEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xres = await dialog.showOpenDialog(mainWindow, {
        title: "Vystra Player auswählen",
        properties: ["openFile"],
        filters: [{
          name: "Programm",
          extensions: ["exe"]
        }]
      });
      if (_0xres.canceled || !_0xres.filePaths || !_0xres.filePaths[0]) {
        return {
          ok: false,
          canceled: true
        };
      }
      const _0xsel = _0xres.filePaths[0];
      const _0xcfg = loadSettings();
      _0xcfg.musicPlayerPath = _0xsel;
      saveSettings(_0xcfg);
      return {
        ok: true,
        path: _0xsel
      };
    } catch (_0xmpErr) {
      return {
        ok: false,
        error: _0xmpErr && _0xmpErr.message ? _0xmpErr.message : String(_0xmpErr)
      };
    }
  });
  // Ist der Musik-Player schon da? (für die Sync-Karte beim Start)
  ipcMain.handle("music:status", async _0xmsEv => {
    if (!istEigenerRenderer(_0xmsEv)) {
      return {
        installed: false,
        exe: null
      };
    }
    try {
      const _0xexe = findMusicPlayerExe();
      const _0xcfg = loadSettings();
      const _0xver = musicVersionFromUrl(_0xcfg.musicPlayerInstalledUrl || "");
      return {
        installed: !!_0xexe,
        exe: _0xexe || null,
        auto: !!(_0xexe && _0xexe.indexOf(musicInstallDir()) === 0),
        ...(_0xver ? {
          version: _0xver
        } : {})
      };
    } catch (_0xmsErr) {
      return {
        installed: false,
        exe: null,
        error: _0xmsErr && _0xmsErr.message ? _0xmsErr.message : String(_0xmsErr)
      };
    }
  });
  // Musik-Player automatisch mitinstallieren (ZIP laden + entpacken).
  ipcMain.handle("music:install", async _0xmiEv => {
    if (!istEigenerRenderer(_0xmiEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    // Schon vorhanden? Dann nichts laden.
    try {
      const _0xda = findMusicPlayerExe();
      if (_0xda) {
        musicSendProgress({
          phase: "fertig",
          pct: 100,
          done: 0,
          total: 0
        });
        return {
          ok: true,
          exe: _0xda,
          already: true
        };
      }
    } catch {}
    // Nie zwei Installationen gleichzeitig.
    if (musicInstallLauft) {
      try {
        return await musicInstallLauft;
      } catch (_0xwErr) {
        return {
          ok: false,
          error: _0xwErr && _0xwErr.message ? _0xwErr.message : String(_0xwErr)
        };
      }
    }
    musicInstallLauft = installMusicPlayer().catch(_0xiErr => ({
      ok: false,
      error: _0xiErr && _0xiErr.message ? _0xiErr.message : String(_0xiErr)
    }));
    try {
      return await musicInstallLauft;
    } finally {
      musicInstallLauft = null;
    }
  });
  // ── Mini-Musik-Player: lokalen Ordner nach Audiodateien scannen ────────────
  const MUSIC_AUDIO_EXTS = [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"];
  function scanMusicFolder(_0xfolder) {
    const _0xout = [];
    if (!_0xfolder || typeof _0xfolder !== "string") {
      return _0xout;
    }
    // Bis zu 2 Ebenen tief (Ordner + eine Unterebene), damit typische
    // "Musik/Album/*.mp3"-Strukturen abgedeckt sind, ohne die ganze Platte zu scannen.
    function _0xscan(_0xdir, _0xdepth) {
      let _0xentries;
      try {
        _0xentries = fs.readdirSync(_0xdir, {
          withFileTypes: true
        });
      } catch {
        return;
      }
      for (const _0xe of _0xentries) {
        try {
          const _0xfull = path.join(_0xdir, _0xe.name);
          if (_0xe.isDirectory()) {
            if (_0xdepth < 2) {
              _0xscan(_0xfull, _0xdepth + 1);
            }
          } else if (_0xe.isFile()) {
            const _0xext = path.extname(_0xe.name).toLowerCase();
            if (MUSIC_AUDIO_EXTS.indexOf(_0xext) !== -1) {
              _0xout.push({
                path: _0xfull,
                name: path.basename(_0xe.name, path.extname(_0xe.name))
              });
            }
          }
        } catch {}
      }
    }
    _0xscan(_0xfolder, 1);
    _0xout.sort((_0xa, _0xb) => _0xa.name.localeCompare(_0xb.name, "de", {
      numeric: true,
      sensitivity: "base"
    }));
    return _0xout;
  }
  ipcMain.handle("music:pick-folder", async _0xmfEv => {
    if (!istEigenerRenderer(_0xmfEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xmfRes = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"]
      });
      if (_0xmfRes.canceled || !_0xmfRes.filePaths || !_0xmfRes.filePaths[0]) {
        return {
          ok: false
        };
      }
      const _0xmfFolder = _0xmfRes.filePaths[0];
      const _0xmfTracks = scanMusicFolder(_0xmfFolder);
      return {
        ok: true,
        folder: _0xmfFolder,
        tracks: _0xmfTracks
      };
    } catch (_0xmfErr) {
      return {
        ok: false,
        error: _0xmfErr && _0xmfErr.message ? _0xmfErr.message : String(_0xmfErr)
      };
    }
  });
  ipcMain.handle("music:list-folder", async (_0xlfEv, _0xlfFolder) => {
    if (!istEigenerRenderer(_0xlfEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      if (!_0xlfFolder || typeof _0xlfFolder !== "string" || !fs.existsSync(_0xlfFolder)) {
        return {
          ok: false
        };
      }
      const _0xlfTracks = scanMusicFolder(_0xlfFolder);
      return {
        ok: true,
        folder: _0xlfFolder,
        tracks: _0xlfTracks
      };
    } catch (_0xlfErr) {
      return {
        ok: false,
        error: _0xlfErr && _0xlfErr.message ? _0xlfErr.message : String(_0xlfErr)
      };
    }
  });
  ipcMain.handle("platform:connect", async (_0x4dfd28, _0x4e46bc) => {
    try {
      if (_0x4e46bc === "steam") {
        const _0x186155 = await fetchOwnedSteamGames();
        if (_0x186155 && _0x186155.ok) {
          return {
            ok: true,
            detail: _0x186155.games.length + " Spiele im Besitz" + (_0x186155.persona ? " · " + _0x186155.persona : "")
          };
        }
        const _0x37ab9b = await findSteamPath();
        if (_0x37ab9b) {
          const _0x2cf626 = await scanSteam();
          if (_0x2cf626.installed) {
            return {
              ok: true,
              detail: _0x2cf626.games.length + " installiert"
            };
          }
        }
        return {
          ok: false,
          error: _0x186155 && _0x186155.error || "Steam nicht gefunden"
        };
      }
      if (_0x4e46bc === "epic") {
        const _0xd4198e = await scanEpic();
        if (_0xd4198e.installed) {
          return {
            ok: true,
            detail: _0xd4198e.games.length + " Spiele"
          };
        } else {
          return {
            ok: false,
            error: "Epic Games nicht gefunden"
          };
        }
      }
      if (_0x4e46bc === "ubisoft") {
        const _0x620abd = await scanUbisoft();
        if (_0x620abd.installed) {
          return {
            ok: true,
            detail: _0x620abd.games.length + " Spiele"
          };
        } else {
          return {
            ok: false,
            error: "Ubisoft Connect nicht gefunden"
          };
        }
      }
      if (_0x4e46bc === "ea") {
        const _0x4a215d = await scanEA();
        if (_0x4a215d.installed) {
          return {
            ok: true,
            detail: _0x4a215d.games.length + " Spiele"
          };
        } else {
          return {
            ok: false,
            error: "EA App nicht gefunden"
          };
        }
      }
    } catch (_0x526f0c) {
      return {
        ok: false,
        error: _0x526f0c.message || "Verbindungsfehler"
      };
    }
    return {
      ok: false,
      error: "Unbekannte Plattform"
    };
  });
  ipcMain.handle("shop:load", async () => {
    const [_0x9060bc, _0x455a39] = await Promise.all([findSteamPath(), findEpicLauncherExe()]);
    const [_0x153163, _0x3c8d8e, _0x196a7e] = await Promise.all([_0x9060bc ? fetchSteamShop() : Promise.resolve(null), fetchEpicShop().catch(() => []), fetchSteamFreePromos().catch(() => [])]);
    return {
      steam: _0x153163,
      epicFree: [..._0x3c8d8e, ..._0x196a7e]
    };
  });
  ipcMain.handle("profile:get", async () => await fetchUserProfile());
  ipcMain.handle("app:version", () => app.getVersion());
  // Fehler aus der Oberflaeche. Absichtlich ipcMain.on (kein handle): der
  // Renderer erwartet keine Antwort und soll beim Melden nicht warten muessen.
  ipcMain.on("ui:fehler", (ereignis, daten) => {
    try {
      if (!istEigenerRenderer(ereignis)) {
        return;
      }
      // Der Renderer ist die unsicherste Quelle im Haus - Laengen hier noch
      // einmal kappen, damit eine Schleife dort nicht den Server flutet.
      const meldung = String(daten && daten.meldung || "").slice(0, 500);
      const spur = String(daten && daten.spur || "").slice(0, 4000);
      if (!meldung && !spur) {
        return;
      }
      absturzMelden({
        art: "oberflaeche",
        meldung: meldung,
        spur: spur
      });
    } catch {}
  });
  ipcMain.handle("notify:show", (_0x1b21b5, {
    title: _0x2a97ca,
    body: _0x5c8a7b
  } = {}) => {
    try {
      if (!Notification || !Notification.isSupported()) {
        return {
          ok: false
        };
      }
      const _0x49e7de = {
        title: String(_0x2a97ca || "VisCode"),
        body: String(_0x5c8a7b || ""),
        silent: false
      };
      try {
        const _0x2c321e = path.join(__dirname, "build", "icon.png");
        const _0x5cbba7 = nativeImage.createFromPath(_0x2c321e);
        if (_0x5cbba7 && !_0x5cbba7.isEmpty()) {
          _0x49e7de.icon = _0x2c321e;
        }
      } catch {}
      const _0x4a26a9 = new Notification(_0x49e7de);
      _0x4a26a9.on("click", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      _0x4a26a9.show();
      return {
        ok: true
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  ipcMain.handle("app:beta-notice", () => {
    const _0x44e305 = app.getVersion();
    const _0x2564d0 = loadSettings();
    if (_0x2564d0.betaNoticeShownFor === _0x44e305) {
      return {
        show: false,
        version: _0x44e305
      };
    }
    const _0x309b00 = loadSettings();
    _0x309b00.betaNoticeShownFor = _0x44e305;
    saveSettings(_0x309b00);
    return {
      show: true,
      version: _0x44e305,
      firstRun: !_0x2564d0.betaNoticeShownFor
    };
  });
  ipcMain.handle("feedback:prompt-due", () => {
    const version = app.getVersion();
    const s = loadSettings();
    const askOnUpdate = s.feedbackAskOnUpdate === true; // Standard: aus
    const opens = s.appOpenCount || 0;                  // App-Starts (siehe createWindow)

    if (!askOnUpdate) {
      // Standard: NUR ein einziges Mal, ab dem 2. Öffnen, nur für neue Konten.
      if (s.feedbackPromptDone) return { show: false, version };
      // Bestandsnutzer (haben unter dem alten System schon ein Popup gesehen) → als erledigt markieren.
      if (s.feedbackPromptShownFor && !s.feedbackPromptDone) {
        const sm = loadSettings(); sm.feedbackPromptDone = true; saveSettings(sm);
        return { show: false, version };
      }
      if (opens < 2) return { show: false, version }; // erst ab dem 2. Öffnen
      const s2 = loadSettings();
      s2.feedbackPromptDone = true;
      s2.feedbackPromptShownFor = version;
      saveSettings(s2);
      return { show: true, version };
    }

    // „Nach Update fragen" an: einmal pro Version, ebenfalls erst ab dem 2. Öffnen.
    if (s.feedbackPromptShownFor === version) return { show: false, version };
    if (opens < 2) return { show: false, version };
    const s3 = loadSettings();
    s3.feedbackPromptShownFor = version;
    saveSettings(s3);
    return { show: true, version };
  });
  ipcMain.handle("launcher:report-version", async () => {
    await reportLauncherVersion();
    return {
      ok: true
    };
  });
  ipcMain.handle("presence:set", async (_0x845d21, _0x1ec66b) => {
    await setPresence(!!_0x1ec66b);
    return {
      ok: true
    };
  });
  ipcMain.handle("update:check", async () => await checkForUpdate());
  ipcMain.handle("launcher:status", async () => {
    const _0x5d8241 = loadSettings();
    const _0x3e7897 = (_0x5d8241.apiBaseUrl || "").replace(/\/$/, "");
    if (!_0x3e7897) {
      return null;
    }
    try {
      const _0x46124b = await fetch(_0x3e7897 + "/removed", {
        headers: {
          ...(_0x5d8241.sessionToken ? {
            Authorization: "Bearer " + _0x5d8241.sessionToken
          } : {}),
          ...watermarkHeaders(_0x3e7897 + "/removed")
        }
      });
      const _0x58f9fd = await _0x46124b.json().catch(() => null);
      if (_0x58f9fd) {
        return {
          ..._0x58f9fd,
          currentVersion: app.getVersion()
        };
      } else {
        return null;
      }
    } catch {
      return null;
    }
  });
  ipcMain.handle("update:run", async (_0x14a96f, _0xa62242) => {
    if (!istEigenerRenderer(_0x14a96f)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    return await runUpdate(_0xa62242);
  });
  ipcMain.handle("steam:owned", async () => await fetchOwnedSteamGames());
  ipcMain.handle("steam:accounts", async () => {
    const _0x562a7e = await findSteamPath();
    return listSteamAccounts(_0x562a7e);
  });
  ipcMain.handle("steam:owned-multi", async () => await fetchAllAccountsOwned());
  ipcMain.handle("steam:launch-as", async (_0x47c54d, {
    appid: _0x5f17fd,
    accountName: _0x12bc4d
  } = {}) => await launchSteamAsAccount(_0x5f17fd, _0x12bc4d));
  ipcMain.handle("steam:set-accounts", (_0x46ac41, _0x3ee8b5) => {
    const _0x8b2918 = loadSettings();
    _0x8b2918.steamAccounts = Array.isArray(_0x3ee8b5) ? _0x3ee8b5 : [];
    saveSettings(_0x8b2918);
    return {
      ok: true,
      steamAccounts: _0x8b2918.steamAccounts
    };
  });
  ipcMain.handle("shop:search", async (_0x110dfe, {
    term: _0x3e9d91,
    page: _0x26732e
  }) => await steamCatalogSearch(_0x3e9d91 || "", _0x26732e || 0));
  ipcMain.handle("xbox:search", async (_0xxsEv, _0xxsArg) => await fetchXboxSearch(_0xxsArg && _0xxsArg.term));
  ipcMain.handle("playstation:store-page", async (_0xpsEv, _0xpsArg) => {
    const _0xa = _0xpsArg || {};
    return await fetchPsStorePage(Number(_0xa.start) || 0, Math.min(96, Number(_0xa.count) || 48));
  });
  ipcMain.handle("playstation:search", async (_0xpssEv, _0xpssArg) => await fetchPsSearch(_0xpssArg && _0xpssArg.term));
  ipcMain.handle("nintendo:store-page", async (_0xnsEv, _0xnsArg) => {
    const _0xa = _0xnsArg || {};
    return await fetchNintendoStorePage(Number(_0xa.start) || 0, Math.min(48, Number(_0xa.count) || 24), _0xa.term || "");
  });
  ipcMain.handle("epic:shop", async (_0x3cd5cd, {
    term: _0x40713f,
    page: _0x3ee9c8
  } = {}) => await fetchEpicCatalog(_0x40713f || "", _0x3ee9c8 || 0));
  ipcMain.handle("gamerpower:free", async () => await fetchGamerPower());
  ipcMain.handle("deals:list", async () => await fetchCheapSharkDeals());
  ipcMain.handle("deals:forTitle", async (_0xdev, _0xdarg) => await fetchCheapSharkForTitle(_0xdarg && _0xdarg.title));
  // Preisvergleich: Store-Liste (storeID -> Name). Nur einmal geholt, im Main
  // gecacht (fetchCheapSharkStores), damit die Namen nicht mehrfach laden.
  ipcMain.handle("preise:stores", async _0xpsEv => {
    if (!istEigenerRenderer(_0xpsEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xmap = await fetchCheapSharkStores();
      return {
        ok: true,
        stores: _0xmap || {}
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  // Preisvergleich zu einem Titel ueber alle Stores (CheapShark + optional ITAD).
  ipcMain.handle("preise:vergleich", async (_0xpvEv, _0xpvArg) => {
    if (!istEigenerRenderer(_0xpvEv)) {
      return {
        ok: false
      };
    }
    return await preisVergleichHolen(_0xpvArg && _0xpvArg.titel);
  });
  // Kandidaten-Liste (Cover-Auswahl vor dem Vergleich, gegen Editions-Verwechslung).
  ipcMain.handle("preise:kandidaten", async (_0xpkEv, _0xpkArg) => {
    if (!istEigenerRenderer(_0xpkEv)) {
      return { ok: false, kandidaten: [] };
    }
    const _0xk = await cheapSharkKandidaten(_0xpkArg && _0xpkArg.titel);
    return { ok: true, kandidaten: _0xk };
  });
  // Genauer Vergleich fuer ein ausgewaehltes Spiel (CheapShark per gameID + ITAD).
  ipcMain.handle("preise:vergleichGenau", async (_0xpgEv, _0xpgArg) => {
    if (!istEigenerRenderer(_0xpgEv)) {
      return { ok: false };
    }
    return await preisVergleichGenau(_0xpgArg && _0xpgArg.gameID, _0xpgArg && _0xpgArg.titel);
  });
  // Alle von ITAD gefuehrten Shops als moegliche Kanaele (OEFFENTLICH, kein Key).
  // Gecacht in itadShopsHolen, absteigend nach Zahl der Spiele (grosse oben).
  ipcMain.handle("shop:shops", async _0xshEv => {
    if (!istEigenerRenderer(_0xshEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xshops = await itadShopsHolen();
      return {
        ok: true,
        shops: _0xshops
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  // Angebote eines einzelnen Shops (mit Key). Ohne Key -> {ok:false, fehler:"kein-key"}.
  ipcMain.handle("shop:angebote", async (_0xsaEv, _0xsaArg) => {
    if (!istEigenerRenderer(_0xsaEv)) {
      return {
        ok: false
      };
    }
    return await itadAngeboteHolen(_0xsaArg && _0xsaArg.shopId, _0xsaArg && _0xsaArg.limit);
  });
  // Keyless Cover pro Spielname (fuer Nicht-Steam-Spiele im "Erkannte Spiele"-Panel).
  // a) Steam-Store-Suche (keyless) -> library_600x900.jpg per appid; b) Fallback CheapShark-thumb.
  // In-Memory-Cache pro Titel, damit nicht mehrfach geladen wird. Defensiv: immer {ok,...}.
  ipcMain.handle("cover:forTitle", async (_0xcev, _0xcarg) => {
    try {
      const _0xtitle = String((_0xcarg && _0xcarg.title) || "").trim();
      if (!_0xtitle) {
        return {
          ok: false
        };
      }
      const _0xkey = _0xtitle.toLowerCase();
      if (_coverForTitleCache.has(_0xkey)) {
        return _coverForTitleCache.get(_0xkey);
      }
      let _0xresult = {
        ok: false
      };
      // a) Steam-Store-Suche (keyless)
      try {
        const _0xsearch = await fetchJson("https://store.steampowered.com/api/storesearch/?term=" + encodeURIComponent(_0xtitle) + "&cc=us&l=en", {}, 8000);
        const _0xitems = _0xsearch && Array.isArray(_0xsearch.items) ? _0xsearch.items : [];
        const _0xhit = _0xitems.find(_0xit => _0xit && _0xit.id);
        if (_0xhit) {
          _0xresult = {
            ok: true,
            url: "https://cdn.cloudflare.steamstatic.com/steam/apps/" + encodeURIComponent(_0xhit.id) + "/library_600x900.jpg"
          };
        }
      } catch {}
      // b) Fallback: CheapShark-thumb
      if (!_0xresult.ok) {
        try {
          const _0xcs = await fetchCheapSharkForTitle(_0xtitle);
          if (_0xcs && _0xcs.ok && _0xcs.thumb) {
            _0xresult = {
              ok: true,
              url: _0xcs.thumb
            };
          }
        } catch {}
      }
      _coverForTitleCache.set(_0xkey, _0xresult);
      return _0xresult;
    } catch {
      return {
        ok: false
      };
    }
  });
  ipcMain.handle("viscode:info", async () => await fetchViscodeInfo());
  ipcMain.handle("viscode:publisher-details", async (_0x4af41a, _0x450d32) => {
    const _0xce3239 = loadSettings();
    const _0x55f1b7 = (_0xce3239.viscodeInfoUrl || "https://removed.invalid").replace(/\/$/, "");
    if (!_0x450d32) {
      return null;
    }
    try {
      const _0x2c8590 = await fetchJson(_0x55f1b7 + "/removed/" + encodeURIComponent(_0x450d32) + "/details", {}, 10000);
      if (_0x2c8590 && _0x2c8590.paths) {
        delete _0x2c8590.paths;
      }
      return _0x2c8590;
    } catch {
      return null;
    }
  });
  ipcMain.handle("game:platforms", async (_0x537307, _0x581da3) => {
    const _0x48be23 = loadSettings();
    const _0x4f4e4b = (_0x48be23.apiBaseUrl || "").replace(/\/$/, "");
    if (!_0x4f4e4b || !_0x581da3) {
      return {
        ok: false,
        error: "Keine GameID."
      };
    }
    const _0x499a84 = {
      "X-Launcher-Version": app.getVersion(),
      ...(_0x48be23.sessionToken ? {
        Authorization: "Bearer " + _0x48be23.sessionToken
      } : {})
    };
    try {
      const _0x5ec995 = await fetchJson(_0x4f4e4b + "/removed/" + encodeURIComponent(_0x581da3) + "/platforms", {
        headers: _0x499a84
      }, 10000);
      return _0x5ec995 || {
        ok: false,
        error: "Server nicht erreichbar."
      };
    } catch (_0x21e811) {
      return {
        ok: false,
        error: _0x21e811 && _0x21e811.message || "Plattformen nicht abrufbar."
      };
    }
  });
  ipcMain.handle("platforms:list", async () => {
    if (platformListCache) {
      return platformListCache;
    }
    const _0x576710 = loadSettings();
    const _0x31b803 = (_0x576710.apiBaseUrl || "").replace(/\/$/, "");
    if (!_0x31b803) {
      return {
        ok: false,
        error: "Keine Server-Adresse."
      };
    }
    const _0x3aae7d = {
      "X-Launcher-Version": app.getVersion(),
      ...(_0x576710.sessionToken ? {
        Authorization: "Bearer " + _0x576710.sessionToken
      } : {})
    };
    try {
      const _0x3fb02d = await fetchJson(_0x31b803 + "/removed", {
        headers: _0x3aae7d
      }, 10000);
      if (_0x3fb02d && _0x3fb02d.ok) {
        platformListCache = _0x3fb02d;
      }
      return _0x3fb02d || {
        ok: false,
        error: "Server nicht erreichbar."
      };
    } catch (_0x5a219d) {
      return {
        ok: false,
        error: _0x5a219d && _0x5a219d.message || "Plattformen nicht abrufbar."
      };
    }
  });
  ipcMain.handle("steam:achievements", async (_0x2093a7, {
    appid: _0x492928
  }) => await fetchSteamAchievements(_0x492928));
  ipcMain.handle("steam:friends", async () => await fetchSteamFriends());
  ipcMain.handle("steam:player-summary", async (_0x154f04, _0x3ac01f) => await fetchSteamPlayerSummary(_0x3ac01f));
  ipcMain.handle("steam:sync-keys", async () => await syncSteamKeysFromServer());
  ipcMain.handle("epic:login", async () => await epicLogin());
  ipcMain.handle("epic:friends", async () => {
    const _0x5b6602 = loadSettings();
    if (_0x5b6602.epicLauncherAccessToken) {
      const _0x43ca22 = await fetchEpicLauncherFriends();
      if (_0x43ca22.ok && _0x43ca22.friends.length) {
        return _0x43ca22;
      }
    }
    return await fetchEpicFriends();
  });
  ipcMain.handle("epic:status", async () => {
    const _0x394299 = loadSettings();
    return {
      configured: epicConfigured(_0x394299),
      connected: !!_0x394299.epicAccountId,
      displayName: _0x394299.epicDisplayName || ""
    };
  });
  ipcMain.handle("epic:logout", async () => {
    const _0x3848c6 = loadSettings();
    _0x3848c6.epicAccessToken = "";
    _0x3848c6.epicRefreshToken = "";
    _0x3848c6.epicAccountId = "";
    _0x3848c6.epicDisplayName = "";
    _0x3848c6.epicTokenExpiresAt = 0;
    saveSettings(_0x3848c6);
    return {
      ok: true
    };
  });
  ipcMain.handle("xbox:login", async () => await xboxLogin());
  ipcMain.handle("xbox:friends", async () => await fetchXboxFriends());
  ipcMain.handle("xbox:profile", async () => await fetchXboxProfile());
  ipcMain.handle("xbox:user-profile", async (_0x19d6f9, _0x5304cd) => await fetchXboxUserProfile(_0x5304cd));
  ipcMain.handle("xbox:store-page", async (_0x53f053, {
    start: _0x59ac3d,
    count: _0x5829ee
  } = {}) => await fetchXboxStorePage(_0x59ac3d || 0, _0x5829ee || 10));
  ipcMain.handle("xbox:library", async () => await fetchXboxLibrary());
  ipcMain.handle("xbox:gamepass", async (_0xgpEv, _0xgpArg) => await xboxScanner().gamePassKatalog(!!(_0xgpArg && _0xgpArg.neu)));
  ipcMain.handle("xbox:abo", async (_0xaboEv, _0xaboArg) => await xboxScanner().aboStatus({ sichtbar: !!(_0xaboArg && _0xaboArg.sichtbar) }));
  ipcMain.handle("xbox:appScan", async (_0xasEv, _0xasArg) => {
    if (!IS_WIN) {
      return { ok: false, error: "nur Windows" };
    }
    return await xboxScanner().appScan({ ki: !(_0xasArg && _0xasArg.ki === false) });
  });
  ipcMain.handle("xbox:kiStatus", async () => await xboxScanner().kiStatus());
  ipcMain.handle("xbox:kiModellLaden", async () => await xboxScanner().kiModellLaden());
  ipcMain.handle("xbox:bibliothek", async () => {
    const _0xbibVerlauf = await fetchXboxLibrary().catch(() => null);
    let _0xbibInst = [];
    try {
      _0xbibInst = scanXbox().games || [];
    } catch {}
    const _0xbibErg = await xboxScanner().bibliothekKomplett({
      gespielt: _0xbibVerlauf && _0xbibVerlauf.ok ? _0xbibVerlauf.games : [],
      installiert: _0xbibInst
    });
    _0xbibErg.verlaufOk = !!(_0xbibVerlauf && _0xbibVerlauf.ok);
    _0xbibErg.verlaufFehler = _0xbibVerlauf && !_0xbibVerlauf.ok ? _0xbibVerlauf.error : null;
    return _0xbibErg;
  });
  ipcMain.handle("xbox:status", async () => {
    const _0x5f2873 = loadSettings();
    return {
      connected: !!xboxAuthHeader(_0x5f2873),
      expired: !!_0x5f2873.xboxToken && !xboxAuthHeader(_0x5f2873),
      gamertag: _0x5f2873.xboxGamertag || "",
      xuid: _0x5f2873.xboxXuid || ""
    };
  });
  ipcMain.handle("xbox:logout", async () => {
    const _0x5155d4 = loadSettings();
    _0x5155d4.xboxToken = "";
    _0x5155d4.xboxUserHash = "";
    _0x5155d4.xboxXuid = "";
    _0x5155d4.xboxGamertag = "";
    _0x5155d4.xboxTokenExpiresAt = 0;
    _0x5155d4.connectXbox = false;
    saveSettings(_0x5155d4);
    return {
      ok: true
    };
  });
  ipcMain.handle("epic:store-page", async (_0x36f916, {
    start: _0x25a35e,
    count: _0x9d9b5e
  } = {}) => await fetchEpicStorePage(_0x25a35e || 0, _0x9d9b5e || 40));
  ipcMain.handle("epic:launcher-login", async () => await epicLauncherLogin());
  ipcMain.handle("epic:owned", async () => await fetchEpicOwnedLibrary());
  ipcMain.handle("epic:launcher-status", async () => {
    const _0x420be2 = loadSettings();
    return {
      connected: !!_0x420be2.epicLauncherAccountId,
      displayName: _0x420be2.epicLauncherDisplayName || "",
      expiresAt: _0x420be2.epicLauncherExpiresAt || 0
    };
  });
  ipcMain.handle("epic:launcher-logout", async () => {
    const _0x3d70ce = loadSettings();
    _0x3d70ce.epicLauncherAccessToken = "";
    _0x3d70ce.epicLauncherRefreshToken = "";
    _0x3d70ce.epicLauncherAccountId = "";
    _0x3d70ce.epicLauncherDisplayName = "";
    _0x3d70ce.epicLauncherExpiresAt = 0;
    saveSettings(_0x3d70ce);
    return {
      ok: true
    };
  });
  // ── GOG ──────────────────────────────────────────────────────────────────
  ipcMain.handle("gog:login", async () => {
    try {
      return await gogLogin();
    } catch (_0xeGL2) {
      return {
        ok: false,
        error: _0xeGL2 && _0xeGL2.message || "GOG-Anmeldung fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("gog:status", async () => {
    const _0xsGS2 = loadSettings();
    const _0xcGS2 = _0xsGS2.gogGamesCache && Array.isArray(_0xsGS2.gogGamesCache.games) ? _0xsGS2.gogGamesCache : null;
    return {
      connected: !!(_0xsGS2.gogAccessToken || _0xsGS2.gogRefreshToken),
      expired: !!_0xsGS2.gogAccessToken && !_0xsGS2.gogRefreshToken && Date.now() >= (_0xsGS2.gogExpiresAt || 0),
      username: _0xsGS2.gogUsername || "",
      userId: _0xsGS2.gogUserId || "",
      avatar: _0xsGS2.gogAvatar || "",
      expiresAt: _0xsGS2.gogExpiresAt || 0,
      cachedCount: _0xcGS2 ? _0xcGS2.games.length : 0,
      cachedAt: _0xcGS2 ? _0xcGS2.t || 0 : 0
    };
  });
  ipcMain.handle("gog:logout", async () => {
    const _0xsGO2 = loadSettings();
    _0xsGO2.gogAccessToken = "";
    _0xsGO2.gogRefreshToken = "";
    _0xsGO2.gogExpiresAt = 0;
    _0xsGO2.gogUserId = "";
    _0xsGO2.gogUsername = "";
    _0xsGO2.gogAvatar = "";
    _0xsGO2.gogGamesCache = null;
    _0xsGO2.connectGOG = false;
    saveSettings(_0xsGO2);
    return {
      ok: true
    };
  });
  ipcMain.handle("gog:owned", async (_0xevGW2, _0xargGW2) => {
    try {
      return await fetchGogOwnedLibrary(!!(_0xargGW2 && _0xargGW2.force));
    } catch (_0xeGW2) {
      return {
        ok: false,
        error: _0xeGW2 && _0xeGW2.message || "GOG-Bibliothek konnte nicht geladen werden.",
        games: []
      };
    }
  });
  ipcMain.handle("gog:scan", async () => {
    try {
      return await scanGogInstalled();
    } catch (_0xeGC2) {
      return {
        installed: false,
        path: null,
        games: [],
        error: _0xeGC2 && _0xeGC2.message || "GOG-Suche fehlgeschlagen."
      };
    }
  });
  // ── Ubisoft ──────────────────────────────────────────────────────────────
  ipcMain.handle("ubisoft:login", async () => {
    try {
      return await ubisoftLogin();
    } catch (_0xeUL2) {
      return {
        ok: false,
        error: _0xeUL2 && _0xeUL2.message || "Ubisoft-Anmeldung fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("ubisoft:status", async () => {
    const _0xsUS2 = loadSettings();
    return {
      connected: !!_0xsUS2.ubisoftTicket,
      name: _0xsUS2.ubisoftName || "",
      profileId: _0xsUS2.ubisoftProfileId || "",
      since: _0xsUS2.ubisoftTicketAt || 0
    };
  });
  ipcMain.handle("ubisoft:logout", async () => {
    const _0xsUO2 = loadSettings();
    _0xsUO2.ubisoftTicket = "";
    _0xsUO2.ubisoftProfileId = "";
    _0xsUO2.ubisoftName = "";
    _0xsUO2.ubisoftTicketAt = 0;
    _0xsUO2.connectUbisoft = false;
    saveSettings(_0xsUO2);
    return {
      ok: true
    };
  });
  ipcMain.handle("ubisoft:scan", async () => {
    try {
      return await scanUbisoftInstalled();
    } catch (_0xeUC2) {
      return {
        installed: false,
        path: null,
        games: [],
        error: _0xeUC2 && _0xeUC2.message || "Ubisoft-Suche fehlgeschlagen."
      };
    }
  });
  // ── Multi-Launcher-Scanner (rein lokal) ────────────────────────────────────
  ipcMain.handle("launcher:scan", async () => {
    try {
      const _0xsendLive = _0xpayload => {
        try {
          if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send("launcher:scanLive", _0xpayload);
          }
        } catch {}
      };
      return await launcherScan.scanAll({
        onLauncher: _0xlive => {
          _0xsendLive({
            type: "launcher",
            launcher: _0xlive
          });
        }
      });
    } catch (_0xeLS) {
      return {
        ok: false,
        scannedAt: new Date().toISOString(),
        launchers: [],
        error: _0xeLS && _0xeLS.message || "Launcher-Scan fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("launcher:deepScan", async (_0xevLDS, _0xoptLDS) => {
    try {
      const _0xbaseLDS = await launcherScan.scanAll();
      const _0xtitelLDS = [];
      for (const _0xlLDS of _0xbaseLDS.launchers || []) {
        for (const _0xgLDS of _0xlLDS.games || []) {
          if (_0xgLDS && _0xgLDS.name) _0xtitelLDS.push(_0xgLDS.name);
        }
      }
      const _0xcacheLDS = path.join(app.getPath("userData"), "launcher-deepscan.json");
      const _0xresLDS = await launcherScan.deepScan({
        extraTitles: _0xtitelLDS,
        cacheFile: _0xcacheLDS,
        onProgress: _0xpLDS => {
          try {
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send("launcher:scanProgress", _0xpLDS);
            }
          } catch {}
        }
      });
      return {
        ok: true,
        phase1: _0xbaseLDS,
        deep: _0xresLDS,
        cacheFile: _0xcacheLDS
      };
    } catch (_0xeLDS) {
      return {
        ok: false,
        error: _0xeLDS && _0xeLDS.message || "Tiefen-Scan fehlgeschlagen."
      };
    }
  });
  // ── Crowd-Launcher: Community-Signaturen abrufen + lokal erkennen ──────────
  ipcMain.handle("launcher:crowdDetect", async () => {
    try {
      const _0xnowCD = Date.now();
      if (crowdLauncherCache && _0xnowCD - crowdLauncherCacheTime < CROWD_CACHE_MS) {
        return crowdLauncherCache;
      }
      const _0xlistCD = await fetchJson("https://removed.invalid", {}, 8000);
      if (!_0xlistCD || !_0xlistCD.ok || !Array.isArray(_0xlistCD.launchers)) {
        return {
          ok: false,
          launchers: []
        };
      }
      const _0xdetCD = await launcherScan.detectCrowdLaunchers(_0xlistCD.launchers);
      const _0xresCD = {
        ok: true,
        launchers: _0xdetCD
      };
      crowdLauncherCache = _0xresCD;
      crowdLauncherCacheTime = _0xnowCD;
      return _0xresCD;
    } catch (_0xeCD) {
      return {
        ok: false,
        launchers: []
      };
    }
  });
  // ── Crowd-Launcher: manuell hinzufügen (exe wählen → Signatur → Server) ────
  ipcMain.handle("launcher:addManual", async _0xamEv => {
    if (!istEigenerRenderer(_0xamEv)) {
      return {
        ok: false
      };
    }
    try {
      const _0xamRes = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        filters: [{
          name: "Programme",
          extensions: ["exe"]
        }],
        title: "Launcher-Programm (.exe) wählen"
      });
      if (_0xamRes.canceled || !_0xamRes.filePaths || !_0xamRes.filePaths[0]) {
        return {
          ok: false,
          canceled: true
        };
      }
      const _0xexePathAM = _0xamRes.filePaths[0];
      const _0xexeFileAM = path.basename(_0xexePathAM);
      const _0xparentAM = path.dirname(_0xexePathAM);
      let _0xnameAM = _0xexeFileAM.replace(/\.exe$/i, "").trim();
      if (!_0xnameAM) _0xnameAM = path.basename(_0xparentAM);
      let _0xidAM = _0xnameAM.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
      if (!_0xidAM) _0xidAM = "launcher_" + Date.now();
      const _0xdetectAM = {
        exe: [_0xexeFileAM],
        folders: [_0xparentAM]
      };
      // An den Signatur-Server posten (best-effort, Fehler egal).
      try {
        const _0xpostAM = await fetchJson("https://removed.invalid", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: _0xnameAM,
            launchScheme: "",
            detect: {
              registry: [],
              exe: [_0xexeFileAM],
              folders: [_0xparentAM]
            }
          })
        }, 8000);
        if (_0xpostAM && _0xpostAM.ok && _0xpostAM.id) _0xidAM = _0xpostAM.id;
      } catch {}
      // Cache leeren, damit der neue Launcher beim nächsten crowdDetect erscheint.
      crowdLauncherCache = null;
      return {
        ok: true,
        launcher: {
          id: _0xidAM,
          name: _0xnameAM,
          detect: _0xdetectAM,
          installed: true
        }
      };
    } catch (_0xeAM) {
      return {
        ok: false,
        error: _0xeAM && _0xeAM.message ? _0xeAM.message : String(_0xeAM)
      };
    }
  });
  ipcMain.handle("game:details", async (_0x151c67, _0x3e8afe) => {
    if (!_0x3e8afe || !_0x3e8afe.platform) {
      return null;
    }
    if (_0x3e8afe.platform === "steam") {
      return await fetchSteamDetails(_0x3e8afe.id);
    }
    if (_0x3e8afe.platform === "epic") {
      return await fetchEpicDetails(_0x3e8afe);
    }
    if (_0x3e8afe.platform === "xbox") {
      return await fetchXboxDetails(_0x3e8afe);
    }
    return null;
  });
  ipcMain.handle("library:enrich", async (_0x137a44, _0x287990) => {
    if (!Array.isArray(_0x287990)) {
      return [];
    }
    const _0x35787e = [];
    const _0x2ae9a7 = [];
    for (const _0x173eaf of _0x287990) {
      const _0x4ca6cc = _0x173eaf.platform + "|" + _0x173eaf.id;
      if (libraryCache.has(_0x4ca6cc)) {
        _0x35787e.push(libraryCache.get(_0x4ca6cc));
      } else {
        _0x2ae9a7.push(_0x173eaf);
        _0x35787e.push(null);
      }
    }
    const _0x23134d = [];
    for (let _0xee8065 = 0; _0xee8065 < _0x2ae9a7.length; _0xee8065 += 4) {
      const _0x54ce0b = _0x2ae9a7.slice(_0xee8065, _0xee8065 + 4).map(async _0x160ab7 => {
        try {
          let _0x1ec2f6 = null;
          if (_0x160ab7.platform === "steam") {
            const _0x546f09 = await fetchSteamDetails(_0x160ab7.id);
            if (_0x546f09) {
              _0x1ec2f6 = {
                platform: "steam",
                id: _0x160ab7.id,
                genres: (_0x546f09.genres || []).slice(0, 3),
                image: _0x546f09.heroImage,
                shortDescription: _0x546f09.shortDescription
              };
            }
          } else if (_0x160ab7.platform === "epic") {
            const _0xaca2af = await fetchEpicDetails(_0x160ab7);
            if (_0xaca2af) {
              _0x1ec2f6 = {
                platform: "epic",
                id: _0x160ab7.id,
                genres: (_0xaca2af.genres || []).slice(0, 3),
                image: _0xaca2af.heroImage,
                shortDescription: _0xaca2af.shortDescription
              };
            }
          }
          if (_0x1ec2f6) {
            libraryCache.set(_0x160ab7.platform + "|" + _0x160ab7.id, _0x1ec2f6);
          }
          return {
            ref: _0x160ab7,
            info: _0x1ec2f6
          };
        } catch {
          return {
            ref: _0x160ab7,
            info: null
          };
        }
      });
      _0x23134d.push(...(await Promise.allSettled(_0x54ce0b)));
    }
    let _0x36aca4 = 0;
    for (let _0x35680d = 0; _0x35680d < _0x35787e.length; _0x35680d++) {
      if (_0x35787e[_0x35680d] === null && _0x36aca4 < _0x23134d.length) {
        const _0x21de91 = _0x23134d[_0x36aca4];
        _0x35787e[_0x35680d] = _0x21de91.status === "fulfilled" ? _0x21de91.value?.info || null : null;
        _0x36aca4++;
      }
    }
    return _0x35787e;
  });
  ipcMain.handle("server:games", async () => {
    const {
      apiBaseUrl: _0x20eaae
    } = loadSettings();
    if (!_0x20eaae) {
      return null;
    }
    return await fetchJson(_0x20eaae.replace(/\/$/, "") + "/removed", {}, 4000);
  });
  ipcMain.handle("auth:login", async (_0x364d80, {
    username: _0x404ec8,
    password: _0x46bef7
  }) => {
    const _0x5a4d45 = loadSettings();
    const _0x4e7008 = _0x5a4d45.apiBaseUrl.replace(/\/$/, "");
    const _0x655875 = await computeHwid();
    let _0x55ffcd = null;
    let _0x202990 = 0;
    try {
      const _0x14a8aa = /@/.test(_0x404ec8 || "");
      const _0x10ff37 = {
        password: _0x46bef7,
        lastHwid: _0x655875,
        device: await deviceInfo()
      };
      if (_0x14a8aa) {
        _0x10ff37.email = _0x404ec8;
      } else {
        _0x10ff37.username = _0x404ec8;
      }
      const _0x59a41d = await fetch(_0x4e7008 + "/removed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...watermarkHeaders(_0x4e7008 + "/removed")
        },
        body: JSON.stringify(_0x10ff37)
      });
      _0x202990 = _0x59a41d.status;
      _0x55ffcd = await _0x59a41d.json().catch(() => null);
    } catch (_0x128598) {
      return {
        ok: false,
        error: "Server nicht erreichbar."
      };
    }
    if ((_0x202990 === 403 || _0x55ffcd?.banned?.active) && _0x55ffcd?.banned) {
      return {
        ok: false,
        banned: _0x55ffcd.banned,
        error: _0x55ffcd.error || "Zugang gesperrt."
      };
    }
    if (_0x55ffcd && (_0x55ffcd.ok || _0x55ffcd.user)) {
      _0x5a4d45.user = _0x55ffcd.user || {
        username: _0x404ec8,
        displayName: _0x404ec8,
        email: _0x55ffcd.email || null
      };
      if (_0x55ffcd.token) {
        _0x5a4d45.sessionToken = _0x55ffcd.token;
      }
      saveSettings(_0x5a4d45);
      return {
        ok: true,
        user: _0x5a4d45.user
      };
    }
    return {
      ok: false,
      code: _0x55ffcd?.code,
      email: _0x55ffcd?.email,
      error: _0x55ffcd?.error || _0x55ffcd?.message || "Login abgelehnt."
    };
  });
  ipcMain.handle("auth:oneclick", async (_0x45c107, {
    userId: _0x1e8909,
    email: _0x2c0242
  }) => {
    const _0x1c8b27 = loadSettings();
    const _0x2226c5 = _0x1c8b27.apiBaseUrl.replace(/\/$/, "");
    if (!_0x1e8909 || !_0x2c0242) {
      return {
        ok: false,
        error: "Keine gemerkte Kennung – bitte einmal normal anmelden."
      };
    }
    let _0x3c1c0d = null;
    let _0x336ca2 = 0;
    try {
      const _0x372538 = await fetch(_0x2226c5 + "/removed/oneclick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...watermarkHeaders(_0x2226c5 + "/removed/oneclick")
        },
        body: JSON.stringify({
          user_id: _0x1e8909,
          email: _0x2c0242
        })
      });
      _0x336ca2 = _0x372538.status;
      _0x3c1c0d = await _0x372538.json().catch(() => null);
    } catch (_0xf034c2) {
      return {
        ok: false,
        error: "Server nicht erreichbar."
      };
    }
    if ((_0x336ca2 === 403 || _0x3c1c0d?.banned?.active) && _0x3c1c0d?.banned) {
      return {
        ok: false,
        banned: _0x3c1c0d.banned,
        error: _0x3c1c0d.error || "Zugang gesperrt."
      };
    }
    const _0x2b6725 = _0x3c1c0d && (_0x3c1c0d.session_token || _0x3c1c0d.token);
    if (_0x3c1c0d && (_0x3c1c0d.ok || _0x3c1c0d.user || _0x2b6725)) {
      _0x1c8b27.user = _0x3c1c0d.user || {
        username: _0x2c0242,
        displayName: _0x2c0242,
        email: _0x2c0242
      };
      if (_0x2b6725) {
        _0x1c8b27.sessionToken = _0x2b6725;
      }
      saveSettings(_0x1c8b27);
      return {
        ok: true,
        user: _0x1c8b27.user
      };
    }
    return {
      ok: false,
      code: _0x3c1c0d?.code,
      email: _0x3c1c0d?.email,
      error: _0x3c1c0d?.error || _0x3c1c0d?.message || "Anmeldung abgelehnt."
    };
  });
  ipcMain.handle("auth:oauth", async () => await viscodeOauthLogin());
  ipcMain.handle("auth:register", async (_0x1a1b39, {
    username: _0x4705e0,
    email: _0x1bbe73,
    password: _0x2fce5a,
    birthdate: _0x2fb595
  }) => {
    const _0x577ff2 = loadSettings();
    const _0x4a0ea1 = _0x577ff2.apiBaseUrl.replace(/\/$/, "");
    let _0x244c75 = null;
    if (_0x2fb595) {
      const _0x404cbb = new Date(_0x2fb595);
      if (!isNaN(_0x404cbb)) {
        const _0x239265 = new Date();
        _0x244c75 = _0x239265.getFullYear() - _0x404cbb.getFullYear() - (_0x239265.getMonth() < _0x404cbb.getMonth() || _0x239265.getMonth() === _0x404cbb.getMonth() && _0x239265.getDate() < _0x404cbb.getDate() ? 1 : 0);
      }
    }
    let _0x531ec9 = null;
    let _0x15feca = 0;
    try {
      const _0x42d257 = await fetch(_0x4a0ea1 + "/removed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...watermarkHeaders(_0x4a0ea1 + "/removed")
        },
        body: JSON.stringify({
          username: _0x4705e0,
          email: _0x1bbe73,
          password: _0x2fce5a,
          displayName: _0x4705e0,
          age: _0x244c75,
          birthdate: _0x2fb595 || null,
          lastHwid: await computeHwid()
        })
      });
      _0x15feca = _0x42d257.status;
      _0x531ec9 = await _0x42d257.json().catch(() => null);
    } catch (_0x4d3ff2) {
      return {
        ok: false,
        error: "Server nicht erreichbar."
      };
    }
    if ((_0x15feca === 403 || _0x531ec9?.banned?.active) && _0x531ec9?.banned) {
      return {
        ok: false,
        banned: _0x531ec9.banned,
        error: _0x531ec9.error || "Zugang gesperrt."
      };
    }
    if (_0x531ec9 && (_0x531ec9.ok || _0x531ec9.user)) {
      _0x577ff2.user = _0x531ec9.user || {
        username: _0x4705e0,
        displayName: _0x4705e0,
        email: _0x1bbe73
      };
      if (_0x531ec9.token) {
        _0x577ff2.sessionToken = _0x531ec9.token;
      }
      saveSettings(_0x577ff2);
      return {
        ok: true,
        user: _0x577ff2.user
      };
    }
    return {
      ok: false,
      code: _0x531ec9?.code,
      email: _0x531ec9?.email,
      error: _0x531ec9?.error || _0x531ec9?.message || "Registrierung fehlgeschlagen"
    };
  });
  ipcMain.handle("auth:send-code", async (_0x2a5840, {
    email: _0x5d334a
  }) => {
    const _0x3ce037 = loadSettings();
    const _0x424828 = _0x3ce037.apiBaseUrl.replace(/\/$/, "");
    const _0x569dc0 = await fetchJson(_0x424828 + "/removed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: _0x5d334a
      })
    }, 6000);
    if (_0x569dc0 && (_0x569dc0.success || _0x569dc0.ok)) {
      return {
        ok: true
      };
    }
    return {
      ok: false,
      error: _0x569dc0?.message || _0x569dc0?.error || "Senden des Codes fehlgeschlagen"
    };
  });
  ipcMain.handle("auth:demo", async (_0x580b95, {
    username: _0x3b0ac4
  }) => {
    const _0x685ec1 = loadSettings();
    _0x685ec1.user = {
      username: _0x3b0ac4 || "Demo",
      displayName: _0x3b0ac4 || "Demo",
      demo: true
    };
    saveSettings(_0x685ec1);
    return {
      ok: true,
      user: _0x685ec1.user
    };
  });
  ipcMain.handle("auth:steam", async (_0x1439a3, _0x38952e = {}) => {
    const _0x1f6e74 = loadSettings();
    const _0x192073 = _0x1f6e74.apiBaseUrl.replace(/\/$/, "");
    const _0x370db2 = await findSteamPath();
    const _0x2cf601 = _0x370db2 ? detectSteamUser(_0x370db2) : null;
    const _0x469e96 = (_0x1f6e74.steamId64 || "").trim() || (_0x2cf601 ? _0x2cf601.steamId : null);
    if (!_0x469e96) {
      return {
        ok: false,
        error: "Keine Steam-Anmeldung gefunden. Ist Steam installiert und angemeldet?"
      };
    }
    let _0x16a37c = _0x2cf601?.persona || null;
    let _0x4581d7 = null;
    let _0xfe4539 = null;
    let _0x757f71 = null;
    try {
      const _0x3c96d3 = await fetchSteamPlayerSummary(_0x469e96);
      if (_0x3c96d3 && _0x3c96d3.ok) {
        _0x16a37c = _0x3c96d3.name || _0x16a37c;
        _0x4581d7 = _0x3c96d3.avatar || null;
        _0xfe4539 = _0x3c96d3.level ?? null;
        _0x757f71 = _0x3c96d3.createdAt || null;
      }
    } catch {}
    const _0x5cdadd = (_0x38952e.username || "").trim() || _0x16a37c || "steam_" + _0x469e96;
    let _0x454ee8 = null;
    let _0x1bd395 = 0;
    try {
      const _0x1c8b0a = await fetch(_0x192073 + "/removed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(_0x1f6e74.sessionToken ? {
            Authorization: "Bearer " + _0x1f6e74.sessionToken
          } : {}),
          ...watermarkHeaders(_0x192073 + "/removed")
        },
        body: JSON.stringify({
          steamId: _0x469e96,
          username: _0x5cdadd,
          displayName: _0x16a37c,
          avatar: _0x4581d7,
          level: _0xfe4539,
          createdAt: _0x757f71,
          device: await deviceInfo(),
          currentToken: _0x1f6e74.sessionToken || null,
          mergeIfLinked: true
        })
      });
      _0x1bd395 = _0x1c8b0a.status;
      _0x454ee8 = await _0x1c8b0a.json().catch(() => null);
    } catch {
      return {
        ok: false,
        error: "Server nicht erreichbar."
      };
    }
    if (_0x1bd395 === 404) {
      return {
        ok: false,
        error: "Steam-Anmeldung ist am Server noch nicht eingerichtet (Endpunkt /removed fehlt)."
      };
    }
    if (_0x454ee8 && (_0x454ee8.success || _0x454ee8.ok || _0x454ee8.user)) {
      _0x1f6e74.user = _0x454ee8.user || {
        username: _0x5cdadd,
        displayName: _0x16a37c,
        steamId: _0x469e96,
        avatar: _0x4581d7,
        provider: "steam"
      };
      if (_0x454ee8.token) {
        _0x1f6e74.sessionToken = _0x454ee8.token;
      }
      _0x1f6e74.connectSteam = true;
      saveSettings(_0x1f6e74);
      return {
        ok: true,
        user: _0x1f6e74.user
      };
    }
    return {
      ok: false,
      error: _0x454ee8?.message || _0x454ee8?.error || "Steam-Login abgelehnt."
    };
  });
  ipcMain.handle("auth:steam-profile", async () => {
    const _0x281cc3 = loadSettings();
    const _0xae0086 = await findSteamPath();
    const _0x440afe = _0xae0086 ? detectSteamUser(_0xae0086) : null;
    const _0x4303fa = (_0x281cc3.steamId64 || "").trim() || (_0x440afe ? _0x440afe.steamId : null);
    if (!_0x4303fa) {
      return {
        ok: false,
        error: "Keine Steam-Anmeldung gefunden. Ist Steam installiert und angemeldet?"
      };
    }
    let _0x59c780 = _0x440afe?.persona || null;
    let _0x24b3c2 = null;
    let _0x58181f = null;
    let _0x58ae9e = null;
    try {
      const _0x1d7519 = await fetchSteamPlayerSummary(_0x4303fa);
      if (_0x1d7519 && _0x1d7519.ok) {
        _0x59c780 = _0x1d7519.name || _0x59c780;
        _0x24b3c2 = _0x1d7519.avatar || null;
        _0x58181f = _0x1d7519.level ?? null;
        _0x58ae9e = _0x1d7519.createdAt || null;
      }
    } catch {}
    return {
      ok: true,
      steamId: _0x4303fa,
      name: _0x59c780,
      avatar: _0x24b3c2,
      level: _0x58181f,
      createdAt: _0x58ae9e
    };
  });
  ipcMain.handle("auth:epic", async (_0x14f01d, _0x10e9b6 = {}) => {
    const _0x437ddf = loadSettings().apiBaseUrl.replace(/\/$/, "");
    let _0x240d75 = loadSettings();
    if (!_0x240d75.epicLauncherAccountId || Date.now() >= (_0x240d75.epicLauncherExpiresAt || 0)) {
      const _0x17095a = await epicLauncherLogin();
      if (!_0x17095a.ok) {
        return _0x17095a;
      }
      _0x240d75 = loadSettings();
    }
    const _0x3b0a2e = _0x240d75.epicLauncherAccountId;
    const _0x593423 = (_0x10e9b6.username || "").trim() || _0x240d75.epicLauncherDisplayName || "epic_" + _0x3b0a2e;
    let _0x3cf369 = null;
    let _0xf6cf81 = 0;
    try {
      const _0x3cd515 = await fetch(_0x437ddf + "/removed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(_0x240d75.sessionToken ? {
            Authorization: "Bearer " + _0x240d75.sessionToken
          } : {}),
          ...watermarkHeaders(_0x437ddf + "/removed")
        },
        body: JSON.stringify({
          epicId: _0x3b0a2e,
          username: _0x593423,
          displayName: _0x240d75.epicLauncherDisplayName,
          device: await deviceInfo(),
          currentToken: _0x240d75.sessionToken || null,
          mergeIfLinked: true
        })
      });
      _0xf6cf81 = _0x3cd515.status;
      _0x3cf369 = await _0x3cd515.json().catch(() => null);
    } catch {
      return {
        ok: false,
        error: "Server nicht erreichbar."
      };
    }
    if (_0xf6cf81 === 404) {
      return {
        ok: false,
        error: "Epic-Anmeldung ist am Server noch nicht eingerichtet (Endpunkt /removed fehlt)."
      };
    }
    if (_0x3cf369 && (_0x3cf369.success || _0x3cf369.ok || _0x3cf369.user)) {
      _0x240d75.user = _0x3cf369.user || {
        username: _0x593423,
        displayName: _0x240d75.epicLauncherDisplayName,
        epicId: _0x3b0a2e,
        provider: "epic"
      };
      if (_0x3cf369.token) {
        _0x240d75.sessionToken = _0x3cf369.token;
      }
      _0x240d75.connectEpic = true;
      saveSettings(_0x240d75);
      return {
        ok: true,
        user: _0x240d75.user
      };
    }
    return {
      ok: false,
      error: _0x3cf369?.message || _0x3cf369?.error || "Epic-Login abgelehnt."
    };
  });
  ipcMain.handle("auth:logout", async () => {
    const _0x126bdf = loadSettings();
    _0x126bdf.user = null;
    _0x126bdf.sessionToken = "";
    saveSettings(_0x126bdf);
    return {
      ok: true
    };
  });
  ipcMain.handle("auth:hwid", async () => await computeHwid());
  ipcMain.handle("auth:check-access", async () => {
    const _0x1d3ca4 = loadSettings();
    if (_0x1d3ca4.user && _0x1d3ca4.user.demo) {
      return {
        ok: true,
        demo: true
      };
    }
    const _0xd6f27e = (_0x1d3ca4.apiBaseUrl || "").replace(/\/$/, "");
    if (!_0xd6f27e) {
      return {
        ok: true,
        offline: true
      };
    }
    const _0x59959e = await computeHwid();
    const _0x3b4f06 = {
      hwid: _0x59959e
    };
    if (_0x1d3ca4.user?.username) {
      _0x3b4f06.username = _0x1d3ca4.user.username;
    }
    if (_0x1d3ca4.user?.email) {
      _0x3b4f06.email = _0x1d3ca4.user.email;
    }
    if (_0x1d3ca4.user?.lastIp) {
      _0x3b4f06.ip = _0x1d3ca4.user.lastIp;
    }
    let _0x3c5e0b = null;
    try {
      const _0xf5d040 = await fetch(_0xd6f27e + "/removed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...watermarkHeaders(_0xd6f27e + "/removed")
        },
        body: JSON.stringify(_0x3b4f06)
      });
      _0x3c5e0b = await _0xf5d040.json().catch(() => null);
    } catch {
      return {
        ok: true,
        offline: true
      };
    }
    if (_0x3c5e0b && _0x3c5e0b.banned) {
      return {
        ok: false,
        banned: {
          active: true,
          reason: _0x3c5e0b.reason || "Gesperrt",
          until: _0x3c5e0b.until || null,
          bannedAt: _0x3c5e0b.bannedAt || null,
          type: _0x3c5e0b.type
        },
        user: _0x1d3ca4.user || null
      };
    }
    if (_0x1d3ca4.sessionToken && _0x1d3ca4.user && !_0x1d3ca4.user.demo) {
      let _0x1b696e = 0;
      let _0x32da04 = null;
      try {
        const _0x34ee71 = await fetch(_0xd6f27e + "/removed", {
          headers: {
            Authorization: "Bearer " + _0x1d3ca4.sessionToken,
            ...watermarkHeaders(_0xd6f27e + "/removed")
          }
        });
        _0x1b696e = _0x34ee71.status;
        _0x32da04 = await _0x34ee71.json().catch(() => null);
      } catch {
        return {
          ok: true,
          offline: true
        };
      }
      if (_0x1b696e === 401 || _0x1b696e === 403 || _0x1b696e === 404) {
        return {
          ok: false,
          sessionInvalid: true
        };
      }
      if (_0x32da04 && _0x32da04.banned && _0x32da04.banned.active) {
        return {
          ok: false,
          banned: _0x32da04.banned,
          user: {
            username: _0x32da04.username,
            displayName: _0x32da04.displayName
          }
        };
      }
    }
    return {
      ok: true
    };
  });
  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("social:load", () => loadSocial());
  ipcMain.handle("social:save", (_0x124834, _0x4f3eef) => saveSocial(_0x4f3eef));
  ipcMain.handle("social:api", (_0x217323, {
    method: _0x15c0b7,
    path: _0x3dc982,
    body: _0x3a4204
  } = {}) => socialApi(_0x15c0b7, _0x3dc982, _0x3a4204));
  const _0x362178 = _0x4107d1 => encodeURIComponent(String(_0x4107d1 || ""));
  ipcMain.handle("family:mine", () => familyApi("GET", "/removed/mine"));
  ipcMain.handle("family:get", (_0x4a8d5e, _0x279dd2) => _0x279dd2 ? familyApi("GET", "/removed/" + _0x362178(_0x279dd2)) : {
    ok: false,
    error: "Keine Familien-ID."
  });
  ipcMain.handle("family:create", (_0x5aa741, {
    name: _0x36261f,
    tier: _0x3004bc
  } = {}) => _0x36261f ? familyApi("POST", "/removed/create", {
    name: _0x36261f,
    tier: _0x3004bc || "basic"
  }) : {
    ok: false,
    error: "Bitte einen Familiennamen eingeben."
  });
  ipcMain.handle("family:join", (_0x32f777, {
    inviteCode: _0x3cb43f
  } = {}) => _0x3cb43f ? familyApi("POST", "/removed/join", {
    inviteCode: _0x3cb43f
  }) : {
    ok: false,
    error: "Bitte einen Einladungscode eingeben."
  });
  ipcMain.handle("family:leave", (_0x53f85a, {
    familyId: _0x477b16
  } = {}) => _0x477b16 ? familyApi("POST", "/removed/leave", {
    familyId: _0x477b16
  }) : {
    ok: false,
    error: "Keine Familien-ID."
  });
  ipcMain.handle("family:rename", (_0x4ce6a9, {
    familyId: _0x19b42c,
    name: _0x528ca1
  } = {}) => _0x19b42c && _0x528ca1 ? familyApi("POST", "/removed/" + _0x362178(_0x19b42c), {
    name: _0x528ca1
  }) : {
    ok: false,
    error: "Familien-ID oder Name fehlt."
  });
  ipcMain.handle("family:add-member", (_0x38ada5, {
    familyId: _0xf0e35c,
    userId: _0x3b90b0
  } = {}) => _0xf0e35c && _0x3b90b0 ? familyApi("POST", "/removed/" + _0x362178(_0xf0e35c) + "/members", {
    userId: _0x3b90b0
  }) : {
    ok: false,
    error: "Familien-ID oder Benutzer fehlt."
  });
  ipcMain.handle("family:remove-member", (_0x292bf9, {
    familyId: _0x1d2d34,
    userId: _0x4a64d
  } = {}) => _0x1d2d34 && _0x4a64d ? familyApi("DELETE", "/removed/" + _0x362178(_0x1d2d34) + "/members/" + _0x362178(_0x4a64d)) : {
    ok: false,
    error: "Familien-ID oder Benutzer fehlt."
  });
  ipcMain.handle("family:parental", (_0x3aedfd, {
    familyId: _0x3df6c6,
    userId: _0x51256a,
    maxAge: _0x2af0c5
  } = {}) => _0x3df6c6 && _0x51256a ? familyApi("POST", "/removed/" + _0x362178(_0x3df6c6) + "/parental", {
    userId: _0x51256a,
    maxAge: _0x2af0c5 === "" || _0x2af0c5 == null ? null : Number(_0x2af0c5)
  }) : {
    ok: false,
    error: "Familien-ID oder Benutzer fehlt."
  });
  ipcMain.handle("family:game-status", (_0x1ef97c, {
    familyId: _0x5144eb,
    gameId: _0x16ec8c
  } = {}) => _0x5144eb && _0x16ec8c ? familyApi("GET", "/removed/" + _0x362178(_0x5144eb) + "/game/" + _0x362178(_0x16ec8c) + "/status") : {
    ok: false,
    error: "Familien-ID oder Spiel fehlt."
  });
  ipcMain.handle("feedback:send", async (_0xfe308f, {
    rating: _0x1c4ab7,
    comment: _0x5338bf
  } = {}) => {
    try {
      const _0x1de927 = {
        rating: _0x1c4ab7,
        comment: String(_0x5338bf || "").slice(0, 2000),
        type: "launcher",
        launcherVersion: app.getVersion(),
        os: currentPlatformId()
      };
      const _0xfe20f = await socialApi("POST", "/removed", _0x1de927);
      if (!_0xfe20f) {
        return {
          ok: false,
          error: "Keine Antwort vom Server."
        };
      }
      return {
        ok: !!_0xfe20f.ok,
        status: _0xfe20f.status || 0,
        data: _0xfe20f.data || null,
        offline: !!_0xfe20f.offline
      };
    } catch (_0x4d914f) {
      return {
        ok: false,
        error: _0x4d914f && _0x4d914f.message || "Anfrage fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("feedback:mine", async () => {
    try {
      const _0x5671e4 = await socialApi("GET", "/removed/mine");
      if (!_0x5671e4 || !_0x5671e4.ok) {
        return {
          ok: false
        };
      }
      return {
        ok: true,
        status: _0x5671e4.status || 0,
        data: _0x5671e4.data || null
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  ipcMain.handle("game:reviews", async (_0x664fe5, _0x4151f4) => {
    try {
      if (!_0x4151f4) {
        return {
          ok: false
        };
      }
      const _0x33c1c0 = await socialApi("GET", "/removed/" + encodeURIComponent(_0x4151f4) + "/reviews");
      if (!_0x33c1c0 || !_0x33c1c0.ok) {
        return {
          ok: false,
          status: _0x33c1c0 && _0x33c1c0.status || 0
        };
      }
      return {
        ok: true,
        status: _0x33c1c0.status || 0,
        data: _0x33c1c0.data || null
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  ipcMain.handle("publisher:mine", async () => {
    const _0xe6f156 = await socialApi("GET", "/removed/mine");
    if (!_0xe6f156) {
      return {
        ok: false
      };
    }
    return {
      ok: !!_0xe6f156.ok,
      status: _0xe6f156.status || 0,
      data: _0xe6f156.data || null,
      offline: !!_0xe6f156.offline
    };
  });
  ipcMain.handle("game:review-delete", async (_0x5e1d3a, {
    gameId: _0x508c52,
    reviewId: _0x1efefa
  } = {}) => {
    try {
      if (!_0x508c52 || _0x1efefa == null) {
        return {
          ok: false,
          error: "Fehlende ID."
        };
      }
      const _0x5a4624 = await socialApi("DELETE", "/removed/" + encodeURIComponent(_0x508c52) + "/reviews/" + encodeURIComponent(_0x1efefa));
      if (!_0x5a4624) {
        return {
          ok: false,
          error: "Keine Antwort vom Server."
        };
      }
      return {
        ok: !!_0x5a4624.ok,
        status: _0x5a4624.status || 0,
        data: _0x5a4624.data || null,
        offline: !!_0x5a4624.offline
      };
    } catch (_0x2c4752) {
      return {
        ok: false,
        error: _0x2c4752 && _0x2c4752.message || "Anfrage fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("game:review-submit", async (_0x2f9776, {
    gameId: _0x101320,
    rating: _0x2de598,
    comment: _0x6092b1
  } = {}) => {
    try {
      if (!_0x101320) {
        return {
          ok: false,
          error: "Keine Spiel-ID."
        };
      }
      const _0x5665f3 = {
        stars: _0x2de598,
        rating: _0x2de598,
        comment: String(_0x6092b1 || "").slice(0, 2000)
      };
      const _0x4ee0e1 = await socialApi("POST", "/removed/" + encodeURIComponent(_0x101320) + "/reviews", _0x5665f3);
      if (!_0x4ee0e1) {
        return {
          ok: false,
          error: "Keine Antwort vom Server."
        };
      }
      return {
        ok: !!_0x4ee0e1.ok,
        status: _0x4ee0e1.status || 0,
        data: _0x4ee0e1.data || null,
        offline: !!_0x4ee0e1.offline
      };
    } catch (_0x782ff) {
      return {
        ok: false,
        error: _0x782ff && _0x782ff.message || "Anfrage fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("clipboard:write", (_0x528da2, _0x53c67f) => {
    try {
      clipboard.writeText(String(_0x53c67f || ""));
      return {
        ok: true
      };
    } catch {
      return {
        ok: false
      };
    }
  });
  ipcMain.handle("deeplink:get-pending", () => {
    const _0x45d74c = pendingDeepLink;
    pendingDeepLink = null;
    return _0x45d74c;
  });
  ipcMain.handle("daily:server-time", async () => {
    const _0x451276 = loadSettings();
    const _0x28c768 = [(_0x451276.apiBaseUrl || "").replace(/\/$/, ""), "https://removed.invalid"].filter(Boolean);
    for (const _0x27fef3 of _0x28c768) {
      try {
        const _0x3d4b3b = await fetch(_0x27fef3 + "/removed", {
          method: "HEAD",
          headers: watermarkHeaders(_0x27fef3 + "/removed")
        });
        const _0x266671 = _0x3d4b3b.headers.get("date");
        if (_0x266671) {
          const _0x233744 = new Date(_0x266671).getTime();
          if (!Number.isNaN(_0x233744)) {
            return {
              ok: true,
              epoch: _0x233744,
              source: "server"
            };
          }
        }
      } catch {}
    }
    return {
      ok: false
    };
  });
  ipcMain.handle("tenor:search", async (_0x310791, _0x109e79) => {
    const _0x51630f = String(_0x109e79 || "").trim();
    const _0x2ad4d2 = (_0x51630f || "meme").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-") || "meme";
    const _0x1410ed = "https://tenor.com/search/" + _0x2ad4d2 + "-gifs";
    try {
      const _0x3b30ea = await fetch(_0x1410ed, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        }
      });
      if (!_0x3b30ea.ok) {
        return {
          ok: false,
          results: []
        };
      }
      const _0x5c3ee1 = await _0x3b30ea.text();
      const _0x493513 = new Set();
      const _0x4ae42d = /https:\/\/media[0-9]*\.tenor\.com\/[A-Za-z0-9_/-]+\.gif/g;
      let _0x2cfe8e;
      while ((_0x2cfe8e = _0x4ae42d.exec(_0x5c3ee1)) !== null) {
        _0x493513.add(_0x2cfe8e[0]);
      }
      const _0x2e1f04 = [..._0x493513].slice(0, 40).map((_0x3323c2, _0x2b1e48) => ({
        id: String(_0x2b1e48),
        gif: _0x3323c2,
        preview: _0x3323c2,
        title: ""
      }));
      return {
        ok: _0x2e1f04.length > 0,
        results: _0x2e1f04
      };
    } catch {
      return {
        ok: false,
        results: []
      };
    }
  });
  ipcMain.handle("translate:text", async (_0xteev, _0xteopts) => {
    // Übersetzung über den Main-Prozess (umgeht CSP/CORS). Fehler => { ok:false, text:Original }.
    const _0xtetext = _0xteopts && _0xteopts.text != null ? String(_0xteopts.text) : "";
    const _0xtelang = _0xteopts && _0xteopts.lang ? String(_0xteopts.lang) : "";
    if (!_0xtetext || !_0xtelang || _0xtelang === "de") {
      return {
        ok: true,
        text: _0xtetext
      };
    }
    const _0xteprovider = _0xteopts && _0xteopts.provider || "google";
    const _0xteurl = _0xteopts && _0xteopts.url || "";
    const _0xtectrl = new AbortController();
    const _0xteto = setTimeout(() => _0xtectrl.abort(), 8000);
    try {
      if (_0xteprovider === "libretranslate") {
        const _0xteendpoint = _0xteurl || "https://libretranslate.com/translate";
        const _0xteres = await fetch(_0xteendpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            q: _0xtetext,
            source: "de",
            target: _0xtelang,
            format: "text"
          }),
          signal: _0xtectrl.signal
        });
        if (!_0xteres.ok) {
          return {
            ok: false,
            text: _0xtetext
          };
        }
        const _0xtedata = await _0xteres.json();
        return {
          ok: true,
          text: _0xtedata && _0xtedata.translatedText || _0xtetext
        };
      }
      const _0xtegurl = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=" + encodeURIComponent(_0xtelang) + "&dt=t&q=" + encodeURIComponent(_0xtetext);
      const _0xteres2 = await fetch(_0xtegurl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        signal: _0xtectrl.signal
      });
      if (!_0xteres2.ok) {
        return {
          ok: false,
          text: _0xtetext
        };
      }
      const _0xtejson = await _0xteres2.json();
      const _0xteout = Array.isArray(_0xtejson) && Array.isArray(_0xtejson[0]) ? _0xtejson[0].map(_0xteseg => _0xteseg && _0xteseg[0] || "").join("") : "";
      return {
        ok: !!_0xteout,
        text: _0xteout || _0xtetext
      };
    } catch {
      return {
        ok: false,
        text: _0xtetext
      };
    } finally {
      clearTimeout(_0xteto);
    }
  });
  ipcMain.handle("media:data-url", async (_0x51db97, _0x1589e4) => {
    if (!_0x1589e4 || !/^https:/i.test(_0x1589e4)) {
      return null;
    }
    try {
      if (istPrivaterHost(new URL(_0x1589e4).hostname)) {
        return null;
      }
    } catch {
      return null;
    }
    return await new Promise(_0x2a7aa8 => {
      try {
        https.get(_0x1589e4, {
          headers: {
            "User-Agent": "VisCodeLauncher"
          }
        }, _0x134029 => {
          if (_0x134029.statusCode !== 200) {
            _0x134029.resume();
            return _0x2a7aa8(null);
          }
          const _0x338e20 = _0x134029.headers["content-type"] || "image/gif";
          const _0x5ea80d = [];
          let _0x675d18 = 0;
          _0x134029.on("data", _0x38ba5c => {
            _0x675d18 += _0x38ba5c.length;
            if (_0x675d18 > 8388608) {
              _0x134029.destroy();
              _0x2a7aa8(null);
            } else {
              _0x5ea80d.push(_0x38ba5c);
            }
          });
          _0x134029.on("end", () => _0x2a7aa8("data:" + _0x338e20 + ";base64," + Buffer.concat(_0x5ea80d).toString("base64")));
        }).on("error", () => _0x2a7aa8(null));
      } catch {
        _0x2a7aa8(null);
      }
    });
  });
  ipcMain.handle("launcher:library", async () => {
    const _0x1428b7 = loadSettings();
    const _0x5d877f = _0x1428b7.user && _0x1428b7.user.id;
    const _0x58867c = await socialApi("GET", "/removed" + (_0x5d877f ? "?userId=" + encodeURIComponent(_0x5d877f) : ""));
    if (_0x58867c && _0x58867c.ok) {
      return {
        ok: true,
        games: _0x58867c.data && (_0x58867c.data.games || _0x58867c.data.library || _0x58867c.data) || []
      };
    }
    return {
      ok: false,
      offline: !!_0x58867c && !!_0x58867c.offline
    };
  });
  ipcMain.handle("download:request", async (_0x2594c8, {
    gameId: _0x5ea4f4,
    title: _0x2ddd16,
    key: _0x6b14d,
    targetDir: _0x53ce23
  } = {}) => enqueueDownload({
    gameId: _0x5ea4f4,
    title: _0x2ddd16,
    key: _0x6b14d,
    targetDir: _0x53ce23
  }));
  ipcMain.handle("download:queue-list", () => ({
    active: [...dlActive.keys()],
    queued: dlQueue.map((_0x3977c2, _0x1deb7d) => ({
      gameId: _0x3977c2.gameId,
      title: _0x3977c2.title,
      position: _0x1deb7d + 1
    }))
  }));
  ipcMain.handle("download:move-first", (_0x26119d, _0x279dab) => {
    const _0x58c792 = dlQueue.findIndex(_0x308b30 => String(_0x308b30.gameId) === String(_0x279dab));
    if (_0x58c792 > 0) {
      const [_0x24a497] = dlQueue.splice(_0x58c792, 1);
      dlQueue.unshift(_0x24a497);
      emitQueueState();
    }
    return {
      ok: true
    };
  });
  ipcMain.handle("download:move", (_0x58036c, {
    gameId: _0x41ec00,
    dir: _0x3d8d0e
  } = {}) => {
    const _0x1bfff2 = dlQueue.findIndex(_0x455b9a => String(_0x455b9a.gameId) === String(_0x41ec00));
    const _0x47bc75 = _0x1bfff2 + (Number(_0x3d8d0e) < 0 ? -1 : 1);
    if (_0x1bfff2 >= 0 && _0x47bc75 >= 0 && _0x47bc75 < dlQueue.length) {
      const [_0x28ffd5] = dlQueue.splice(_0x1bfff2, 1);
      dlQueue.splice(_0x47bc75, 0, _0x28ffd5);
      emitQueueState();
    }
    return {
      ok: true
    };
  });
  ipcMain.handle("download:cancel", (_0x1886b3, _0x120f51) => {
    const _0x1c78fe = String(_0x120f51);
    const _0x2b061b = dlQueue.findIndex(_0x5abf93 => String(_0x5abf93.gameId) === _0x1c78fe);
    if (_0x2b061b >= 0) {
      const [_0x41ac84] = dlQueue.splice(_0x2b061b, 1);
      _0x41ac84.resolve({
        ok: false,
        canceled: true
      });
      emitQueueState();
      return {
        ok: true
      };
    }
    const _0x5c1e70 = dlActive.get(_0x1c78fe);
    if (_0x5c1e70) {
      _0x5c1e70.abort = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download:canceled", {
          gameId: _0x1c78fe
        });
      }
      return {
        ok: true
      };
    }
    return {
      ok: false,
      error: "Nicht in der Warteschlange."
    };
  });
  ipcMain.handle("download:set-concurrency", (_0x4e4338, _0x5037f7) => {
    dlConcurrency = Math.max(1, Math.min(3, Number(_0x5037f7) || 1));
    pumpQueue();
    return {
      ok: true,
      concurrency: dlConcurrency
    };
  });
  ipcMain.handle("download:get-concurrency", () => ({
    ok: true,
    concurrency: dlConcurrency
  }));
  ipcMain.handle("disk:list", async () => await listFixedDrives());
  ipcMain.handle("vc:installed", async () => loadSettings().vcInstalled || {});
  ipcMain.handle("game:uninstall", async (_0x254c94, {
    platform: _0xc5fd2f,
    id: _0x9389a7,
    appid: _0x5400d7,
    gameId: _0x5d2f3e
  } = {}) => {
    try {
      const _0x1b4b3e = String(_0xc5fd2f || "viscode");
      if (_0x1b4b3e === "viscode") {
        const _0x5de0dd = loadSettings();
        const _0x4e9f8a = String(_0x5d2f3e || _0x9389a7);
        const _0x46ab0c = (_0x5de0dd.vcInstalled || {})[_0x4e9f8a];
        if (!_0x46ab0c || !_0x46ab0c.dir) {
          return {
            ok: false,
            error: "Kein installiertes VisCode-Spiel gefunden."
          };
        }
        const _0x509796 = _0x46ab0c.dir;
        const _0x2fed2e = /VisCode Games/i.test(_0x509796) || _0x46ab0c.exe && String(_0x46ab0c.exe).startsWith(_0x509796);
        if (!fs.existsSync(_0x509796)) {
          if (_0x5de0dd.vcInstalled) {
            delete _0x5de0dd.vcInstalled[_0x4e9f8a];
            saveSettings(_0x5de0dd);
          }
          return {
            ok: true,
            note: "Eintrag entfernt (Ordner war nicht mehr vorhanden)."
          };
        }
        if (!_0x2fed2e) {
          return {
            ok: false,
            error: "Ordner sieht nicht wie ein VisCode-Spielordner aus."
          };
        }
        fs.rmSync(_0x509796, {
          recursive: true,
          force: true
        });
        if (_0x46ab0c.shortcut) {
          try {
            fs.rmSync(_0x46ab0c.shortcut, {
              force: true
            });
          } catch {}
        }
        if (_0x5de0dd.vcInstalled) {
          delete _0x5de0dd.vcInstalled[_0x4e9f8a];
          saveSettings(_0x5de0dd);
        }
        return {
          ok: true
        };
      }
      if (_0x1b4b3e === "steam" && _0x5400d7) {
        await shell.openExternal("steam://uninstall/" + encodeURIComponent(_0x5400d7));
        return {
          ok: true,
          manual: true,
          hint: "Steam öffnet den Deinstallations-Dialog."
        };
      }
      if (_0x1b4b3e === "epic") {
        await shell.openExternal("com.epicgames.launcher://apps");
        return {
          ok: true,
          manual: true,
          hint: "In Epic beim Spiel auf „Deinstallieren\"."
        };
      }
      await shell.openExternal("ms-settings:appsfeatures");
      return {
        ok: true,
        manual: true,
        hint: "In den Windows-Apps das Spiel deinstallieren."
      };
    } catch (_0x3d624e) {
      return {
        ok: false,
        error: _0x3d624e && _0x3d624e.message || "Deinstallation fehlgeschlagen."
      };
    }
  });
  ipcMain.handle("vc:launch", async (_0x4c7a67, {
    gameId: _0x2bb763,
    path: _0xea8715,
    title: _0x246366
  } = {}) => {
    const _0x49ca2c = loadSettings();
    const _0x51343d = _0x49ca2c.vcInstalled && _0x49ca2c.vcInstalled[_0x2bb763] || {};
    const _0x1e2c7e = await verifyOwnership(_0x2bb763);
    const _0x4f15d5 = _0x51343d.ownedVerifiedAt;
    if (_0x1e2c7e.owned === false) {
      if (_0x49ca2c.vcInstalled && _0x49ca2c.vcInstalled[_0x2bb763] && _0x49ca2c.vcInstalled[_0x2bb763].ownedVerifiedAt) {
        delete _0x49ca2c.vcInstalled[_0x2bb763].ownedVerifiedAt;
        saveSettings(_0x49ca2c);
      }
      return {
        ok: false,
        notOwned: true,
        error: "VisCode: Game nicht in Besitz."
      };
    }
    if (_0x1e2c7e.owned === null && !_0x4f15d5) {
      return {
        ok: false,
        error: "Konnte den Besitz nicht prüfen – bitte einmal online starten."
      };
    }
    if (_0x1e2c7e.owned === true) {
      _0x49ca2c.vcInstalled = _0x49ca2c.vcInstalled || {};
      _0x49ca2c.vcInstalled[_0x2bb763] = {
        ...(_0x49ca2c.vcInstalled[_0x2bb763] || {}),
        ownedVerifiedAt: Date.now(),
        ...(_0x1e2c7e.entry && _0x1e2c7e.entry.licenseKey ? {
          licenseKey: _0x1e2c7e.entry.licenseKey
        } : {}),
        ...(_0x1e2c7e.entry && _0x1e2c7e.entry.executable ? {
          executable: _0x1e2c7e.entry.executable
        } : {})
      };
      saveSettings(_0x49ca2c);
    }
    try {
      let _0xac3496 = _0x51343d.exe;
      if (_0x1e2c7e.owned === true && _0x1e2c7e.entry && _0x1e2c7e.entry.executable && _0x51343d.dir && fs.existsSync(_0x51343d.dir)) {
        const _0x2e69d6 = String(_0x1e2c7e.entry.executable).replace(/\\/g, "/");
        if (!/(^|\/)\.\.(\/|$)/.test(_0x2e69d6)) {
          const _0x3d84cf = path.join(_0x51343d.dir, _0x2e69d6);
          if (fs.existsSync(_0x3d84cf)) {
            _0xac3496 = _0x3d84cf;
            _0x49ca2c.vcInstalled = _0x49ca2c.vcInstalled || {};
            _0x49ca2c.vcInstalled[_0x2bb763] = {
              ...(_0x49ca2c.vcInstalled[_0x2bb763] || {}),
              exe: _0xac3496,
              title: _0x246366 || _0x51343d.title || _0x2bb763
            };
            saveSettings(_0x49ca2c);
          }
        }
      }
      if ((!_0xac3496 || !fs.existsSync(_0xac3496)) && _0x51343d.dir && fs.existsSync(_0x51343d.dir)) {
        _0xac3496 = findGameExe(_0x51343d.dir);
        if (_0xac3496) {
          _0x49ca2c.vcInstalled = _0x49ca2c.vcInstalled || {};
          _0x49ca2c.vcInstalled[_0x2bb763] = {
            ...(_0x49ca2c.vcInstalled[_0x2bb763] || {}),
            exe: _0xac3496,
            title: _0x246366 || _0x51343d.title || _0x2bb763
          };
          saveSettings(_0x49ca2c);
        }
      }
      if (!_0xac3496 || !fs.existsSync(_0xac3496)) {
        const _0xb947da = _0xea8715 || _0x51343d.zip;
        if (!_0xb947da || !fs.existsSync(_0xb947da)) {
          return {
            ok: false,
            error: "Spieldatei nicht gefunden – bitte erneut herunterladen."
          };
        }
        if (/\.zip$/i.test(_0xb947da)) {
          const _0x1cef20 = _0xb947da.replace(/\.zip$/i, "") + "_game";
          if (!fs.existsSync(_0x1cef20) || !fs.readdirSync(_0x1cef20).length) {
            fs.mkdirSync(_0x1cef20, {
              recursive: true
            });
            await new Promise((_0x212e95, _0x4f9548) => {
              if (IS_WIN) {
                execFile("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "Expand-Archive -LiteralPath " + JSON.stringify(_0xb947da) + " -DestinationPath " + JSON.stringify(_0x1cef20) + " -Force"], {
                  windowsHide: true
                }, _0x4fd098 => _0x4fd098 ? _0x4f9548(_0x4fd098) : _0x212e95());
              } else {
                execFile("unzip", ["-o", _0xb947da, "-d", _0x1cef20], _0x4fd098 => _0x4fd098 ? _0x4f9548(_0x4fd098) : _0x212e95());
              }
            });
          }
          _0xac3496 = findGameExe(_0x1cef20);
        } else if (/\.exe$/i.test(_0xb947da)) {
          _0xac3496 = _0xb947da;
        } else {
          _0xac3496 = findGameExe(path.dirname(_0xb947da));
        }
        if (!_0xac3496) {
          return {
            ok: false,
            error: "Keine ausführbare Datei (.exe) im Spiel gefunden."
          };
        }
        _0x49ca2c.vcInstalled = _0x49ca2c.vcInstalled || {};
        _0x49ca2c.vcInstalled[_0x2bb763] = {
          ...(_0x49ca2c.vcInstalled[_0x2bb763] || {}),
          exe: _0xac3496,
          zip: (_0x49ca2c.vcInstalled[_0x2bb763] || {}).zip || _0xb947da,
          title: _0x246366 || _0x51343d.title || _0x2bb763
        };
        saveSettings(_0x49ca2c);
      }
      const _0x165ecb = spawn(_0xac3496, [], {
        detached: true,
        stdio: "ignore",
        cwd: path.dirname(_0xac3496)
      });
      vcChildren[_0x2bb763] = _0x165ecb;
      _0x165ecb.on("exit", () => {
        delete vcChildren[_0x2bb763];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("vc:game-exited", {
            gameId: _0x2bb763
          });
        }
      });
      _0x165ecb.on("error", () => {
        delete vcChildren[_0x2bb763];
      });
      return {
        ok: true,
        exe: _0xac3496
      };
    } catch (_0x4609fd) {
      return {
        ok: false,
        error: "Start fehlgeschlagen: " + _0x4609fd.message
      };
    }
  });
  ipcMain.handle("vc:kill", async (_0x407a09, _0x6b1b8d) => {
    const _0x2f00af = vcChildren[String(_0x6b1b8d)];
    try {
      if (_0x2f00af && !_0x2f00af.killed) {
        _0x2f00af.kill();
      }
    } catch {}
    return {
      ok: true
    };
  });
  ipcMain.handle("license:download", async (_0x1cb9f5, _0x5a5366) => {
    const _0x2b17de = loadSettings();
    const _0x29ad7b = (_0x2b17de.apiBaseUrl || "").replace(/\/$/, "");
    const _0x3e2cbc = _0x5a5366 && _0x5a5366.licenseId || _0x5a5366;
    if (!_0x29ad7b || !_0x2b17de.sessionToken || !_0x3e2cbc) {
      return {
        ok: false
      };
    }
    try {
      const _0x3933c1 = _0x29ad7b + "/removed" + encodeURIComponent(_0x3e2cbc);
      const _0x2113e7 = await fetch(_0x3933c1, {
        headers: {
          Authorization: "Bearer " + _0x2b17de.sessionToken,
          ...watermarkHeaders(_0x3933c1)
        }
      });
      if (!_0x2113e7.ok) {
        return {
          ok: false,
          status: _0x2113e7.status
        };
      }
      const _0x4c9b87 = await _0x2113e7.text();
      const _0x48de38 = {
        licenseId: _0x3e2cbc,
        gameId: _0x5a5366 && _0x5a5366.gameId || null,
        userId: _0x2b17de.user && _0x2b17de.user.id,
        licenseKey: _0x5a5366 && _0x5a5366.licenseKey || "",
        certificate: _0x4c9b87,
        downloadedAt: Date.now()
      };
      const _0x4d6d34 = path.join(licensesDir(), _0x3e2cbc + ".vis");
      fs.writeFileSync(_0x4d6d34, visEncode(_0x48de38), "utf8");
      return {
        ok: true,
        path: _0x4d6d34
      };
    } catch (_0x4fcfae) {
      return {
        ok: false,
        error: _0x4fcfae.message
      };
    }
  });
  ipcMain.handle("license:save", (_0x505929, _0x361ffa) => {
    if (!istEigenerRenderer(_0x505929)) {
      return {
        ok: false
      };
    }
    if (!_0x361ffa || !_0x361ffa.licenseId) {
      return {
        ok: false
      };
    }
    if (typeof _0x361ffa.licenseId !== "string" || !/^[A-Za-z0-9_\-]+$/.test(_0x361ffa.licenseId)) {
      return {
        ok: false,
        error: "Ungültige License-ID."
      };
    }
    try {
      fs.writeFileSync(path.join(licensesDir(), _0x361ffa.licenseId + ".vis"), visEncode(_0x361ffa), "utf8");
      return {
        ok: true
      };
    } catch (_0x3bc651) {
      return {
        ok: false,
        error: _0x3bc651.message
      };
    }
  });
  ipcMain.handle("license:read", (_0x6304da, _0x212861) => {
    if (typeof _0x212861 !== "string" || !/^[A-Za-z0-9_\-]+$/.test(_0x212861)) {
      return null;
    }
    try {
      return visDecode(fs.readFileSync(path.join(licensesDir(), _0x212861 + ".vis"), "utf8"));
    } catch {
      return null;
    }
  });
  ipcMain.handle("license:list", () => {
    try {
      return fs.readdirSync(licensesDir()).filter(_0x17c067 => _0x17c067.endsWith(".vis")).map(_0x19794d => {
        try {
          return visDecode(fs.readFileSync(path.join(licensesDir(), _0x19794d), "utf8"));
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  });
  ipcMain.handle("wallet:get", async () => {
    const _0xa4bb2e = loadSettings();
    const _0xae2eeb = _0xa4bb2e.user && _0xa4bb2e.user.id;
    if (!_0xae2eeb) {
      return {
        ok: false,
        balance: _0xa4bb2e.user && _0xa4bb2e.user.balance || 0
      };
    }
    const _0x39979f = await socialApi("GET", "/removed/" + encodeURIComponent(_0xae2eeb) + "/balance");
    if (_0x39979f && _0x39979f.ok && _0x39979f.data) {
      const _0x2c91e2 = typeof _0x39979f.data === "number" ? _0x39979f.data : _0x39979f.data.balance ?? null;
      return {
        ok: true,
        balance: Number(_0x2c91e2) || 0
      };
    }
    return {
      ok: false,
      balance: _0xa4bb2e.user && _0xa4bb2e.user.balance || 0,
      offline: !!_0x39979f && !!_0x39979f.offline
    };
  });
  ipcMain.handle("wallet:change", async (_0x24f703, _0x3529b4) => {
    const _0x243345 = loadSettings();
    const _0x5b67d7 = _0x243345.user && _0x243345.user.id;
    if (!_0x5b67d7) {
      return {
        ok: false,
        error: "Nicht angemeldet."
      };
    }
    const _0x38af41 = await socialApi("POST", "/removed/balance/change", {
      userId: _0x5b67d7,
      amount: _0x3529b4
    });
    if (_0x38af41 && _0x38af41.ok) {
      const _0x463084 = _0x38af41.data && (_0x38af41.data.balance ?? (typeof _0x38af41.data === "number" ? _0x38af41.data : null));
      if (_0x243345.user && _0x463084 != null) {
        _0x243345.user.balance = Number(_0x463084);
        saveSettings(_0x243345);
      }
      return {
        ok: true,
        balance: _0x463084 != null ? Number(_0x463084) : null
      };
    }
    return {
      ok: false,
      error: _0x38af41 && _0x38af41.data && _0x38af41.data.error || "Guthaben-Änderung fehlgeschlagen",
      offline: !!_0x38af41 && !!_0x38af41.offline
    };
  });
  ipcMain.handle("settings:set", (_0xb76be2, _0xd269fe) => {
    if (!istEigenerRenderer(_0xb76be2)) {
      return loadSettings();
    }
    const _0x2settin = {
      ...(_0xd269fe || {})
    };
    for (const _0xk of PROTECTED_SETTINGS_KEYS) {
      if (_0xk in _0x2settin) {
        delete _0x2settin[_0xk];
      }
    }
    const _0x5afe7e = {
      ...loadSettings(),
      ..._0x2settin
    };
    saveSettings(_0x5afe7e);
    return _0x5afe7e;
  });
  ipcMain.handle("window:setGlass", (_0xev, _0xon) => {
    if (!istEigenerRenderer(_0xev)) {
      return {
        ok: false
      };
    }
    return applyMainWindowGlass(!!_0xon);
  });
  // Eigene Titelleiste (Fenster ist rahmenlos)
  ipcMain.handle("window:control", (_0xev, _0xaktion) => {
    if (!istEigenerRenderer(_0xev) || !mainWindow || mainWindow.isDestroyed()) {
      return {
        ok: false
      };
    }
    if (_0xaktion === "minimize") {
      mainWindow.minimize();
    } else if (_0xaktion === "maximize") {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    } else if (_0xaktion === "close") {
      mainWindow.close();
    }
    return {
      ok: true,
      maximized: mainWindow.isMaximized()
    };
  });
  ipcMain.handle("window:setOpacity", (_0xev, _0xwert) => {
    if (!istEigenerRenderer(_0xev) || !mainWindow || mainWindow.isDestroyed()) {
      return {
        ok: false
      };
    }
    const _0xop = Math.max(0.5, Math.min(1, Number(_0xwert) || 1));
    try {
      if (Math.abs(mainWindow.getOpacity() - _0xop) > 0.001) {
        mainWindow.setOpacity(_0xop);
      }
    } catch {}
    return {
      ok: true
    };
  });
  ipcMain.handle("perf:placeholder", _0xev => {
    if (!istEigenerRenderer(_0xev)) {
      return {
        ok: false
      };
    }
    return perfPlaceholderRead();
  });
  ipcMain.handle("perf:purge", async _0xev => {
    if (!istEigenerRenderer(_0xev)) {
      return {
        ok: false
      };
    }
    await perfPurgeCaches();
    return {
      ok: true
    };
  });
  ipcMain.on("perf:slept", _0xev => {
    if (!istEigenerRenderer(_0xev)) {
      return;
    }
    if (typeof _perfSleepWait === "function") {
      _perfSleepWait();
    }
  });
  ipcMain.handle("game:launch", async (_0x50cd6f, _0x5882c4) => {
    if (!istEigenerRenderer(_0x50cd6f)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    // Direkter Start über einen fertigen launchUri (z. B. aus launcherscan.js).
    if (_0x5882c4 && typeof _0x5882c4.launchUri === "string" && _0x5882c4.launchUri.trim()) {
      const _0xlu = _0x5882c4.launchUri.trim();
      try {
        // Ein Protokoll-Link (steam://, itch://, goggalaxy:// ...) geht an openExternal.
        // Ein nackter Dateipfad (z. B. eine gescannte .exe von itch/custom) MUSS ueber
        // shell.openPath laufen - openExternal startet keine lokale .exe zuverlaessig.
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(_0xlu)) {
          await shell.openExternal(_0xlu);
        } else {
          const _0xfehlerLu = await shell.openPath(_0xlu);
          if (_0xfehlerLu) {
            return { ok: false, error: _0xfehlerLu };
          }
        }
        return {
          ok: true
        };
      } catch (_0xluErr) {
        return {
          ok: false,
          error: _0xluErr && _0xluErr.message ? _0xluErr.message : String(_0xluErr)
        };
      }
    }
    if (_0x5882c4.platform === "steam") {
      await shell.openExternal("steam://rungameid/" + _0x5882c4.id);
      return {
        ok: true
      };
    }
    if (_0x5882c4.platform === "epic") {
      const _0x1d2239 = _0x5882c4.catalogNamespace && _0x5882c4.catalogItemId ? _0x5882c4.catalogNamespace + "%3A" + _0x5882c4.catalogItemId + "%3A" + _0x5882c4.id : _0x5882c4.id;
      await shell.openExternal("com.epicgames.launcher://apps/" + _0x1d2239 + "?action=launch&silent=true");
      return {
        ok: true
      };
    }
    if (_0x5882c4.platform === "ubisoft") {
      await shell.openExternal("uplay://launch/" + _0x5882c4.id + "/0");
      return {
        ok: true
      };
    }
    if (_0x5882c4.platform === "gog") {
      // Nur lokal installierte GOG-Spiele lassen sich starten.
      const _0xexeGLa = _0x5882c4.exePath || "";
      if (_0xexeGLa && fs.existsSync(_0xexeGLa)) {
        const _0xfehlerGLa = await shell.openPath(_0xexeGLa);
        if (_0xfehlerGLa) {
          return {
            ok: false,
            error: "GOG-Spiel konnte nicht gestartet werden: " + _0xfehlerGLa
          };
        }
        return {
          ok: true
        };
      }
      if (_0x5882c4.id) {
        await shell.openExternal("goggalaxy://openGameView/" + encodeURIComponent(String(_0x5882c4.id)));
        return {
          ok: true,
          detail: "In GOG Galaxy geöffnet"
        };
      }
      return {
        ok: false,
        error: "Dieses GOG-Spiel ist nicht installiert."
      };
    }
    if (_0x5882c4.platform === "ea") {
      await shell.openExternal("origin://launchgame/" + _0x5882c4.id);
      return {
        ok: true
      };
    }
    if (_0x5882c4.platform === "viscode" && _0x5882c4.exePath) {
      if (!fs.existsSync(_0x5882c4.exePath) || !istBekannterExePfad(_0x5882c4.exePath)) {
        return {
          ok: false,
          error: "Pfad nicht erlaubt oder Spiel nicht bekannt."
        };
      }
      try {
        if (!IS_WIN) {
          fs.chmodSync(_0x5882c4.exePath, 0o755);
        }
      } catch {}
      spawn(_0x5882c4.exePath, [], {
        detached: true,
        stdio: "ignore",
        // Eigenes Vystra-Spiel: voller Launch-Handshake inkl. Nutzer/Session (Auto-Login).
        env: vlLaunchEnv(_0x5882c4, true)
      }).unref();
      return {
        ok: true
      };
    }
    if ((_0x5882c4.platform === "manual" || _0x5882c4.platform === "microsoft") && _0x5882c4.exePath) {
      if (!fs.existsSync(_0x5882c4.exePath)) {
        return {
          ok: false,
          error: "Datei nicht gefunden – wurde das Spiel verschoben?"
        };
      }
      if (!istBekannterExePfad(_0x5882c4.exePath)) {
        return {
          ok: false,
          error: "Pfad nicht erlaubt oder Spiel nicht bekannt."
        };
      }
      const _0x285832 = _0x5882c4.installPath && fs.existsSync(_0x5882c4.installPath) ? _0x5882c4.installPath : path.dirname(_0x5882c4.exePath);
      try {
        if (!IS_WIN) {
          fs.chmodSync(_0x5882c4.exePath, 0o755);
        }
      } catch {}
      spawn(_0x5882c4.exePath, [], {
        detached: true,
        stdio: "ignore",
        cwd: _0x285832,
        // Selbst hinzugefuegte/fremde App: nur Start-Merker + oeffentliche Identitaet,
        // BEWUSST ohne Session-Token.
        env: vlLaunchEnv(_0x5882c4, false)
      }).unref();
      return {
        ok: true
      };
    }
    if (_0x5882c4.platform === "xbox" && _0x5882c4.productId) {
      await shell.openExternal("msxbox://game/?productId=" + encodeURIComponent(String(_0x5882c4.productId)));
      return { ok: true, detail: "In der Xbox-App geöffnet" };
    }
    if (_0x5882c4.platform === "microsoft" && _0x5882c4.appid) {
      if (!IS_WIN) {
        return {
          ok: false,
          error: "Nur unter Windows verfügbar"
        };
      }
      await shell.openExternal("shell:AppsFolder\\" + _0x5882c4.appid);
      return {
        ok: true
      };
    }
    return {
      ok: false,
      error: "Unbekannte Plattform"
    };
  });
  ipcMain.handle("game:running", async (_0x59f18c, _0x690944) => await isGameRunning(_0x690944));
  ipcMain.handle("game:kill", async (_0x483449, _0x8d01fc) => await killGame(_0x8d01fc));
  ipcMain.handle("game:install", async (_0x4e9a6c, _0x445560) => {
    if (_0x445560.platform === "steam") {
      await shell.openExternal("steam://install/" + _0x445560.id);
      return {
        ok: true
      };
    }
    if (_0x445560.platform === "epic") {
      await shell.openExternal("com.epicgames.launcher://apps/" + _0x445560.id + "?action=install");
      return {
        ok: true
      };
    }
    if (_0x445560.platform === "xbox" || _0x445560.platform === "microsoft") {
      const _0xxiPid = String(_0x445560.productId || (/^[0-9A-Z]{12}$/.test(String(_0x445560.id || "")) ? _0x445560.id : "")).trim();
      if (!_0xxiPid) {
        await shell.openExternal("xbox://");
        return { ok: true, detail: "Xbox-App geöffnet" };
      }
      try {
        await shell.openExternal("msxbox://game/?productId=" + encodeURIComponent(_0xxiPid));
      } catch {
        await shell.openExternal("ms-windows-store://pdp/?ProductId=" + encodeURIComponent(_0xxiPid));
      }
      return { ok: true, detail: "In der Xbox-App geöffnet" };
    }
    if (_0x445560.platform === "xbox" || _0x445560.platform === "microsoft") {
      if (!IS_WIN) {
        return { ok: false, error: "Nur unter Windows verfügbar" };
      }
      const _0xxbPid = _0x445560.productId || (/^[0-9A-Z]{12}$/.test(String(_0x445560.id || "")) ? _0x445560.id : "");
      if (_0xxbPid) {
        await shell.openExternal("msxbox://game/?productId=" + encodeURIComponent(_0xxbPid));
        return { ok: true, detail: "In der Xbox-App geöffnet" };
      }
      await shell.openExternal("ms-windows-store://search/?query=" + encodeURIComponent(String(_0x445560.title || "")));
      return { ok: true, detail: "Im Microsoft Store gesucht" };
    }
    if (_0x445560.platform === "gog") {
      // GOG installiert nur ueber Galaxy bzw. die Shop-Seite.
      await shell.openExternal("goggalaxy://openGameView/" + encodeURIComponent(String(_0x445560.id || "")));
      return {
        ok: true,
        detail: "In GOG Galaxy geöffnet"
      };
    }
    return {
      ok: false
    };
  });
  ipcMain.handle("steam:libraries", async () => {
    const _0x13c02c = await findSteamPath();
    if (!_0x13c02c) {
      return [];
    }
    const _0x37af77 = steamLibraries(_0x13c02c);
    let _0x29c288 = {};
    try {
      const _0x27e29c = await psJson("Get-PSDrive -PSProvider FileSystem | ForEach-Object { [PSCustomObject]@{ root=$_.Root; free=[double]$_.Free; used=[double]$_.Used } } | ConvertTo-Json -Compress");
      for (const _0x42f853 of _0x27e29c) {
        if (_0x42f853 && _0x42f853.root) {
          _0x29c288[String(_0x42f853.root).toUpperCase()] = {
            free: Number(_0x42f853.free) || 0,
            total: (Number(_0x42f853.free) || 0) + (Number(_0x42f853.used) || 0)
          };
        }
      }
    } catch {}
    return _0x37af77.map(_0x5a1c2c => {
      const _0x5c61fd = path.parse(_0x5a1c2c).root;
      const _0x46089b = _0x29c288[_0x5c61fd.toUpperCase()] || {};
      return {
        path: _0x5a1c2c,
        drive: _0x5c61fd,
        freeBytes: _0x46089b.free || 0,
        totalBytes: _0x46089b.total || 0
      };
    });
  });
  ipcMain.handle("steam:install-progress", async (_0x5a7349, _0x2af320) => {
    const _0x42328d = await findSteamPath();
    if (!_0x42328d) {
      return {
        found: false
      };
    }
    for (const _0x3dc327 of steamLibraries(_0x42328d)) {
      const _0x41ab1c = path.join(_0x3dc327, "steamapps", "appmanifest_" + _0x2af320 + ".acf");
      if (!fs.existsSync(_0x41ab1c)) {
        continue;
      }
      let _0xd43239;
      try {
        _0xd43239 = fs.readFileSync(_0x41ab1c, "utf8");
      } catch {
        continue;
      }
      const _0x2954ef = parseInt(parseVdfValue(_0xd43239, "StateFlags") || "0", 10);
      const _0x291e26 = parseInt(parseVdfValue(_0xd43239, "BytesDownloaded") || "0", 10);
      const _0x3ce5d4 = parseInt(parseVdfValue(_0xd43239, "BytesToDownload") || "0", 10);
      const _0x44de16 = (_0x2954ef & 4) === 4 && _0x3ce5d4 <= _0x291e26;
      const _0x179f2a = _0x3ce5d4 > 0 ? Math.min(100, Math.round(_0x291e26 / _0x3ce5d4 * 100)) : _0x44de16 ? 100 : 0;
      return {
        found: true,
        fullyInstalled: _0x44de16,
        downloading: !_0x44de16,
        percent: _0x179f2a,
        bytesDownloaded: _0x291e26,
        bytesTotal: _0x3ce5d4
      };
    }
    return {
      found: false
    };
  });
  ipcMain.handle("game:buy", async (_0x22614f, _0x5b6e61) => {
    if (_0x5b6e61.platform === "steam") {
      const _0x8b80ff = await findSteamPath();
      const _0x26a4e2 = _0x5b6e61.storeUrl || "https://store.steampowered.com/app/" + _0x5b6e61.id;
      await shell.openExternal(_0x8b80ff ? "steam://openurl/" + _0x26a4e2 : _0x26a4e2);
      return {
        ok: true
      };
    }
    await shell.openExternal(_0x5b6e61.storeUrl || "https://store.epicgames.com/de/");
    return {
      ok: true
    };
  });
  ipcMain.handle("platform:start", async (_0x8d7186, _0x52a097) => {
    if (_0x52a097 === "steam") {
      if (!IS_WIN) {
        await shell.openExternal("steam://open/main");
        return {
          ok: true
        };
      }
      const _0x15cba1 = await findSteamPath();
      if (!_0x15cba1) {
        return {
          ok: false,
          error: "Steam nicht gefunden"
        };
      }
      spawn(path.join(_0x15cba1, "steam.exe"), ["-silent"], {
        detached: true,
        stdio: "ignore"
      }).unref();
      return {
        ok: true
      };
    }
    if (_0x52a097 === "epic") {
      if (!IS_WIN) {
        await shell.openExternal("com.epicgames.launcher://apps");
        return {
          ok: true
        };
      }
      const _0x4ea4ea = await findEpicLauncherExe();
      if (!_0x4ea4ea) {
        return {
          ok: false,
          error: "Epic Games Launcher nicht gefunden"
        };
      }
      spawn(_0x4ea4ea, ["-silent"], {
        detached: true,
        stdio: "ignore"
      }).unref();
      return {
        ok: true
      };
    }
    return {
      ok: false
    };
  });
  ipcMain.handle("accounts:export", (_0x5ba36d, _0x1a722c) => {
    try {
      const _0x3c862b = (Array.isArray(_0x1a722c) ? _0x1a722c : []).map(_0x1c44ea => ({
        id: _0x1c44ea.id || _0x1c44ea.user_id || null,
        username: _0x1c44ea.username || null,
        displayName: _0x1c44ea.displayName || _0x1c44ea.username || null,
        email: _0x1c44ea.email || null,
        avatar: _0x1c44ea.avatar || null,
        provider: _0x1c44ea.provider || null
      })).filter(_0x22b7b6 => _0x22b7b6.id && _0x22b7b6.email);
      const _0x24c308 = path.join(app.getPath("userData"), "quick-accounts.json");
      fs.writeFileSync(_0x24c308, JSON.stringify({
        accounts: _0x3c862b,
        updated: Math.floor(Date.now() / 1000)
      }, null, 2), "utf8");
      return {
        ok: true,
        count: _0x3c862b.length
      };
    } catch (_0x2362b5) {
      return {
        ok: false,
        error: _0x2362b5.message
      };
    }
  });
  ipcMain.handle("open:external", async (_0x147440, _0x291ff3) => {
    if (typeof _0x291ff3 === "string" && /^(https?:\/\/|mailto:)/i.test(_0x291ff3)) {
      await shell.openExternal(_0x291ff3);
      return {
        ok: true
      };
    }
    return {
      ok: false
    };
  });
  // ── Vystra VR ───────────────────────────────────────────────────────────────
  ipcMain.handle("vr:status", async _0xvrsEv => {
    if (!istEigenerRenderer(_0xvrsEv)) {
      return {
        ok: false,
        steamVrInstalled: false,
        steamVrRunning: false,
        steamPath: null
      };
    }
    try {
      return await vrStatus();
    } catch (_0xvrsErr) {
      return {
        ok: false,
        steamVrInstalled: false,
        steamVrRunning: false,
        steamPath: null,
        error: _0xvrsErr && _0xvrsErr.message ? _0xvrsErr.message : String(_0xvrsErr)
      };
    }
  });
  ipcMain.handle("vr:scan", async _0xvrscEv => {
    if (!istEigenerRenderer(_0xvrscEv)) {
      return {
        ok: false,
        games: []
      };
    }
    try {
      return await vrScanGames();
    } catch (_0xvrscErr) {
      return {
        ok: false,
        games: [],
        error: _0xvrscErr && _0xvrscErr.message ? _0xvrscErr.message : String(_0xvrscErr)
      };
    }
  });
  ipcMain.handle("vr:open-steamvr", async (_0xvroEv, _0xvroArg) => {
    if (!istEigenerRenderer(_0xvroEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xmode = _0xvroArg && typeof _0xvroArg === "object" ? _0xvroArg.mode : _0xvroArg;
    let _0xlink;
    if (_0xmode === "install") {
      _0xlink = "steam://install/" + VR_STEAMVR_APPID;
    } else if (_0xmode === "pair") {
      _0xlink = "steam://run/" + VR_STEAMVR_APPID + "//pair";
    } else {
      _0xlink = "steam://run/" + VR_STEAMVR_APPID;
    }
    try {
      await shell.openExternal(_0xlink);
      return {
        ok: true,
        link: _0xlink
      };
    } catch (_0xvroErr) {
      // Fallback: bei „pair" wenigstens SteamVR normal starten.
      if (_0xmode === "pair") {
        try {
          await shell.openExternal("steam://run/" + VR_STEAMVR_APPID);
          return {
            ok: true,
            link: "steam://run/" + VR_STEAMVR_APPID,
            fallback: true
          };
        } catch {}
      }
      return {
        ok: false,
        error: _0xvroErr && _0xvroErr.message ? _0xvroErr.message : String(_0xvroErr)
      };
    }
  });
  ipcMain.handle("vr:launch-game", async (_0xvrlEv, _0xvrlArg) => {
    if (!istEigenerRenderer(_0xvrlEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xappid = _0xvrlArg && typeof _0xvrlArg === "object" ? _0xvrlArg.appid : _0xvrlArg;
    // Gemeinsame Umsetzung mit der LAN-Bruecke, damit beide Wege identisch starten.
    return await vrSpielStarten(_0xappid);
  });
  ipcMain.handle("vr:pair-code", async _0xvrpcEv => {
    if (!istEigenerRenderer(_0xvrpcEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xvrpc = vrAktuellerPairingCode();
    return {
      ok: true,
      code: _0xvrpc.code,
      gueltigBis: _0xvrpc.gueltigBis
    };
  });
  ipcMain.handle("vr:pair-neu", async _0xvrpnEv => {
    if (!istEigenerRenderer(_0xvrpnEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xvrpn = vrNeuerPairingCode();
    return {
      ok: true,
      code: _0xvrpn.code,
      gueltigBis: _0xvrpn.gueltigBis
    };
  });
  ipcMain.handle("vr:geraete", async _0xvrgeEv => {
    if (!istEigenerRenderer(_0xvrgeEv)) {
      return {
        ok: false,
        geraete: []
      };
    }
    // Der Token bleibt bewusst im Hauptprozess - die Oberflaeche braucht ihn nie,
    // und was nie im Renderer liegt, kann dort auch nicht abfliessen.
    return {
      ok: true,
      geraete: vrGeraeteLesen().map(_0xvrgeG => ({
        id: _0xvrgeG.id,
        name: _0xvrgeG.name,
        gekoppeltAm: _0xvrgeG.gekoppeltAm
      }))
    };
  });
  ipcMain.handle("vr:geraet-entfernen", async (_0xvrgxEv, _0xvrgxArg) => {
    if (!istEigenerRenderer(_0xvrgxEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xvrgxId = _0xvrgxArg && typeof _0xvrgxArg === "object" ? _0xvrgxArg.id : _0xvrgxArg;
    vrGeraeteSchreiben(vrGeraeteLesen().filter(_0xvrgxG => _0xvrgxG && _0xvrgxG.id !== _0xvrgxId));
    vrCacheGeraeteAuffrischen();
    return {
      ok: true
    };
  });
  // ── Meta Quest Sideload ─────────────────────────────────────────────────────
  ipcMain.handle("quest:detect", async _0xqdEv => {
    if (!istEigenerRenderer(_0xqdEv)) {
      return {
        ok: false,
        geraete: []
      };
    }
    try {
      return await questGeraeteErmitteln();
    } catch (_0xqdErr) {
      return {
        ok: false,
        geraete: [],
        error: _0xqdErr && _0xqdErr.message ? _0xqdErr.message : String(_0xqdErr)
      };
    }
  });
  ipcMain.handle("quest:install", async (_0xqiEv, _0xqiArg) => {
    if (!istEigenerRenderer(_0xqiEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      let _0xserial = null;
      if (_0xqiArg && typeof _0xqiArg === "object") {
        _0xserial = typeof _0xqiArg.serial === "string" ? _0xqiArg.serial : null;
      } else if (typeof _0xqiArg === "string") {
        _0xserial = _0xqiArg;
      }
      return await questInstallApk(_0xserial || null);
    } catch (_0xqiErr) {
      return {
        ok: false,
        error: _0xqiErr && _0xqiErr.message ? _0xqiErr.message : String(_0xqiErr)
      };
    }
  });
  ipcMain.handle("quest:open-guide", async _0xqgEv => {
    if (!istEigenerRenderer(_0xqgEv)) {
      return {
        ok: false
      };
    }
    try {
      await shell.openExternal("https://developer.oculus.com/documentation/native/android/mobile-device-setup/");
      return {
        ok: true
      };
    } catch (_0xqgErr) {
      return {
        ok: false,
        error: _0xqgErr && _0xqgErr.message ? _0xqgErr.message : String(_0xqgErr)
      };
    }
  });
  ipcMain.handle("open:appbrowser", (_0xevAb, _0xurlAb) => openAppBrowser(_0xurlAb));
  // ── Web zu App: Metadaten laden (Titel + bestes Icon → dataURL) ─────────────
  ipcMain.handle("webapp:fetch-meta", async (_0xwmEv, _0xwmUrl) => {
    if (!istEigenerRenderer(_0xwmEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    let _0xurl = typeof _0xwmUrl === "string" ? _0xwmUrl.trim() : "";
    if (_0xurl && !/^https?:\/\//i.test(_0xurl)) {
      _0xurl = "https://" + _0xurl;
    }
    if (!/^https?:\/\//i.test(_0xurl)) {
      return {
        ok: false,
        error: "Ungültige URL (nur http/https)."
      };
    }
    const _0xctrl = new AbortController();
    const _0xtmr = setTimeout(() => _0xctrl.abort(), 8000);
    try {
      let _0xres;
      try {
        _0xres = await fetch(_0xurl, {
          redirect: "follow",
          signal: _0xctrl.signal,
          headers: {
            "User-Agent": WEBAPP_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        });
      } finally {
        clearTimeout(_0xtmr);
      }
      const _0xfinalUrl = _0xres && _0xres.url ? _0xres.url : _0xurl;
      let _0xhost = "";
      try {
        _0xhost = new URL(_0xfinalUrl).hostname.replace(/^www\./i, "");
      } catch {}
      let _0xhtml = "";
      try {
        _0xhtml = await _0xres.text();
      } catch {}
      _0xhtml = (_0xhtml || "").slice(0, 600000);
      const _0xogSite = _0xwebAppMeta(_0xhtml, "og:site_name");
      const _0xogTitle = _0xwebAppMeta(_0xhtml, "og:title");
      const _0xtMatch = _0xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const _0xtitleTag = _0xtMatch ? _0xtMatch[1].replace(/\s+/g, " ") : "";
      const _0xtitle = _0xdecodeEntities(_0xogSite || _0xogTitle || _0xtitleTag || _0xhost) || _0xhost;
      const _0xapple = [];
      const _0xicons = [];
      const _0xlinkTags = _0xhtml.match(/<link\b[^>]*>/gi) || [];
      for (const _0xlt of _0xlinkTags) {
        const _0xrel = _0xwebAppAttr(_0xlt, "rel").toLowerCase();
        const _0xhref = _0xwebAppAttr(_0xlt, "href");
        if (!_0xhref || !_0xrel.includes("icon")) {
          continue;
        }
        if (_0xrel.includes("apple-touch-icon")) {
          _0xapple.push(_0xhref);
        } else {
          _0xicons.push(_0xhref);
        }
      }
      const _0xogImg = _0xwebAppMeta(_0xhtml, "og:image");
      const _0xcands = [];
      _0xapple.forEach(_0xx => _0xcands.push(_0xx));
      if (_0xogImg) {
        _0xcands.push(_0xogImg);
      }
      _0xicons.forEach(_0xx => _0xcands.push(_0xx));
      _0xcands.push("/favicon.ico");
      const _0xiconDataUrl = await fetchWebAppIcon(_0xcands, _0xfinalUrl);
      // Absolute Bild-URLs für die Bibliotheks-Kachel (Logo/Banner/Vorschau).
      const _0xtoAbs = _0xu => {
        try {
          return new URL(_0xu, _0xfinalUrl).toString();
        } catch {
          return "";
        }
      };
      let _0xlogo = "";
      for (const _0xcl of _0xapple.concat(_0xicons)) {
        const _0xab = _0xtoAbs(_0xcl);
        if (/^https?:\/\//i.test(_0xab)) {
          _0xlogo = _0xab;
          break;
        }
      }
      const _0xbanner = _0xogImg ? _0xtoAbs(_0xogImg) : "";
      const _0ximages = [];
      const _0xpushImg = _0xu => {
        if (_0ximages.length >= 4) {
          return;
        }
        const _0xab = _0xtoAbs(_0xu);
        if (/^https?:\/\//i.test(_0xab) && !_0ximages.includes(_0xab)) {
          _0ximages.push(_0xab);
        }
      };
      if (_0xbanner) {
        _0xpushImg(_0xbanner);
      }
      const _0ximgTags = _0xhtml.match(/<img\b[^>]*>/gi) || [];
      for (const _0xig of _0ximgTags) {
        if (_0ximages.length >= 4) {
          break;
        }
        const _0xsrc = _0xwebAppAttr(_0xig, "src") || _0xwebAppAttr(_0xig, "data-src");
        if (_0xsrc && !/^data:/i.test(_0xsrc)) {
          _0xpushImg(_0xsrc);
        }
      }
      return {
        ok: true,
        title: _0xtitle,
        iconDataUrl: _0xiconDataUrl,
        logo: _0xlogo || _0xbanner || "",
        banner: _0xbanner || _0xlogo || "",
        images: _0ximages,
        url: _0xfinalUrl
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.name === "AbortError" ? "Zeitüberschreitung beim Laden der Seite." : _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Web zu App: Standalone-.exe-Web-App anlegen ─────────────────────────────
  // Legt userData/webapps/<id>/ an mit einer Kopie der Template-.exe (der Stub
  // liest url.txt daneben und öffnet die Seite in Edge-Vollbild), einer url.txt
  // sowie lokal gesicherten Bildern (Logo/Banner/bis 4 Vorschaubilder). Der
  // Eintrag wird in settings.webApps upsertet (nach id) und zurückgegeben.
  // Rückwärtskompatibel: alte iconDataUrl wird als Logo verwendet; ein bereits
  // von der alten UI vorab gepushter Eintrag mit gleicher id wird ergänzt.
  ipcMain.handle("webapp:create", async (_0xwcEv, _0xwcArg) => {
    if (!istEigenerRenderer(_0xwcEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xwcArg || {};
      const _0xurl = typeof _0xa.url === "string" ? _0xa.url.trim() : "";
      const _0xname = (typeof _0xa.name === "string" && _0xa.name.trim() ? _0xa.name.trim() : "Web App").slice(0, 80);
      if (!/^https?:\/\//i.test(_0xurl)) {
        return {
          ok: false,
          error: "Ungültige URL (nur http/https)."
        };
      }
      const _0xid = (String(_0xa.id || "wa_" + Date.now().toString(36)).replace(/[^A-Za-z0-9_\-]+/g, "")) || "wa" + Date.now();
      const _0xsafe = _0xname.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "WebApp";
      const _0xtpl = webAppTemplateExe();
      if (!_0xtpl) {
        return {
          ok: false,
          error: "Vorlage VystraWebApp.exe nicht gefunden."
        };
      }
      const _0xfolder = path.join(app.getPath("userData"), "webapps", _0xid);
      try {
        fs.mkdirSync(_0xfolder, {
          recursive: true
        });
      } catch {}
      const _0xexePath = path.join(_0xfolder, _0xsafe + ".exe");
      try {
        fs.copyFileSync(_0xtpl, _0xexePath);
      } catch (_0xce) {
        return {
          ok: false,
          error: "Konnte Vorlage nicht kopieren: " + (_0xce && _0xce.message ? _0xce.message : String(_0xce))
        };
      }
      try {
        fs.writeFileSync(path.join(_0xfolder, "url.txt"), _0xurl + "\n", "utf8");
      } catch {}
      // Ad-Blocker-Extension mitkopieren (liegt neben der Vorlage-.exe) -> Web-App ist werbefrei.
      try {
        const _0xadbSrc = path.join(path.dirname(_0xtpl), "adblock");
        if (fs.existsSync(_0xadbSrc)) {
          fs.cpSync(_0xadbSrc, path.join(_0xfolder, "adblock"), { recursive: true });
        }
      } catch {}
      // Medien lokal sichern; Rückgabe = data:-URL (bibliotheks-tauglich unter CSP).
      let _0xlogo = "";
      const _0xlogoSrc = typeof _0xa.logo === "string" && _0xa.logo ? _0xa.logo : typeof _0xa.iconDataUrl === "string" && _0xa.iconDataUrl ? _0xa.iconDataUrl : "";
      if (_0xlogoSrc) {
        const _0xr = await webAppSaveMedia(_0xlogoSrc, _0xfolder, "logo", 700000);
        if (_0xr) {
          _0xlogo = _0xr.dataUrl || "";
        }
      }
      let _0xbanner = "";
      if (typeof _0xa.banner === "string" && _0xa.banner) {
        const _0xr = await webAppSaveMedia(_0xa.banner, _0xfolder, "banner", 1500000);
        if (_0xr) {
          _0xbanner = _0xr.dataUrl || "";
        }
      }
      const _0ximages = [];
      if (Array.isArray(_0xa.images)) {
        let _0xi = 0;
        for (const _0xim of _0xa.images) {
          if (_0xi >= 4) {
            break;
          }
          const _0xr = await webAppSaveMedia(_0xim, _0xfolder, "img" + _0xi, 1200000);
          if (_0xr && _0xr.dataUrl) {
            _0ximages.push(_0xr.dataUrl);
            _0xi++;
          }
        }
      }
      const _0xentry = {
        id: _0xid,
        name: _0xname,
        url: _0xurl,
        folder: _0xfolder,
        exePath: _0xexePath,
        logo: _0xlogo,
        banner: _0xbanner || _0xlogo,
        images: _0ximages,
        createdAt: Date.now()
      };
      // In settings.webApps upserten (nach id), vorhandene Felder erhalten.
      try {
        const _0xs = loadSettings();
        const _0xarr = Array.isArray(_0xs.webApps) ? _0xs.webApps.slice() : [];
        const _0xidx = _0xarr.findIndex(_0xx => _0xx && _0xx.id === _0xid);
        if (_0xidx >= 0) {
          _0xarr[_0xidx] = {
            ..._0xarr[_0xidx],
            ..._0xentry
          };
        } else {
          _0xarr.push(_0xentry);
        }
        _0xs.webApps = _0xarr;
        saveSettings(_0xs);
      } catch {}
      let _0xdesk = null;
      try {
        _0xdesk = copyWebStubToDesktop(_0xname, _0xurl, _0xlogo);
      } catch {
        _0xdesk = null;
      }
      return {
        ok: true,
        path: _0xdesk && _0xdesk.path ? _0xdesk.path : _0xexePath,
        desktopPath: _0xdesk && _0xdesk.path || "",
        ..._0xentry
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Web zu App: Liste aller Standalone-Web-Apps ─────────────────────────────
  ipcMain.handle("webapp:list", _0xwlEv => {
    if (!istEigenerRenderer(_0xwlEv)) {
      return {
        ok: false,
        apps: [],
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xs = loadSettings();
      const _0xarr = Array.isArray(_0xs.webApps) ? _0xs.webApps : [];
      return {
        ok: true,
        apps: _0xarr
      };
    } catch (_0xe) {
      return {
        ok: false,
        apps: [],
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Web zu App: Standalone-.exe der Web-App starten ─────────────────────────
  ipcMain.handle("webapp:launch", async (_0xwlEv, _0xwlArg) => {
    if (!istEigenerRenderer(_0xwlEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xwlArg || {};
      const _0xid = String(_0xa.id == null ? "" : _0xa.id).trim();
      const _0xs = loadSettings();
      const _0xarr = Array.isArray(_0xs.webApps) ? _0xs.webApps : [];
      const _0xe = _0xarr.find(_0xx => _0xx && _0xx.id === _0xid);
      if (!_0xe || !_0xe.exePath) {
        return {
          ok: false,
          error: "Web-App nicht gefunden."
        };
      }
      if (!fs.existsSync(_0xe.exePath)) {
        return {
          ok: false,
          error: "Programmdatei fehlt – Web-App bitte neu erstellen."
        };
      }
      const _0xerr = await shell.openPath(_0xe.exePath);
      if (_0xerr) {
        try {
          const _0xchild = spawn(_0xe.exePath, [], {
            detached: true,
            stdio: "ignore",
            cwd: _0xe.folder || path.dirname(_0xe.exePath)
          });
          _0xchild.unref();
        } catch (_0xspErr) {
          return {
            ok: false,
            error: _0xerr
          };
        }
      }
      return {
        ok: true
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Web zu App: Desktop-Verknüpfung auf die Standalone-.exe ─────────────────
  ipcMain.handle("webapp:create-shortcut", async (_0xwsEv, _0xwsArg) => {
    if (!istEigenerRenderer(_0xwsEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xwsArg || {};
      const _0xid = String(_0xa.id == null ? "" : _0xa.id).trim();
      const _0xs = loadSettings();
      const _0xarr = Array.isArray(_0xs.webApps) ? _0xs.webApps.slice() : [];
      const _0xidx = _0xarr.findIndex(_0xx => _0xx && _0xx.id === _0xid);
      const _0xe = _0xidx >= 0 ? _0xarr[_0xidx] : null;
      if (!_0xe || !_0xe.exePath) {
        return {
          ok: false,
          error: "Web-App nicht gefunden."
        };
      }
      const _0xname = (typeof _0xe.name === "string" && _0xe.name.trim() ? _0xe.name.trim() : "Web App").slice(0, 80);
      const _0xsafe = _0xname.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "WebApp";
      // Icon (.ico) aus dem Logo erzeugen, damit die Verknüpfung hübsch aussieht.
      // Das Logo kann eine data:-URL ODER eine http(s)-URL (Favicon der Seite)
      // sein. Frueher wurde NUR die data:-Variante beruecksichtigt – bei einer
      // http(s)-URL entstand keine .ico und die Verknuepfung blieb ohne Icon.
      // Deshalb bei http(s) die Bytes ueber den vorhandenen Helfer webAppSaveMedia
      // holen (kein neuer Netzcode) und daraus per nativeImage ein PNG erzeugen.
      // Alles defensiv: schlaegt irgendein Schritt fehl, bleibt _0xicoPath leer
      // und die Verknuepfung faellt weiter unten auf das exePath-Icon zurueck.
      let _0xicoPath = "";
      if (IS_WIN && typeof _0xe.logo === "string" && _0xe.logo) {
        try {
          const _0xicoDir = _0xe.folder || path.dirname(_0xe.exePath);
          let _0xpngBuf = null;
          if (/^data:image\//i.test(_0xe.logo)) {
            const _0ximg = nativeImage.createFromDataURL(_0xe.logo);
            if (_0ximg && !_0ximg.isEmpty()) {
              _0xpngBuf = _0ximg.toPNG();
            }
          } else if (/^https?:\/\//i.test(_0xe.logo)) {
            // Favicon der Seite: erst laden+speichern, dann als Bild einlesen.
            // webAppSaveMedia bringt eigenes Zeitlimit mit und wirft nie.
            const _0xmedia = await webAppSaveMedia(_0xe.logo, _0xicoDir, "logo_quelle", 0);
            if (_0xmedia) {
              let _0ximgH = null;
              if (_0xmedia.file && fs.existsSync(_0xmedia.file)) {
                // createFromPath dekodiert PNG/JPG/… – SVG kann es nicht, dann
                // bleibt das Bild leer und wir fallen sauber zurueck.
                _0ximgH = nativeImage.createFromPath(_0xmedia.file);
              }
              if ((!_0ximgH || _0ximgH.isEmpty()) && typeof _0xmedia.dataUrl === "string" && /^data:image\//i.test(_0xmedia.dataUrl)) {
                _0ximgH = nativeImage.createFromDataURL(_0xmedia.dataUrl);
              }
              if (_0ximgH && !_0ximgH.isEmpty()) {
                _0xpngBuf = _0ximgH.toPNG();
              }
            }
          }
          if (_0xpngBuf && _0xpngBuf.length) {
            const _0xicoBuf = pngBufferToIco(_0xpngBuf);
            _0xicoPath = path.join(_0xicoDir, "icon.ico");
            fs.writeFileSync(_0xicoPath, _0xicoBuf);
          }
        } catch {
          _0xicoPath = "";
        }
      }
      if (IS_WIN) {
        const _0xlnk = path.join(app.getPath("desktop"), _0xsafe + ".lnk");
        const _0xpsEsc = _0xs2 => String(_0xs2).replace(/'/g, "''");
        const _0xiconLoc = _0xicoPath || _0xe.exePath;
        const _0xcmd = "$ws=New-Object -ComObject WScript.Shell;" + "$s=$ws.CreateShortcut('" + _0xpsEsc(_0xlnk) + "');" + "$s.TargetPath='" + _0xpsEsc(_0xe.exePath) + "';" + "$s.WorkingDirectory='" + _0xpsEsc(_0xe.folder || path.dirname(_0xe.exePath)) + "';" + "$s.IconLocation='" + _0xpsEsc(_0xiconLoc) + "';" + "$s.Description='" + _0xpsEsc(_0xname) + "';" + "$s.Save()";
        return await new Promise(_0xresolve => {
          execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", _0xcmd], {
            windowsHide: true
          }, _0xerr => {
            if (_0xerr) {
              _0xresolve({
                ok: false,
                error: _0xerr && _0xerr.message ? _0xerr.message : String(_0xerr)
              });
            } else {
              try {
                _0xarr[_0xidx] = {
                  ..._0xe,
                  shortcutPath: _0xlnk
                };
                _0xs.webApps = _0xarr;
                saveSettings(_0xs);
              } catch {}
              _0xresolve({
                ok: true,
                path: _0xlnk
              });
            }
          });
        });
      }
      const _0xdesktop = app.getPath("desktop");
      try {
        fs.mkdirSync(_0xdesktop, {
          recursive: true
        });
      } catch {}
      const _0xdf = path.join(_0xdesktop, _0xsafe + ".desktop");
      const _0xexec = String(_0xe.exePath).replace(/ /g, "\\ ");
      const _0xcontent = "[Desktop Entry]\n" + "Type=Application\n" + "Name=" + _0xname + "\n" + "Exec=" + _0xexec + "\n" + "Terminal=false\n" + "Categories=Network;\n";
      fs.writeFileSync(_0xdf, _0xcontent, "utf8");
      try {
        fs.chmodSync(_0xdf, 0o755);
      } catch {}
      try {
        _0xarr[_0xidx] = {
          ..._0xe,
          shortcutPath: _0xdf
        };
        _0xs.webApps = _0xarr;
        saveSettings(_0xs);
      } catch {}
      return {
        ok: true,
        path: _0xdf
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Web zu App: Web-App deinstallieren (Ordner + Eintrag + Verknüpfung) ──────
  ipcMain.handle("webapp:uninstall", async (_0xwuEv, _0xwuArg) => {
    if (!istEigenerRenderer(_0xwuEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xwuArg || {};
      const _0xid = String(_0xa.id == null ? "" : _0xa.id).trim();
      if (!_0xid) {
        return {
          ok: false,
          error: "Keine Web-App-ID."
        };
      }
      const _0xs = loadSettings();
      const _0xarr = Array.isArray(_0xs.webApps) ? _0xs.webApps : [];
      const _0xe = _0xarr.find(_0xx => _0xx && _0xx.id === _0xid);
      const _0xfolder = _0xe && _0xe.folder ? _0xe.folder : path.join(app.getPath("userData"), "webapps", _0xid);
      // Sicherheitsnetz: nur innerhalb userData/webapps löschen.
      const _0xroot = path.join(app.getPath("userData"), "webapps");
      try {
        if (_0xfolder && _0xfolder.startsWith(_0xroot) && fs.existsSync(_0xfolder)) {
          fs.rmSync(_0xfolder, {
            recursive: true,
            force: true
          });
        }
      } catch {}
      if (_0xe && _0xe.shortcutPath) {
        try {
          if (fs.existsSync(_0xe.shortcutPath)) {
            fs.rmSync(_0xe.shortcutPath, {
              force: true
            });
          }
        } catch {}
      }
      try {
        _0xs.webApps = _0xarr.filter(_0xx => !(_0xx && _0xx.id === _0xid));
        saveSettings(_0xs);
      } catch {}
      return {
        ok: true
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  ipcMain.handle("webapp:desktop-from-links", async (_0xev, _0xarg) => {
    if (!istEigenerRenderer(_0xev)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xlinks = _0xarg && Array.isArray(_0xarg.links) ? _0xarg.links : [];
    const _0xout = [];
    for (const _0xl of _0xlinks) {
      if (!_0xl || typeof _0xl.url !== "string" || !_0xl.url.trim()) {
        continue;
      }
      const _0xr = copyWebStubToDesktop(_0xl.name || "Web", _0xl.url.trim(), _0xl.icon || "");
      _0xout.push({
        name: _0xl.name || "",
        ..._0xr
      });
    }
    return {
      ok: true,
      count: _0xout.filter(_0xr => _0xr.ok).length,
      results: _0xout
    };
  });
  // ── Web zu App: Eintrag aktualisieren (Name und/oder Kategorie) ─────────────
  ipcMain.handle("webapp:update", (_0xwupEv, _0xwupArg) => {
    if (!istEigenerRenderer(_0xwupEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xwupArg || {};
      const _0xid = String(_0xa.id == null ? "" : _0xa.id).trim();
      if (!_0xid) {
        return {
          ok: false,
          error: "Keine Web-App-ID."
        };
      }
      const _0xs = loadSettings();
      const _0xarr = Array.isArray(_0xs.webApps) ? _0xs.webApps.slice() : [];
      const _0xidx = _0xarr.findIndex(_0xx => _0xx && _0xx.id === _0xid);
      if (_0xidx < 0) {
        return {
          ok: false,
          error: "Web-App nicht gefunden."
        };
      }
      const _0xnext = {
        ..._0xarr[_0xidx]
      };
      if (typeof _0xa.name === "string" && _0xa.name.trim()) {
        _0xnext.name = _0xa.name.trim().slice(0, 80);
      }
      if (typeof _0xa.category === "string") {
        _0xnext.category = _0xa.category.trim().slice(0, 60);
      }
      _0xarr[_0xidx] = _0xnext;
      _0xs.webApps = _0xarr;
      saveSettings(_0xs);
      return {
        ok: true,
        app: _0xnext
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Spiel-Verknüpfung auf dem Desktop erstellen (aus lokalem Launcher-Scan) ──
  // Baut eine .lnk, die das Spiel per launchUri (steam://, com.epicgames.launcher://,
  // shell:AppsFolder\… usw.) startet. TargetPath = explorer.exe, damit KEIN
  // Konsolenfenster aufblitzt und explorer das Protokoll/Ziel auflöst.
  ipcMain.handle("game:createShortcut", async (_0xgcsEv, _0xgcsArg) => {
    if (!istEigenerRenderer(_0xgcsEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xgcsArg || {};
      const _0xname = (typeof _0xa.name === "string" && _0xa.name.trim() ? _0xa.name.trim() : "Spiel").slice(0, 80);
      const _0xuri = typeof _0xa.launchUri === "string" ? _0xa.launchUri.trim() : "";
      if (!_0xuri) {
        return {
          ok: false,
          error: "Kein Start-Link (launchUri) übergeben."
        };
      }
      if (!IS_WIN) {
        return {
          ok: false,
          error: "Spiel-Verknüpfungen werden nur unter Windows unterstützt."
        };
      }
      const _0xsafe = _0xname.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "Spiel";
      const _0xlnk = path.join(app.getPath("desktop"), _0xsafe + ".lnk");
      const _0xexplorer = path.join(process.env.WINDIR || process.env.SystemRoot || "C:\\Windows", "explorer.exe");
      const _0xiconLoc = typeof _0xa.iconPath === "string" && _0xa.iconPath.trim() ? _0xa.iconPath.trim() : process.execPath;
      const _0xpsEsc = _0xs => String(_0xs).replace(/'/g, "''");
      const _0xcmd = "$ws=New-Object -ComObject WScript.Shell;" + "$s=$ws.CreateShortcut('" + _0xpsEsc(_0xlnk) + "');" + "$s.TargetPath='" + _0xpsEsc(_0xexplorer) + "';" + "$s.Arguments='\"" + _0xpsEsc(_0xuri) + "\"';" + "$s.WorkingDirectory='" + _0xpsEsc(path.dirname(_0xexplorer)) + "';" + "$s.IconLocation='" + _0xpsEsc(_0xiconLoc) + "';" + "$s.Description='" + _0xpsEsc(_0xname) + "';" + "$s.Save()";
      return await new Promise(_0xresolve => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", _0xcmd], {
          windowsHide: true
        }, _0xerr => {
          if (_0xerr) {
            _0xresolve({
              ok: false,
              error: _0xerr && _0xerr.message ? _0xerr.message : String(_0xerr)
            });
          } else {
            _0xresolve({
              ok: true,
              path: _0xlnk
            });
          }
        });
      });
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Natives Vystra-Spiel: Desktop-Verknüpfung erstellen ─────────────────────
  // Baut eine .lnk (Windows) bzw. .desktop (Linux), die den Launcher selbst
  // (process.execPath) mit dem Deep-Link viscode://launch/<gameId> startet.
  // findDeepLinkInArgv() erkennt den Link beim Start bzw. in second-instance und
  // die vorhandene native Start-Logik (launchVcGame) uebernimmt das Spiel.
  ipcMain.handle("game:createNativeShortcut", async (_0xgnsEv, _0xgnsArg) => {
    if (!istEigenerRenderer(_0xgnsEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xgnsArg || {};
      const _0xgameId = String(_0xa.gameId == null ? "" : _0xa.gameId).trim();
      if (!_0xgameId) {
        return {
          ok: false,
          error: "Keine gameId übergeben."
        };
      }
      const _0xname = (typeof _0xa.name === "string" && _0xa.name.trim() ? _0xa.name.trim() : "Spiel").slice(0, 80);
      const _0xuri = "viscode://launch/" + encodeURIComponent(_0xgameId);
      const _0xsafe = _0xname.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "Spiel";
      const _0xiconLoc = typeof _0xa.iconPath === "string" && _0xa.iconPath.trim() ? _0xa.iconPath.trim() : process.execPath;
      if (IS_WIN) {
        const _0xlnk = path.join(app.getPath("desktop"), _0xsafe + ".lnk");
        const _0xpsEsc = _0xs => String(_0xs).replace(/'/g, "''");
        const _0xcmd = "$ws=New-Object -ComObject WScript.Shell;" + "$s=$ws.CreateShortcut('" + _0xpsEsc(_0xlnk) + "');" + "$s.TargetPath='" + _0xpsEsc(process.execPath) + "';" + "$s.Arguments='\"" + _0xpsEsc(_0xuri) + "\"';" + "$s.WorkingDirectory='" + _0xpsEsc(path.dirname(process.execPath)) + "';" + "$s.IconLocation='" + _0xpsEsc(_0xiconLoc) + "';" + "$s.Description='" + _0xpsEsc(_0xname) + "';" + "$s.Save()";
        return await new Promise(_0xresolve => {
          execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", _0xcmd], {
            windowsHide: true
          }, _0xerr => {
            if (_0xerr) {
              _0xresolve({
                ok: false,
                error: _0xerr && _0xerr.message ? _0xerr.message : String(_0xerr)
              });
            } else {
              _0xresolve({
                ok: true,
                path: _0xlnk
              });
            }
          });
        });
      }
      const _0xdesktop = app.getPath("desktop");
      try {
        fs.mkdirSync(_0xdesktop, {
          recursive: true
        });
      } catch {}
      const _0xdf = path.join(_0xdesktop, _0xsafe + ".desktop");
      const _0xexec = process.execPath.replace(/ /g, "\\ ");
      const _0xcontent = "[Desktop Entry]\n" + "Type=Application\n" + "Name=" + _0xname + "\n" + "Exec=" + _0xexec + " " + _0xuri + "\n" + (_0xiconLoc && _0xiconLoc !== process.execPath ? "Icon=" + _0xiconLoc + "\n" : "") + "Terminal=false\n" + "Categories=Game;\n";
      fs.writeFileSync(_0xdf, _0xcontent, "utf8");
      try {
        fs.chmodSync(_0xdf, 0o755);
      } catch {}
      return {
        ok: true,
        path: _0xdf
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // ── Lobby-Einladung annehmen: dem laufenden Spiel die Lobby zuspielen ───────
  //    Nur der eigene Renderer darf das (Guard). Broadcastet an alle verbundenen
  //    Spiele; das passende Spiel filtert selbst per gameId. Reine lokale Weitergabe.
  ipcMain.handle("game:join-lobby", (_0xjlEv, _0xjlArg) => {
    if (!istEigenerRenderer(_0xjlEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xjlArg || {};
      const _0xgameId = _0xa.gameId != null ? String(_0xa.gameId) : null;
      const _0xlobby = _0xa.lobby && typeof _0xa.lobby === "object" ? _0xa.lobby : null;
      const _0xhost = _0xa.host && typeof _0xa.host === "object" ? _0xa.host : null;
      if (!_0xlobby || _0xlobby.id == null || _0xlobby.id === "") {
        return {
          ok: false,
          error: "bad_request"
        };
      }
      broadcastToGames({
        type: "joinLobby",
        gameId: _0xgameId,
        lobby: _0xlobby,
        host: _0xhost
      });
      return {
        ok: true
      };
    } catch (_0xjlErr) {
      return {
        ok: false,
        error: _0xjlErr && _0xjlErr.message ? _0xjlErr.message : String(_0xjlErr)
      };
    }
  });
  // ── Web zu App: in dediziertem App-Fenster öffnen ───────────────────────────
  ipcMain.handle("webapp:open", (_0xwoEv, _0xwoArg) => {
    if (!istEigenerRenderer(_0xwoEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xa = _0xwoArg || {};
    return openWebAppWindow(typeof _0xa.url === "string" ? _0xa.url : "", _0xa.name || "", _0xa.icon || "");
  });
  // ── Auto-Dunkelfunktion von Chromium fuer eine einzelne Ansicht ────────────
  // Warum ueberhaupt der Debugger: Chromium rechnet Farben bei seiner eigenen
  // Auto-Dunkelfunktion richtig um (Bilder bleiben unangetastet, Kontraste
  // stimmen) statt die Seite bloss zu invertieren. Schalten laesst sie sich je
  // Ansicht nur ueber das DevTools-Protokoll - es gibt keinen anderen Weg. Der
  // app-weite Schalter scheidet aus: er wuerde auch die eigene Oberflaeche des
  // Launchers umfaerben, und die ist bereits dunkel - sie wuerde dadurch hell.
  ipcMain.handle("web:autodunkel", async (ereignis, _0xadArg) => {
    if (!istEigenerRenderer(ereignis)) {
      return {
        ok: false,
        fehler: "Nicht autorisiert."
      };
    }
    const _0xa = _0xadArg || {};
    const _0xziel = webContents.fromId(Number(_0xa.webContentsId));
    if (!_0xziel) {
      return {
        ok: false,
        fehler: "Ansicht nicht gefunden."
      };
    }
    try {
      // attach scheitert, wenn schon ein Debugger haengt - vor allem dann,
      // wenn der Nutzer die Entwicklerwerkzeuge offen hat. Das ist zu erwarten
      // und darf nichts kaputtmachen: entweder haengen wir bereits selbst dran
      // (dann geht der Befehl unten durch) oder DevTools blockieren (dann
      // faellt der Aufrufer auf den CSS-Weg zurueck).
      try {
        _0xziel.debugger.attach("1.3");
      } catch (_0xadAttachErr) {}
      await _0xziel.debugger.sendCommand("Emulation.setAutoDarkModeOverride", {
        enabled: !!_0xa.an
      });
      if (_0xa.an === false) {
        // Beim Abschalten wieder loesen: ein dauerhaft angehaengter Debugger
        // sperrt die Entwicklerwerkzeuge fuer diese Ansicht aus.
        try {
          _0xziel.debugger.detach();
        } catch (_0xadDetachErr) {}
      }
      return {
        ok: true
      };
    } catch (_0xadErr) {
      return {
        ok: false,
        fehler: _0xadErr && _0xadErr.message ? _0xadErr.message : String(_0xadErr)
      };
    }
  });
  // ── Autostart: Spiel mit Windows starten ───────────────────────────────────
  // Geschrieben wird ausschliesslich in den Autostart-Ordner des angemeldeten
  // Nutzers (%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup).
  // Dafuer sind KEINE Administratorrechte noetig – nur ein systemweiter
  // Autostart (HKLM bzw. ProgramData) wuerde welche brauchen, den nutzen wir nicht.
  ipcMain.handle("autostart:status", async (_0xasEv, _0xasArg) => {
    if (!istEigenerRenderer(_0xasEv)) {
      return {
        ok: false,
        aktiv: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xasArg || {};
      const _0xid = String(_0xa.id === undefined || _0xa.id === null ? "" : _0xa.id).trim();
      if (!_0xid) {
        return {
          ok: false,
          aktiv: false,
          error: "Keine Spiel-ID."
        };
      }
      const _0xdatei = autostartDateiPfad(_0xa.name || _0xid);
      const _0xgemerkt = (loadSettings().autostartFiles || {})[_0xid] || "";
      let _0xaktiv = false;
      let _0xtreffer = "";
      for (const _0xk of [_0xgemerkt, _0xdatei]) {
        if (!_0xk) {
          continue;
        }
        try {
          if (fs.existsSync(_0xk)) {
            _0xaktiv = true;
            _0xtreffer = _0xk;
            break;
          }
        } catch {}
      }
      return {
        ok: true,
        aktiv: _0xaktiv,
        datei: _0xtreffer || _0xdatei || ""
      };
    } catch (_0xe) {
      return {
        ok: false,
        aktiv: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  ipcMain.handle("autostart:set", async (_0xa2Ev, _0xa2Arg) => {
    if (!istEigenerRenderer(_0xa2Ev)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    try {
      const _0xa = _0xa2Arg || {};
      const _0xid = String(_0xa.id === undefined || _0xa.id === null ? "" : _0xa.id).trim();
      if (!_0xid) {
        return {
          ok: false,
          error: "Keine Spiel-ID."
        };
      }
      const _0xname = String(_0xa.name || "Spiel").trim() || "Spiel";
      const _0xdatei = autostartDateiPfad(_0xname);
      if (!_0xdatei) {
        return {
          ok: false,
          error: "Ungültiger Name für die Verknüpfung."
        };
      }
      const _0xein = !!_0xa.aktiv;
      const _0xset = loadSettings();
      const _0xmap = {
        ...(_0xset.autostartFiles || {})
      };
      if (!_0xein) {
        // Aus: gemerkte UND abgeleitete Verknüpfung entfernen
        for (const _0xk of [_0xmap[_0xid], _0xdatei]) {
          if (!_0xk) {
            continue;
          }
          try {
            if (fs.existsSync(_0xk)) {
              fs.unlinkSync(_0xk);
            }
          } catch (_0xdelE) {
            return {
              ok: false,
              error: "Verknüpfung konnte nicht gelöscht werden: " + (_0xdelE && _0xdelE.message ? _0xdelE.message : String(_0xdelE))
            };
          }
        }
        delete _0xmap[_0xid];
        _0xset.autostartFiles = _0xmap;
        saveSettings(_0xset);
        return {
          ok: true,
          aktiv: false
        };
      }
      // Ein: Ziel bestimmen
      const _0xplat = String(_0xa.plattform || "").toLowerCase();
      let _0xziel = typeof _0xa.ziel === "string" ? _0xa.ziel.trim() : "";
      let _0xargs = typeof _0xa.argumente === "string" ? _0xa.argumente.trim() : "";
      if (!_0xziel && _0xplat === "steam") {
        // steam://-Adressen taugen NICHT als Verknüpfungsziel → steam.exe -applaunch <appid>
        const _0xappid = String(_0xa.steamAppId === undefined || _0xa.steamAppId === null ? _0xid : _0xa.steamAppId).replace(/[^0-9]/g, "");
        if (!_0xappid) {
          return {
            ok: false,
            error: "Keine gültige Steam-App-ID."
          };
        }
        const _0xsteam = await findSteamPath();
        if (!_0xsteam) {
          return {
            ok: false,
            error: "Steam wurde nicht gefunden (Registry-Eintrag fehlt)."
          };
        }
        const _0xsteamExe = path.join(_0xsteam, IS_WIN ? "steam.exe" : "steam.sh");
        if (!fs.existsSync(_0xsteamExe)) {
          return {
            ok: false,
            error: "steam.exe wurde nicht gefunden."
          };
        }
        _0xziel = _0xsteamExe;
        _0xargs = "-applaunch " + _0xappid;
      }
      if (!_0xziel && _0xplat === "viscode") {
        const _0xinst = (_0xset.vcInstalled || {})[_0xid] || {};
        if (_0xinst.exe && fs.existsSync(_0xinst.exe)) {
          _0xziel = _0xinst.exe;
        } else if (_0xinst.dir && fs.existsSync(_0xinst.dir)) {
          _0xziel = findGameExe(_0xinst.dir) || "";
        }
      }
      if (!_0xziel) {
        return {
          ok: false,
          error: "Für dieses Spiel ist kein Startpfad bekannt."
        };
      }
      if (!fs.existsSync(_0xziel)) {
        return {
          ok: false,
          error: "Startdatei nicht gefunden – wurde das Spiel verschoben?"
        };
      }
      let _0xcwd = typeof _0xa.arbeitsverzeichnis === "string" ? _0xa.arbeitsverzeichnis.trim() : "";
      if (!_0xcwd || !fs.existsSync(_0xcwd)) {
        _0xcwd = path.dirname(_0xziel);
      }
      let _0xicon = typeof _0xa.icon === "string" ? _0xa.icon.trim() : "";
      if (!_0xicon || !fs.existsSync(_0xicon)) {
        _0xicon = _0xziel;
      }
      try {
        fs.mkdirSync(path.dirname(_0xdatei), {
          recursive: true
        });
      } catch {}
      // Alte Verknüpfung mit anderem Namen (Spiel umbenannt) aufräumen
      if (_0xmap[_0xid] && _0xmap[_0xid] !== _0xdatei) {
        try {
          if (fs.existsSync(_0xmap[_0xid])) {
            fs.unlinkSync(_0xmap[_0xid]);
          }
        } catch {}
      }
      if (IS_WIN) {
        const _0xpsEsc = _0xs => String(_0xs).replace(/'/g, "''");
        const _0xcmd = "$ws=New-Object -ComObject WScript.Shell;" + "$s=$ws.CreateShortcut('" + _0xpsEsc(_0xdatei) + "');" + "$s.TargetPath='" + _0xpsEsc(_0xziel) + "';" + (_0xargs ? "$s.Arguments='" + _0xpsEsc(_0xargs) + "';" : "") + "$s.WorkingDirectory='" + _0xpsEsc(_0xcwd) + "';" + "$s.IconLocation='" + _0xpsEsc(_0xicon) + "';" + "$s.Description='" + _0xpsEsc("Vystra Autostart: " + _0xname) + "';" + "$s.Save()";
        const _0xres = await new Promise(_0xresolve => {
          execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", _0xcmd], {
            windowsHide: true
          }, _0xerr => {
            if (_0xerr) {
              _0xresolve({
                ok: false,
                error: _0xerr && _0xerr.message ? _0xerr.message : String(_0xerr)
              });
            } else {
              _0xresolve({
                ok: true
              });
            }
          });
        });
        if (!_0xres.ok) {
          return _0xres;
        }
        if (!fs.existsSync(_0xdatei)) {
          return {
            ok: false,
            error: "Verknüpfung wurde nicht angelegt."
          };
        }
      } else {
        const _0xexec = _0xziel.replace(/ /g, "\\ ") + (_0xargs ? " " + _0xargs : "");
        const _0xinhalt = "[Desktop Entry]\n" + "Type=Application\n" + "Name=Vystra - " + _0xname + "\n" + "Exec=" + _0xexec + "\n" + "Path=" + _0xcwd + "\n" + "Terminal=false\n" + "Categories=Game;\n";
        fs.writeFileSync(_0xdatei, _0xinhalt, "utf8");
        try {
          fs.chmodSync(_0xdatei, 0o755);
        } catch {}
      }
      _0xmap[_0xid] = _0xdatei;
      _0xset.autostartFiles = _0xmap;
      saveSettings(_0xset);
      return {
        ok: true,
        aktiv: true,
        datei: _0xdatei
      };
    } catch (_0xe) {
      return {
        ok: false,
        error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
      };
    }
  });
  // Kurzer Erreichbarkeits-Test fuer eine externe Adresse (kein CORS im Main).
  // Wird u. a. vom "Öffentliches Profil"-Bereich genutzt, bevor der Cloud-Editor
  // in einem eigenen Fenster geoeffnet wird.
  ipcMain.handle("net:reachable", async (_0xnrEv, _0xnrArg) => {
    if (!istEigenerRenderer(_0xnrEv)) {
      return {
        ok: false,
        error: "Nicht autorisiert."
      };
    }
    const _0xnrA = typeof _0xnrArg === "string" ? {
      url: _0xnrArg
    } : _0xnrArg || {};
    const _0xnrUrl = typeof _0xnrA.url === "string" ? _0xnrA.url : "";
    if (!/^https?:\/\//i.test(_0xnrUrl)) {
      return {
        ok: false,
        error: "Ungültige URL"
      };
    }
    const _0xnrMs = Math.min(Math.max(Number(_0xnrA.timeout) || 4000, 500), 15000);
    let _0xnrCtrl = null;
    try {
      _0xnrCtrl = new AbortController();
    } catch {
      _0xnrCtrl = null;
    }
    const _0xnrTimer = setTimeout(() => {
      try {
        if (_0xnrCtrl) {
          _0xnrCtrl.abort();
        }
      } catch {}
    }, _0xnrMs);
    const _0xnrTry = async _0xnrMethod => {
      const _0xnrRes = await fetch(_0xnrUrl, {
        method: _0xnrMethod,
        redirect: "follow",
        ...(_0xnrCtrl ? {
          signal: _0xnrCtrl.signal
        } : {})
      });
      try {
        if (_0xnrRes.body && _0xnrRes.body.cancel) {
          _0xnrRes.body.cancel();
        }
      } catch {}
      return _0xnrRes.status;
    };
    try {
      let _0xnrStatus = await _0xnrTry("HEAD");
      if (_0xnrStatus === 405 || _0xnrStatus === 501) {
        _0xnrStatus = await _0xnrTry("GET");
      }
      return {
        ok: _0xnrStatus >= 200 && _0xnrStatus < 400,
        status: _0xnrStatus
      };
    } catch (_0xnrErr) {
      return {
        ok: false,
        error: _0xnrErr && _0xnrErr.message || "Nicht erreichbar"
      };
    } finally {
      clearTimeout(_0xnrTimer);
    }
  });
  ipcMain.handle("studio:download", async () => {
    const _0x495b2e = loadSettings();
    const _0x35520b = (_0x495b2e.apiBaseUrl || "https://removed.invalid").replace(/\/$/, "");
    const _0x4cc469 = _0x35520b + "/download/studio";
    try {
      const _0x4d3bfc = await fetch(_0x4cc469, {
        method: "GET",
        headers: {
          ...(_0x495b2e.sessionToken ? {
            Authorization: "Bearer " + _0x495b2e.sessionToken
          } : {})
        }
      });
      if (_0x4d3bfc.ok) {
        try {
          if (_0x4d3bfc.body && _0x4d3bfc.body.cancel) {
            _0x4d3bfc.body.cancel();
          }
        } catch {}
        await shell.openExternal(_0x4cc469);
        return {
          ok: true,
          url: _0x4cc469
        };
      }
      return {
        ok: false,
        status: _0x4d3bfc.status
      };
    } catch (_0x12e5b0) {
      return {
        ok: false,
        error: _0x12e5b0 && _0x12e5b0.message || "Nicht erreichbar"
      };
    }
  });
  ipcMain.handle("geo:country", async () => {
    if (geoCountryCache !== null) {
      return {
        ok: true,
        country: geoCountryCache
      };
    }
    const _0x218597 = await fetchJson("https://get.geojs.io/v1/ip/country.json", {}, 6000);
    const _0x510af3 = _0x218597 && typeof _0x218597.country === "string" ? _0x218597.country.trim().toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(_0x510af3)) {
      return {
        ok: false
      };
    }
    geoCountryCache = _0x510af3;
    return {
      ok: true,
      country: _0x510af3
    };
  });
  ipcMain.handle("window:setFullscreen", (_0x58db69, _0x18a24a) => {
    if (mainWindow) {
      mainWindow.setFullScreen(!!_0x18a24a);
    }
    return {
      ok: true
    };
  });
  ipcMain.handle("window:isFullscreen", () => mainWindow ? mainWindow.isFullScreen() : false);
  ipcMain.handle("cloud:esc-guard", (_0xE, _0xOn) => {
    cloudFsGuard = !!_0xOn;
    if (!cloudFsGuard && cloudEscTimer) { clearTimeout(cloudEscTimer); cloudEscTimer = null; }
    return { ok: true };
  });
  ipcMain.handle("open:folder", async (_0x85dc27, _0x2a8a35) => {
    if (_0x2a8a35 && fs.existsSync(_0x2a8a35)) {
      await shell.openPath(_0x2a8a35);
      return {
        ok: true
      };
    }
    return {
      ok: false
    };
  });
  ipcMain.handle("steam:open-link-window", async (_0x296412, _0x28e459) => {
    currentLinkPlatform = _0x28e459 || "steam";
    if (steamLinkWindow) {
      steamLinkWindow.focus();
      return;
    }
    steamLinkWindow = new BrowserWindow({
      width: 900,
      height: 750,
      parent: mainWindow,
      modal: true,
      show: false,
      backgroundColor: "#000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true,
        preload: path.join(__dirname, "preload.js")
      }
    });
    steamLinkWindow.loadFile(path.join(__dirname, "renderer", "steam-link.html"));
    steamLinkWindow.once("ready-to-show", () => {
      steamLinkWindow.show();
    });
    steamLinkWindow.on("closed", () => {
      steamLinkWindow = null;
    });
  });
  ipcMain.handle("steam:get-link-info", () => {
    const _0xe5e5cf = loadSettings();
    const _0x26ecb9 = _0xe5e5cf.apiBaseUrl.replace(/\/$/, "");
    if (currentLinkPlatform === "steam") {
      return {
        platform: "steam",
        url: _0x26ecb9 + "/auth/steam"
      };
    }
    if (currentLinkPlatform === "epic") {
      return {
        platform: "epic",
        url: _0x26ecb9 + "/auth/epic"
      };
    }
    return {
      platform: currentLinkPlatform,
      url: null
    };
  });
  ipcMain.handle("steam:close-link-window", async (_0x801792, _0x18f3fa) => {
    if (steamLinkWindow) {
      steamLinkWindow.close();
      steamLinkWindow = null;
    }
    if (_0x18f3fa && mainWindow) {
      mainWindow.webContents.send("steam:linked-success");
    }
  });
}
// Fehlt "ws" (z. B. Quellordner ohne npm install), sollen nur Spiel- und VR-Bruecke
// ausfallen - deren "new WebSocketServer" steht schon in try/catch -, nicht der ganze Start.
let WebSocketServer = null;
try {
  ({ WebSocketServer } = require("ws"));
} catch (_0xwsErr) {
  console.error("Modul 'ws' fehlt - Spiel- und VR-Bruecke deaktiviert:", _0xwsErr.message);
}
let gameBridge = null;
const vcChildren = {};
const bridgeClients = new Set();
// Rate-Limit fuer Game->Freund-Textvorschlaege (sendText): pro Spiel max 10/Min.
// Nur im Speicher; Zeitstempel je gameId. Verhindert Spam ueber die Bridge.
const gameTextRate = new Map();
// ── Vystra-Launch-Handshake ────────────────────────────────────────────────
// Beim Start eines eigenen Spiels/einer App bekommt der Kindprozess ein Einmal-
// Token (per Umgebungsvariable). Damit kann er sicher bestaetigen "Vystra hat
// MICH gestartet" (nicht nur "Vystra laeuft irgendwo") und - bei unseren eigenen
// Spielen - den angemeldeten Nutzer uebernehmen (Auto-Login). Trust-Modell: nur
// ein von Vystra gestarteter Prozess kennt sein Launch-Token; das Redeemen des
// Tokens ueber den Loopback-Endpunkt beweist den Start durch Vystra.
const VL_HANDSHAKE_PORT = 8449; // direkt neben der Spiel-Bruecke (8448)
const VL_LAUNCH_TTL_MS = 10 * 60 * 1000; // 10 Min - deckt auch langsame Starts ab
const vlLaunchTokens = new Map(); // token -> {gameId, titel, platform, mitSession, ausgestellt}
let vlHandshakeServer = null;
function vlLaunchAufraeumen() {
  const _0xjetzt = Date.now();
  for (const [_0xk, _0xv] of vlLaunchTokens) {
    if (_0xjetzt - _0xv.ausgestellt > VL_LAUNCH_TTL_MS) {
      vlLaunchTokens.delete(_0xk);
    }
  }
}
// Erzeugt ein Launch-Token fuer ein Spiel. mitSession=true nur fuer EIGENE
// (viscode) Spiele - nur dann darf spaeter das Session-Token herausgegeben werden.
function vlLaunchTokenErzeugen(_0xspiel, _0xmitSession) {
  vlLaunchAufraeumen();
  const _0xtok = crypto.randomBytes(24).toString("hex");
  vlLaunchTokens.set(_0xtok, {
    gameId: _0xspiel && _0xspiel.id != null ? String(_0xspiel.id) : null,
    titel: _0xspiel && (_0xspiel.title || _0xspiel.name) || null,
    platform: _0xspiel && _0xspiel.platform || null,
    mitSession: !!_0xmitSession,
    ausgestellt: Date.now()
  });
  return _0xtok;
}
function vlLaunchTokenLesen(_0xtok) {
  if (!_0xtok) {
    return null;
  }
  const _0xe = vlLaunchTokens.get(String(_0xtok));
  if (!_0xe) {
    return null;
  }
  if (Date.now() - _0xe.ausgestellt > VL_LAUNCH_TTL_MS) {
    vlLaunchTokens.delete(String(_0xtok));
    return null;
  }
  return _0xe;
}
// Oeffentliche Nutzer-Identitaet (NIE email/pw/hwid) - wie in der Spiel-Bruecke.
function vlOeffentlicherNutzer() {
  const _0xu = (loadSettings().user) || {};
  if (!(_0xu.id || _0xu.user_id) || _0xu.demo) {
    return null;
  }
  return {
    id: _0xu.id || _0xu.user_id || null,
    username: _0xu.username || null,
    displayName: _0xu.displayName || _0xu.anzeigename || _0xu.username || null,
    avatar: _0xu.avatar || _0xu.avatar_url || null
  };
}
// Baut das Umgebungs-Set fuer ein von Vystra gestartetes Kind. Immer: Merker,
// Bridge-/API-Ports, Launch-Token, Spiel-ID. Bei EIGENEN Spielen zusaetzlich
// Nutzer + Session-Token (Auto-Login). Fremde, selbst hinzugefuegte .exe bekommen
// BEWUSST kein Session-Token - nur den Start-Merker und die oeffentliche Identitaet.
function vlLaunchEnv(_0xspiel, _0xmitSession) {
  const _0xs = loadSettings();
  const _0xport = _0xs.gameBridgePort || 8448;
  const _0xtok = vlLaunchTokenErzeugen(_0xspiel, _0xmitSession);
  const _0xenv = {
    ...process.env,
    VYSTRA: "1",
    VYSTRA_LAUNCH: "1",
    VYSTRA_LAUNCHER: "Vystra Launcher",
    VYSTRA_VERSION: app.getVersion(),
    VYSTRA_BRIDGE_PORT: String(_0xport),
    VYSTRA_BRIDGE_URL: "ws://127.0.0.1:" + _0xport,
    VYSTRA_API: "http://127.0.0.1:" + VL_HANDSHAKE_PORT,
    VYSTRA_LAUNCH_TOKEN: _0xtok,
    VYSTRA_GAME_ID: _0xspiel && _0xspiel.id != null ? String(_0xspiel.id) : ""
  };
  const _0xu = vlOeffentlicherNutzer();
  if (_0xu) {
    _0xenv.VYSTRA_USER_ID = String(_0xu.id || "");
    _0xenv.VYSTRA_USERNAME = String(_0xu.username || _0xu.displayName || "");
    // Session-Token NUR fuer eigene, pfadgepruefte Spiele (Auto-Login). Bleibt
    // lokal (env) - verlaesst diesen Rechner nicht.
    if (_0xmitSession && _0xs.sessionToken) {
      _0xenv.VYSTRA_SESSION_TOKEN = String(_0xs.sessionToken);
    }
  }
  return _0xenv;
}
// Baut die Handshake-Antwort fuer ein gueltiges Launch-Token.
function vlLaunchAntwort(_0xeintrag) {
  const _0xs = loadSettings();
  const _0xu = vlOeffentlicherNutzer();
  const _0xantwort = {
    ok: true,
    startedByVystra: true,
    shouldLogin: !!_0xu, // "soll sich einloggen" - nur sinnvoll, wenn ein Nutzer angemeldet ist
    launcher: "Vystra Launcher",
    version: app.getVersion(),
    game: {
      id: _0xeintrag.gameId,
      title: _0xeintrag.titel,
      platform: _0xeintrag.platform
    },
    user: _0xu,
    bridge: {
      url: "ws://127.0.0.1:" + (_0xs.gameBridgePort || 8448),
      port: _0xs.gameBridgePort || 8448
    }
  };
  // Session-Token nur bei eigenen Spielen (mitSession) und angemeldet.
  if (_0xeintrag.mitSession && _0xu && _0xs.sessionToken) {
    _0xantwort.sessionToken = String(_0xs.sessionToken);
  }
  return _0xantwort;
}
// Kleiner Loopback-HTTP-Server: sprachneutrale Bestaetigung fuer Spiele/Software,
// die kein WebSocket sprechen. Bindet NUR an 127.0.0.1 (nicht erreichbar aus dem
// LAN). Endpunkte:
//   GET /vystra/status              -> laeuft Vystra? wer ist angemeldet? (oeffentlich)
//   GET /vystra/launch?token=<tok>  -> "Vystra hat mich gestartet" + shouldLogin (Token noetig)
function startVlHandshakeServer() {
  try {
    vlHandshakeServer = http.createServer((_0xreq, _0xres) => {
      // Grundsatz: nur Loopback, nur GET, immer JSON.
      const _0xip = _0xreq.socket && _0xreq.socket.remoteAddress || "";
      const _0xlokal = _0xip === "127.0.0.1" || _0xip === "::1" || _0xip === "::ffff:127.0.0.1";
      const _0xsenden = (_0xcode, _0xobj) => {
        try {
          _0xres.writeHead(_0xcode, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            // Lokale Spiele/Engines rufen teils aus einem WebView heraus -> CORS offen,
            // schadet nicht, da der Server ohnehin nur auf 127.0.0.1 lauscht.
            "Access-Control-Allow-Origin": "*"
          });
          _0xres.end(JSON.stringify(_0xobj));
        } catch {}
      };
      if (!_0xlokal) {
        _0xsenden(403, { ok: false, error: "nur lokal" });
        return;
      }
      let _0xpfad, _0xquery;
      try {
        const _0xurl = new URL(_0xreq.url, "http://127.0.0.1");
        _0xpfad = _0xurl.pathname;
        _0xquery = _0xurl.searchParams;
      } catch {
        _0xsenden(400, { ok: false, error: "bad_request" });
        return;
      }
      if (_0xreq.method !== "GET") {
        _0xsenden(405, { ok: false, error: "nur GET" });
        return;
      }
      if (_0xpfad === "/vystra/status") {
        _0xsenden(200, {
          ok: true,
          vystra: true,
          launcher: "Vystra Launcher",
          version: app.getVersion(),
          loggedIn: !!vlOeffentlicherNutzer(),
          user: vlOeffentlicherNutzer()
        });
        return;
      }
      if (_0xpfad === "/vystra/launch") {
        const _0xtok = _0xquery.get("token") || "";
        const _0xe = vlLaunchTokenLesen(_0xtok);
        if (!_0xe) {
          _0xsenden(404, { ok: false, startedByVystra: false, error: "invalid_token" });
          return;
        }
        _0xsenden(200, vlLaunchAntwort(_0xe));
        return;
      }
      _0xsenden(404, { ok: false, error: "unbekannter Endpunkt" });
    });
    vlHandshakeServer.on("error", _0xe => {
      // Belegter Port o.ae. darf den Launcher nicht beenden - nur melden. Der
      // env-Weg (VYSTRA_* Variablen) funktioniert auch ohne diesen Server.
      console.log("Vystra-Handshake: " + (_0xe && _0xe.message ? _0xe.message : _0xe));
    });
    vlHandshakeServer.listen(VL_HANDSHAKE_PORT, "127.0.0.1", () => {
      console.log("Vystra-Launch-Handshake lauscht auf 127.0.0.1:" + VL_HANDSHAKE_PORT);
    });
  } catch (_0xe) {
    console.log("Vystra-Handshake: Start fehlgeschlagen: " + (_0xe && _0xe.message ? _0xe.message : _0xe));
    vlHandshakeServer = null;
  }
}
function startGameBridge() {
  const _0x433d09 = loadSettings().gameBridgePort || 8448;
  try {
    gameBridge = new WebSocketServer({
      host: "127.0.0.1",
      port: _0x433d09
    });
  } catch (_0x518acc) {
    console.error("Spiel-Brücke konnte nicht starten:", _0x518acc.message);
    return;
  }
  gameBridge.on("connection", (_0x5164a8, _0x360943) => {
    const _0x4ba4d6 = _0x360943.socket.remoteAddress || "";
    const _0x4cb58d = _0x4ba4d6 === "127.0.0.1" || _0x4ba4d6 === "::1" || _0x4ba4d6 === "::ffff:127.0.0.1";
    if (!_0x4cb58d || _0x360943.headers.origin) {
      try {
        _0x5164a8.close(1008, "nur lokale Spiele erlaubt");
      } catch {}
      return;
    }
    bridgeClients.add(_0x5164a8);
    const _0xe5886b = loadSettings();
    const _0x36f390 = _0xe5886b.user || {};
    try {
      _0x5164a8.send(JSON.stringify({
        type: "hello",
        launcher: "VisCode Launcher",
        version: app.getVersion(),
        user: _0x36f390.id ? {
          id: _0x36f390.id || _0x36f390.user_id || null,
          username: _0x36f390.username || null,
          displayName: _0x36f390.displayName || _0x36f390.username || null,
          avatar: _0x36f390.avatar || _0x36f390.avatar_url || null,
          provider: _0x36f390.provider || null
        } : null,
        turn: {
          urls: _0xe5886b.turnUrl,
          username: _0xe5886b.turnUsername,
          credential: _0xe5886b.turnCredential
        }
      }));
    } catch {}
    _0x5164a8.on("message", async _0x594679 => {
      let _0x46a877;
      try {
        _0x46a877 = JSON.parse(_0x594679.toString());
      } catch {
        return;
      }
      if (_0x46a877.type === "ping") {
        try {
          _0x5164a8.send("{\"type\":\"pong\"}");
        } catch {}
        return;
      }
      // Launch-Handshake ueber die Bruecke: das Spiel weist mit seinem beim Start
      // erhaltenen Token nach, dass Vystra es gestartet hat. Antwort enthaelt die
      // Bestaetigung + (bei eigenen Spielen) Nutzer/Session fuer den Auto-Login.
      if (_0x46a877.type === "confirmLaunch") {
        const _0xle = vlLaunchTokenLesen(_0x46a877.token);
        try {
          if (!_0xle) {
            _0x5164a8.send(JSON.stringify({
              type: "launchConfirmed",
              ok: false,
              startedByVystra: false,
              error: "invalid_token"
            }));
          } else {
            _0x5164a8.send(JSON.stringify({
              type: "launchConfirmed",
              ...vlLaunchAntwort(_0xle)
            }));
          }
        } catch {}
        return;
      }
      if (_0x46a877.type === "requestAuth" || _0x46a877.type === "requestLicense") {
        const _0x1c59f6 = loadSettings();
        const _0x4f2260 = (_0x1c59f6.apiBaseUrl || "").replace(/\/$/, "");
        const _0x39a94a = _0x1c59f6.user && (_0x1c59f6.user.id || _0x1c59f6.user.user_id);
        // SICHERHEIT: Erst die Lizenz pruefen. Ohne gueltige Lizenz gehen KEINE Infos
        // (weder userId/username noch Key) an das Spiel. Kein Besitz = die API bleibt zu.
        const _0xdenyAuth = _0xreason => {
          try {
            _0x5164a8.send(JSON.stringify({
              type: "auth",
              ok: false,
              error: "no_license",
              reason: _0xreason,
              gameId: _0x46a877.gameId || null,
              userId: null,
              username: null,
              key: null
            }));
          } catch {}
        };
        if (!_0x4f2260 || !_0x39a94a || !_0x46a877.gameId) {
          _0xdenyAuth("not_logged_in");
          return;
        }
        let _0xlicCheck;
        try {
          _0xlicCheck = await verifyOwnership(_0x46a877.gameId);
        } catch {
          _0xlicCheck = {
            owned: null,
            offline: true
          };
        }
        if (!_0xlicCheck || _0xlicCheck.owned !== true) {
          _0xdenyAuth(_0xlicCheck && _0xlicCheck.offline ? "unverified" : "not_owned");
          return;
        }
        // Lizenz vorhanden -> jetzt erst den Aktivierungs-Key minten und ausliefern
        let _0x61f7f6 = null;
        try {
          const _0x2ce45f = await fetch(_0x4f2260 + "/removed", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(_0x1c59f6.sessionToken ? {
                Authorization: "Bearer " + _0x1c59f6.sessionToken
              } : {}),
              ...watermarkHeaders(_0x4f2260 + "/removed")
            },
            body: JSON.stringify({
              userId: _0x39a94a,
              game_id: _0x46a877.gameId
            })
          });
          const _0x4ecce9 = await _0x2ce45f.json().catch(() => null);
          if (_0x4ecce9 && _0x4ecce9.key) {
            _0x61f7f6 = _0x4ecce9.key;
          }
        } catch {}
        try {
          _0x5164a8.send(JSON.stringify({
            type: "auth",
            ok: true,
            gameId: _0x46a877.gameId || null,
            userId: _0x39a94a || null,
            username: _0x1c59f6.user && _0x1c59f6.user.username || null,
            key: _0x61f7f6
          }));
        } catch {}
        return;
      }
      // ── Social-Bridge: NUR oeffentliche Profil-/Freundesdaten an das Spiel geben.
      //    NIEMALS email, sessionToken, pw oder hwid. Alles defensiv (try/catch). ──
      if (_0x46a877.type === "requestProfile") {
        try {
          const _0xsAll = loadSettings();
          const _0xu = _0xsAll.user || {};
          _0x5164a8.send(JSON.stringify({
            type: "profile",
            userId: _0xu.id || _0xu.user_id || null,
            username: _0xu.username || null,
            displayName: _0xu.displayName || _0xu.anzeigename || _0xu.username || null,
            avatar: _0xu.avatar || _0xu.avatar_url || null,
            banner: _0xu.banner || null,
            level: typeof _0xu.level === "number" ? _0xu.level : null,
            deco: {
              avatarDeco: _0xu.avatarDeco || _0xsAll.avatarDeco || "none",
              avatarDecoConfig: _0xu.avatarDecoConfig && typeof _0xu.avatarDecoConfig === "object" ? _0xu.avatarDecoConfig : _0xsAll.avatarDecoConfig && typeof _0xsAll.avatarDecoConfig === "object" ? _0xsAll.avatarDecoConfig : {},
              bgDeco: _0xu.bgDeco || _0xsAll.bgDeco || "none"
            }
          }));
        } catch (_0xperr) {
          try {
            _0x5164a8.send(JSON.stringify({
              type: "profile",
              error: String(_0xperr && _0xperr.message || "profile_failed")
            }));
          } catch {}
        }
        return;
      }
      if (_0x46a877.type === "requestFriends") {
        try {
          const _0xfr = await socialApi("GET", "/removed");
          if (!_0xfr || !_0xfr.ok || !_0xfr.data) {
            _0x5164a8.send(JSON.stringify({
              type: "friends",
              error: "offline",
              friends: []
            }));
            return;
          }
          const _0xraw = _0xfr.data.friends || (Array.isArray(_0xfr.data) ? _0xfr.data : []);
          const _0xlist = (Array.isArray(_0xraw) ? _0xraw : []).map(_0xf => {
            let _0xg = _0xf.game || _0xf.currentGame || _0xf.current_game || null;
            if (typeof _0xg === "string" && _0xg.trim().charAt(0) === "{") {
              try {
                _0xg = JSON.parse(_0xg);
              } catch {}
            }
            const _0xtitle = _0xg ? typeof _0xg === "object" ? _0xg.title || _0xg.name || _0xg.gameName || null : _0xg : _0xf.activity || _0xf.playing || null;
            const _0xonline = _0xf.online === true || _0xf.online === 1 || /online|playing/i.test(_0xf.status || "");
            return {
              userId: String(_0xf.id || _0xf.userId || _0xf.username || ""),
              username: _0xf.username || _0xf.name || null,
              displayName: _0xf.displayName || _0xf.username || _0xf.name || null,
              avatar: _0xf.avatar || null,
              online: !!_0xonline,
              playing: !!_0xtitle,
              gameTitle: _0xtitle || null
            };
          }).filter(_0xf => _0xf.userId);
          _0x5164a8.send(JSON.stringify({
            type: "friends",
            friends: _0xlist
          }));
        } catch (_0xferr) {
          try {
            _0x5164a8.send(JSON.stringify({
              type: "friends",
              error: String(_0xferr && _0xferr.message || "friends_failed"),
              friends: []
            }));
          } catch {}
        }
        return;
      }
      if (_0x46a877.type === "sendInvite") {
        try {
          const _0xto = _0x46a877.toUserId || _0x46a877.toUsername || null;
          const _0xlobby = _0x46a877.lobby && typeof _0x46a877.lobby === "object" ? _0x46a877.lobby : null;
          const _0xgameId = _0x46a877.gameId != null ? String(_0x46a877.gameId) : null;
          if (!_0xto || !_0xlobby || _0xlobby.id == null || _0xlobby.id === "") {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: false,
              error: "bad_request"
            }));
            return;
          }
          // Ziel MUSS ein eigener Freund sein – sonst kein Versand (Sicherheit).
          const _0xfr = await socialApi("GET", "/removed");
          if (!_0xfr || !_0xfr.ok || !_0xfr.data) {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: false,
              error: "offline"
            }));
            return;
          }
          const _0xraw = _0xfr.data.friends || (Array.isArray(_0xfr.data) ? _0xfr.data : []);
          const _0xarr = Array.isArray(_0xraw) ? _0xraw : [];
          const _0xtoStr = String(_0xto).toLowerCase();
          const _0xmatch = _0xarr.find(_0xf => {
            const _0xid = String(_0xf.id || _0xf.userId || "").toLowerCase();
            const _0xun = String(_0xf.username || _0xf.name || "").toLowerCase();
            return _0xid && _0xid === _0xtoStr || _0xun && _0xun === _0xtoStr;
          });
          if (!_0xmatch) {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: false,
              error: "not_friend"
            }));
            return;
          }
          // Nur eine STRUKTURIERTE Einladung – kein freier Text moeglich (Sicherheit).
          const _0xsAll = loadSettings();
          const _0xu = _0xsAll.user || {};
          const _0xsafeLobby = {
            id: String(_0xlobby.id)
          };
          if (typeof _0xlobby.name === "string" && _0xlobby.name.trim()) {
            _0xsafeLobby.name = _0xlobby.name.trim().slice(0, 120);
          }
          if (_0xlobby.joinData != null) {
            _0xsafeLobby.joinData = _0xlobby.joinData;
          }
          const _0xpayload = {
            gameId: _0xgameId,
            lobby: _0xsafeLobby,
            host: {
              userId: _0xu.id || _0xu.user_id || null,
              username: _0xu.username || null,
              displayName: _0xu.displayName || _0xu.username || null,
              avatar: _0xu.avatar || _0xu.avatar_url || null
            }
          };
          let _0xtext = "";
          try {
            _0xtext = "[[vystra-invite]]" + JSON.stringify(_0xpayload);
          } catch {
            _0xtext = "";
          }
          if (!_0xtext || _0xtext.length > 3800) {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: false,
              error: "too_large"
            }));
            return;
          }
          const _0xtoId = _0xmatch.username || _0xmatch.id || _0xmatch.userId || _0xto;
          const _0xsent = await socialApi("POST", "/removed/send", {
            toUserId: _0xtoId,
            text: _0xtext
          });
          if (_0xsent && _0xsent.ok) {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: true
            }));
          } else {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: false,
              error: _0xsent && _0xsent.status ? "http_" + _0xsent.status : "send_failed"
            }));
          }
        } catch (_0xierr) {
          try {
            _0x5164a8.send(JSON.stringify({
              type: "invite",
              ok: false,
              error: String(_0xierr && _0xierr.message || "invite_failed")
            }));
          } catch {}
        }
        return;
      }
      if (_0x46a877.type === "sendText") {
        try {
          const _0xto = _0x46a877.toUserId || _0x46a877.toUsername || null;
          let _0xtext = typeof _0x46a877.text === "string" ? _0x46a877.text : "";
          const _0xgameId = _0x46a877.gameId != null ? String(_0x46a877.gameId) : null;
          // Kuerzen + ALLE [[vystra-...]]-Marker entschaerfen ("[[" -> "[ ["),
          // damit ein Spiel keine System-/Invite-Nachrichten faelschen kann.
          _0xtext = _0xtext.slice(0, 500).replace(/\[\[/g, "[ [").trim();
          if (!_0xto || !_0xtext) {
            _0x5164a8.send(JSON.stringify({
              type: "sendText",
              ok: false,
              error: "bad_request"
            }));
            return;
          }
          // Rate-Limit pro Spiel: max 10/Min. Ueberzaehlige werden verworfen.
          const _0xrlKey = _0xgameId || "unknown";
          const _0xnow = Date.now();
          let _0xhits = (gameTextRate.get(_0xrlKey) || []).filter(_0xt => _0xnow - _0xt < 60000);
          if (_0xhits.length >= 10) {
            gameTextRate.set(_0xrlKey, _0xhits);
            _0x5164a8.send(JSON.stringify({
              type: "sendText",
              ok: false,
              error: "rate_limited"
            }));
            return;
          }
          // Ziel MUSS ein eigener Freund sein (grober Match wie bei sendInvite).
          const _0xfr = await socialApi("GET", "/removed");
          if (!_0xfr || !_0xfr.ok || !_0xfr.data) {
            _0x5164a8.send(JSON.stringify({
              type: "sendText",
              ok: false,
              error: "offline"
            }));
            return;
          }
          const _0xraw = _0xfr.data.friends || (Array.isArray(_0xfr.data) ? _0xfr.data : []);
          const _0xarr = Array.isArray(_0xraw) ? _0xraw : [];
          const _0xtoStr = String(_0xto).toLowerCase();
          const _0xmatch = _0xarr.find(_0xf => {
            const _0xid = String(_0xf.id || _0xf.userId || "").toLowerCase();
            const _0xun = String(_0xf.username || _0xf.name || "").toLowerCase();
            return _0xid && _0xid === _0xtoStr || _0xun && _0xun === _0xtoStr;
          });
          if (!_0xmatch) {
            _0x5164a8.send(JSON.stringify({
              type: "sendText",
              ok: false,
              error: "not_friend"
            }));
            return;
          }
          // Treffer erst JETZT zaehlen (verworfene/abgelehnte zaehlen nicht doppelt).
          _0xhits.push(_0xnow);
          gameTextRate.set(_0xrlKey, _0xhits);
          // KEIN stiller Versand: nur an den Renderer weiterreichen -> Bestaetigungs-Popup.
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("game:send-text-request", {
              toUserId: _0xmatch.id || _0xmatch.userId || _0xto,
              toUsername: _0xmatch.username || _0xmatch.name || _0x46a877.toUsername || null,
              text: _0xtext,
              gameId: _0xgameId
            });
          }
          _0x5164a8.send(JSON.stringify({
            type: "sendText",
            ok: true,
            queued: true
          }));
        } catch (_0xterr) {
          try {
            _0x5164a8.send(JSON.stringify({
              type: "sendText",
              ok: false,
              error: String(_0xterr && _0xterr.message || "sendtext_failed")
            }));
          } catch {}
        }
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("game:status", _0x46a877);
      }
    });
    _0x5164a8.on("close", () => bridgeClients.delete(_0x5164a8));
    _0x5164a8.on("error", () => bridgeClients.delete(_0x5164a8));
  });
  gameBridge.on("error", _0x139d0a => console.error("Spiel-Brücke:", _0x139d0a.message));
}
function broadcastToGames(_0x5bb47f) {
  const _0x443413 = JSON.stringify(_0x5bb47f);
  for (const _0x4dcbe6 of bridgeClients) {
    try {
      if (_0x4dcbe6.readyState === 1) {
        _0x4dcbe6.send(_0x443413);
      }
    } catch {}
  }
}
// Cloud-Gaming: ESC verlässt das Vollbild NICHT mehr sofort – nur wenn ESC 5 Sekunden
// gehalten wird. Verhindert versehentliches Vollbild-Beenden während des Spielens.
let cloudFsGuard = false;
let cloudEscTimer = null;
function handleCloudEsc(_0xEvt, _0xInput) {
  if (!cloudFsGuard || !mainWindow || !mainWindow.isFullScreen()) return;
  if (!_0xInput || _0xInput.key !== "Escape") return;
  _0xEvt.preventDefault(); // ESC weder an die Seite noch ans Vollbild-Beenden weiterreichen
  if (_0xInput.type === "keyDown") {
    if (!cloudEscTimer) {
      cloudEscTimer = setTimeout(() => {
        cloudEscTimer = null;
        if (mainWindow && mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
      }, 5000);
    }
  } else if (_0xInput.type === "keyUp") {
    if (cloudEscTimer) { clearTimeout(cloudEscTimer); cloudEscTimer = null; }
  }
}
// Glas wie in der Botwerkstatt: SetWindowCompositionAttribute mit Acryl-Unschaerfe
// und fast unsichtbarer Toenung (0x01). Anders als Electrons backgroundMaterial legt
// Windows dabei keine milchige Grauschicht drauf - die Abdunklung macht das CSS.
// Wirkt nur auf rahmenlosen, transparenten Fenstern (sonst bleibt es schwarz).
let _fensterGlasFn = null;
function fensterGlasSetzen(_0xwin, _0xan) {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    if (!_fensterGlasFn) {
      const koffi = require("koffi");
      const _0xuser32 = koffi.load("user32.dll");
      const _0xpolicy = koffi.struct("VystraAccentPolicy", { state: "int", flags: "int", gradient: "uint32", animation: "int" });
      const _0xdata = koffi.struct("VystraCompData", { attribute: "int", data: "void *", size: "size_t" });
      const _0xswca = _0xuser32.func("int __stdcall SetWindowCompositionAttribute(void *hwnd, VystraCompData *data)");
      _fensterGlasFn = (_0xw, _0xein) => {
        const _0xbuf = Buffer.alloc(koffi.sizeof(_0xpolicy));
        koffi.encode(_0xbuf, _0xpolicy, _0xein ? { state: 4, flags: 2, gradient: (0x01 << 24 | 0x1F1712) >>> 0, animation: 0 } : { state: 0, flags: 0, gradient: 0, animation: 0 });
        const _0xhwnd = koffi.decode(_0xw.getNativeWindowHandle(), "void *");
        return _0xswca(_0xhwnd, { attribute: 19, data: _0xbuf, size: _0xbuf.length }) !== 0;
      };
    }
    return _fensterGlasFn(_0xwin, _0xan);
  } catch (_0xe) {
    console.warn("[glas]", _0xe && _0xe.message);
    return false;
  }
}

let _snapWin = null;
let _snapAn = false;
let _snapPoll = null;
let _snapSeit = 0;
let _snapDisplayId = null;
let _mausLinksFn = null;
function mausLinksGedrueckt() {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    if (!_mausLinksFn) {
      const koffi = require("koffi");
      const _0xu = koffi.load("user32.dll");
      const _0xfn = _0xu.func("short __stdcall GetAsyncKeyState(int)");
      _mausLinksFn = () => (_0xfn(0x01) & 0x8000) !== 0;
    }
    return _mausLinksFn();
  } catch {
    return false;
  }
}
function snapVorschauWeg() {
  _snapAn = false;
  _snapSeit = 0;
  _snapDisplayId = null;
  if (_snapPoll) {
    clearInterval(_snapPoll);
    _snapPoll = null;
  }
  if (_snapWin && !_snapWin.isDestroyed()) {
    try {
      _snapWin.hide();
    } catch {}
  }
}
function snapVorschauZeigen(_0xdisplay) {
  if (_snapAn && _snapDisplayId === _0xdisplay.id) {
    return;
  }
  const _0xwa = _0xdisplay.workArea;
  const _0xb = {
    x: _0xwa.x + 10,
    y: _0xwa.y + 10,
    width: _0xwa.width - 20,
    height: _0xwa.height - 20
  };
  if (!_snapWin || _snapWin.isDestroyed()) {
    _snapWin = new BrowserWindow({
      ..._0xb,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        backgroundThrottling: false
      }
    });
    try {
      _snapWin.setIgnoreMouseEvents(true, { forward: true });
    } catch {}
    _snapWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent('<!doctype html><html><body style="margin:0;background:transparent"><div style="position:absolute;inset:0;border-radius:14px;border:2px solid rgba(255,255,255,.55);background:rgba(40,90,160,.16)"></div></body></html>'));
  } else {
    _snapWin.setBounds(_0xb);
  }
  if (!_snapWin.isVisible()) {
    _snapWin.showInactive();
  }
  _snapAn = true;
  _snapDisplayId = _0xdisplay.id;
}
function snapObenPruefen() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isFullScreen()) {
    if (_snapPoll || _snapAn) {
      snapVorschauWeg();
    }
    return;
  }
  if (!mausLinksGedrueckt()) {
    if (_snapPoll || _snapAn) {
      snapVorschauWeg();
    }
    return;
  }
  if (_snapPoll) {
    return;
  }
  _snapPoll = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isFullScreen()) {
      snapVorschauWeg();
      return;
    }
    const _0xcur = screen.getCursorScreenPoint();
    const _0xd = screen.getDisplayNearestPoint(_0xcur);
    const _0xoben = _0xcur.y <= _0xd.bounds.y + 4;
    const _0xhalten = _snapAn || _snapSeit && Date.now() - _snapSeit >= 380;
    if (!mausLinksGedrueckt()) {
      snapVorschauWeg();
      if (_0xoben && _0xhalten) {
        try {
          mainWindow.maximize();
        } catch {}
      }
      return;
    }
    if (!_0xoben) {
      _snapSeit = 0;
      if (_snapAn && _snapWin && !_snapWin.isDestroyed()) {
        try {
          _snapWin.hide();
        } catch {}
        _snapAn = false;
        _snapDisplayId = null;
      }
      return;
    }
    if (!_snapSeit) {
      _snapSeit = Date.now();
    }
    if (Date.now() - _snapSeit >= 380) {
      snapVorschauZeigen(_0xd);
    }
  }, 40);
}
function applyMainWindowGlass(_0xon) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      ok: false
    };
  }
  try {
    if (_0xon) {
      fensterGlasSetzen(mainWindow, true);
      if (process.platform === "darwin" && typeof mainWindow.setVibrancy === "function") {
        mainWindow.setVibrancy("under-window");
      }
    } else {
      if (process.platform === "darwin" && typeof mainWindow.setVibrancy === "function") {
        mainWindow.setVibrancy(null);
      }
      fensterGlasSetzen(mainWindow, false);
    }
    return {
      ok: true
    };
  } catch (_0xe) {
    return {
      ok: false,
      error: _0xe && _0xe.message ? _0xe.message : String(_0xe)
    };
  }
}
function perfPlaceholderPath() {
  return path.join(app.getPath("userData"), "perf-placeholder.jpg");
}
function perfPlaceholderRead() {
  try {
    const _0xp = perfPlaceholderPath();
    if (!fs.existsSync(_0xp)) {
      return {
        ok: false
      };
    }
    const _0xbuf = fs.readFileSync(_0xp);
    return {
      ok: true,
      dataUrl: "data:image/jpeg;base64," + _0xbuf.toString("base64")
    };
  } catch {
    return {
      ok: false
    };
  }
}
let _perfSleepResolve = null;
let _perfDidSleep = false;
let _perfStandby = false;
async function perfPurgeCaches() {
  const _0xsessions = [];
  try {
    _0xsessions.push(session.defaultSession);
  } catch {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      _0xsessions.push(mainWindow.webContents.session);
    }
  } catch {}
  for (const _0xses of _0xsessions) {
    try {
      await _0xses.clearCache();
    } catch {}
    try {
      if (typeof _0xses.clearCodeCaches === "function") {
        await _0xses.clearCodeCaches({
          urls: []
        });
      }
    } catch {}
  }
  try {
    if (typeof global.gc === "function") {
      global.gc();
    }
  } catch {}
}
function _perfSleepWait() {
  if (_perfSleepResolve) {
    const _0xfn = _perfSleepResolve;
    _perfSleepResolve = null;
    try {
      _0xfn();
    } catch {}
  }
}
async function perfSleepWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const _0xst = loadSettings();
  if (!_0xst.performanceMode) {
    return;
  }
  if (_perfStandby) {
    return;
  }
  try {
    const _0ximg = await mainWindow.capturePage();
    const _0xbuf = _0ximg.toJPEG(28);
    fs.writeFileSync(perfPlaceholderPath(), _0xbuf);
    const _0xurl = "data:image/jpeg;base64," + _0xbuf.toString("base64");
    _perfDidSleep = true;
    await new Promise(_0xdone => {
      _perfSleepResolve = _0xdone;
      try {
        mainWindow.webContents.send("perf:sleep", {
          dataUrl: _0xurl
        });
      } catch {
        _0xdone();
        return;
      }
      setTimeout(() => {
        _0xdone();
      }, 500);
    });
    _perfSleepResolve = null;
    _perfStandby = true;
    try {
      await mainWindow.loadFile(path.join(__dirname, "renderer", "perf-standby.html"));
      await mainWindow.webContents.executeJavaScript("document.body.style.backgroundImage=" + JSON.stringify("url(" + _0xurl + ")") + ";document.body.style.backgroundSize='cover';document.body.style.backgroundPosition='center';");
    } catch {}
    await perfPurgeCaches();
  } catch {}
}
function perfWakeWindow() {
  if (!_perfDidSleep || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  _perfDidSleep = false;
  const _0xstandby = _perfStandby || /perf-standby\.html/i.test(mainWindow.webContents.getURL() || "");
  _perfStandby = false;
  if (_0xstandby) {
    try {
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    } catch {}
    return;
  }
  try {
    mainWindow.webContents.send("perf:wake");
  } catch {}
}
function createWindow() {
  // Im hellen Windows-Modus zeichnet Acrylic milchig-weiss; dunkel ist es fast schwarz.
  try {
    nativeTheme.themeSource = "dark";
  } catch {}
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    // Rahmenlos + transparent: nur so wirkt das Glas (fensterGlasSetzen). Die
    // Titelleiste mit Minimieren/Maximieren/Schliessen baut der Renderer selbst.
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    title: "VisCode Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Kein Rechtsklick-Menue mit Kopieren / Bild speichern. In Eingabefeldern
  // bleibt nur Einfuegen und Alles-auswaehlen.
  mainWindow.webContents.on("context-menu", (_0xev, _0xparams) => {
    _0xev.preventDefault();
    if (!_0xparams || !_0xparams.isEditable) {
      return;
    }
    try {
      Menu.buildFromTemplate([
        { role: "paste", label: "Einfügen" },
        { role: "selectAll", label: "Alles auswählen" }
      ]).popup({ window: mainWindow });
    } catch {}
  });
  const _0xmaxMelden = () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("window:maximized", mainWindow.isMaximized());
      }
    } catch {}
  };
  const glasNachziehen = () => {
    if (mausLinksGedrueckt()) {
      return;
    }
    try {
      const _0xbg = loadSettings() && loadSettings().launcherBackground;
      applyMainWindowGlass(!!(_0xbg && _0xbg.type === "glass"));
    } catch {}
  };
  mainWindow.on("maximize", () => {
    _0xmaxMelden();
    glasNachziehen();
  });
  mainWindow.on("unmaximize", () => {
    _0xmaxMelden();
    glasNachziehen();
  });
  mainWindow.webContents.on("did-finish-load", _0xmaxMelden);
  let _monId = null;
  try {
    _monId = screen.getDisplayMatching(mainWindow.getBounds()).id;
  } catch {}
  let _monWechselSperre = false;
  const monitorWechsel = () => {
    if (_monWechselSperre || !mainWindow || mainWindow.isDestroyed() || mausLinksGedrueckt()) {
      return;
    }
    const _0xd = screen.getDisplayMatching(mainWindow.getBounds());
    if (_monId === _0xd.id) {
      return;
    }
    _monId = _0xd.id;
    if (!mainWindow.isMaximized()) {
      return;
    }
    _monWechselSperre = true;
    try {
      mainWindow.unmaximize();
      mainWindow.setBounds(_0xd.workArea);
      mainWindow.maximize();
      glasNachziehen();
    } catch {}
    setTimeout(() => {
      _monWechselSperre = false;
    }, 250);
  };
  mainWindow.on("will-move", () => {
    snapObenPruefen();
  });
  mainWindow.on("moved", () => {
    if (!mausLinksGedrueckt()) {
      monitorWechsel();
    }
  });
  try {
    screen.on("display-metrics-changed", monitorWechsel);
  } catch {}
  mainWindow.on("closed", () => {
    snapVorschauWeg();
    try {
      screen.removeListener("display-metrics-changed", monitorWechsel);
    } catch {}
  });
  try {
    const _0xbg0 = loadSettings() && loadSettings().launcherBackground;
    applyMainWindowGlass(!!(_0xbg0 && _0xbg0.type === "glass"));
  } catch {}
  // ── Anrufe (WebRTC): Mikro/Kamera + Screenshare für die eigene App erlauben ──
  try {
    const _vcSess = mainWindow.webContents.session;
    const _vcAllowedPerms = new Set(["media", "display-capture", "audioCapture", "videoCapture", "mediaKeySystem"]);
    // Nur für den eigenen App-Origin (file://) Medien erlauben – nichts von fremden Seiten.
    const _vcIsOwnOrigin = _0xurl => {
      try {
        return !_0xurl || _0xurl === "null" || _0xurl.startsWith("file:") || _0xurl.startsWith("chrome-extension:") || _0xurl.startsWith("devtools:");
      } catch {
        return false;
      }
    };
    _vcSess.setPermissionRequestHandler((_0xwc, _0xperm, _0xcb, _0xdetails) => {
      const _0xorigin = _0xdetails && _0xdetails.requestingUrl || _0xwc && _0xwc.getURL && _0xwc.getURL() || "";
      if (_vcAllowedPerms.has(_0xperm)) {
        // Mikro/Kamera/Screenshare nur für die eigene App erlauben, nicht für eingebettete Fremdseiten.
        _0xcb(_vcIsOwnOrigin(_0xorigin));
        return;
      }
      // Alle übrigen Berechtigungen wie bisher (Electron-Standard) zulassen –
      // damit bestehende Features (z. B. eingebettete Cloud-Gaming-Webviews) unverändert laufen.
      _0xcb(true);
    });
    _vcSess.setPermissionCheckHandler((_0xwc, _0xperm, _0xorigin) => {
      if (_vcAllowedPerms.has(_0xperm)) {
        return _vcIsOwnOrigin(_0xorigin);
      }
      return true;
    });
    // Screenshare (getDisplayMedia): ganzen Bildschirm als Quelle liefern.
    if (typeof _vcSess.setDisplayMediaRequestHandler === "function") {
      _vcSess.setDisplayMediaRequestHandler((_0xreq, _0xcb) => {
        desktopCapturer.getSources({
          types: ["screen", "window"]
        }).then(_0xsources => {
          const _0xscreen = _0xsources.find(_0xs => _0xs.id && _0xs.id.startsWith("screen:")) || _0xsources[0];
          if (_0xscreen) {
            _0xcb({
              video: _0xscreen
            });
          } else {
            _0xcb();
          }
        }).catch(() => {
          try {
            _0xcb();
          } catch {}
        });
      });
    }
  } catch (_0xvcErr) {
    console.error("[Anruf] Session-Setup fehlgeschlagen:", _0xvcErr && _0xvcErr.message);
  }
  mainWindow.on("close", _0x447c3d => {
    const _0x424abf = loadSettings();
    const _0xverstecken = !isQuitting && (_0x424abf.backgroundMode !== false || _0x424abf.performanceMode);
    if (_0xverstecken) {
      _0x447c3d.preventDefault();
      Promise.resolve(perfSleepWindow()).then(() => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
          }
        } catch {}
      });
      if (tray && !loadSettings()._trayHintShown && _0x424abf.backgroundMode !== false) {
        try {
          if (tray.displayBalloon) {
            tray.displayBalloon({
              title: "VisCode Launcher läuft weiter",
              content: "Du bleibst für deine Freunde online. Beenden über das Tray-Symbol."
            });
          }
        } catch {}
        const _0x189b16 = loadSettings();
        _0x189b16._trayHintShown = true;
        saveSettings(_0x189b16);
      }
      return false;
    }
  });
  mainWindow.on("minimize", () => {
    Promise.resolve(perfSleepWindow()).catch(() => {});
  });
  mainWindow.on("restore", () => {
    perfWakeWindow();
  });
  mainWindow.on("show", () => {
    perfWakeWindow();
  });
  mainWindow.on("enter-full-screen", () => mainWindow.webContents.send("fullscreen:changed", true));
  mainWindow.on("leave-full-screen", () => mainWindow.webContents.send("fullscreen:changed", false));
  // ESC-Abfang für Cloud-Gaming (Fenster + eingebettetes GeForce-Webview)
  mainWindow.webContents.on("before-input-event", handleCloudEsc);
  mainWindow.webContents.on("did-attach-webview", (_0xE, _0xGuest) => {
    try { _0xGuest.on("before-input-event", handleCloudEsc); } catch {}
    // Eingebettete Websites: echter Chrome-User-Agent (bessere Login-Kompatibilitaet)
    // + Ad-Blocker auf Session-Ebene (blockt Werbe-/Tracker-Requests).
    try { _0xGuest.setUserAgent(WEBVIEW_CHROME_UA); } catch {}
    try { installAdBlock(_0xGuest.session); } catch {}
    // YouTube-Ad-Skip bei jedem Laden injizieren (nur auf YT-Seiten).
    try {
      _0xGuest.on("dom-ready", () => {
        try {
          const _0xyu = _0xGuest.getURL() || "";
          if (/youtube\.com|youtu\.be/i.test(_0xyu)) {
            _0xGuest.executeJavaScript(YT_ADSKIP_JS, true).catch(() => {});
          }
        } catch {}
      });
    } catch {}
  });
  // Ad-Blocker direkt auf den Webview-Sessions registrieren (zuverlaessiger als
  // nur per-attach, da die Webviews statisch in der index.html liegen).
  try { installAdBlock(session.fromPartition("persist:publisher")); } catch {}
  try { installAdBlock(session.fromPartition("persist:geforcenow")); } catch {}
  mainWindow.webContents.setWindowOpenHandler(({
    url: _0x50b5bf,
    frameName: _0x3a9fde
  }) => {
    if (_0x3a9fde === "oauth_popup") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 600,
          height: 720,
          autoHideMenuBar: true,
          parent: mainWindow
        }
      };
    }
    if (/^https?:\/\//i.test(_0x50b5bf)) {
      shell.openExternal(_0x50b5bf);
    }
    return {
      action: "deny"
    };
  });
}
async function fetchVcChunk(_0x1ea9cf, _0x50db5c, _0xd9518e, _0x4dbbeb, _0xfb9d39, _0x53f00c = 3) {
  const _0x47ecdc = _0x1ea9cf + "/removed/" + encodeURIComponent(_0x50db5c) + "/chunk/" + _0xd9518e;
  for (let _0x2c6307 = 0; _0x2c6307 < _0x53f00c; _0x2c6307++) {
    try {
      const _0x4c11d8 = await fetch(_0x47ecdc, {
        headers: {
          ...(_0x4dbbeb ? {
            Authorization: "Bearer " + _0x4dbbeb
          } : {}),
          ...watermarkHeaders(_0x47ecdc, _0xfb9d39)
        }
      });
      if (_0x4c11d8.ok) {
        return Buffer.from(await _0x4c11d8.arrayBuffer());
      }
    } catch {}
    await new Promise(_0x400065 => setTimeout(_0x400065, (_0x2c6307 + 1) * 400));
  }
  return null;
}
function listFixedDrives() {
  if (!IS_WIN) {
    return Promise.resolve([]);
  }
  return new Promise(_0x31d7ef => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Json -Compress"], {
      windowsHide: true,
      timeout: 8000
    }, (_0x5026d8, _0x3fecf3) => {
      if (_0x5026d8 || !_0x3fecf3) {
        return _0x31d7ef([]);
      }
      try {
        let _0x1aa29a = JSON.parse(_0x3fecf3);
        if (!Array.isArray(_0x1aa29a)) {
          _0x1aa29a = [_0x1aa29a];
        }
        _0x31d7ef(_0x1aa29a.filter(_0x13e22f => _0x13e22f && _0x13e22f.DeviceID).map(_0x3b6215 => ({
          drive: _0x3b6215.DeviceID,
          root: _0x3b6215.DeviceID + "\\",
          label: _0x3b6215.VolumeName || "",
          freeBytes: Number(_0x3b6215.FreeSpace) || 0,
          totalBytes: Number(_0x3b6215.Size) || 0
        })));
      } catch {
        _0x31d7ef([]);
      }
    });
  });
}
let dlConcurrency = 1;
const dlQueue = [];
const dlActive = new Map();
function emitQueueState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("download:queue", {
      active: [...dlActive.keys()],
      queued: dlQueue.map((_0xd81dc5, _0x17d932) => ({
        gameId: _0xd81dc5.gameId,
        title: _0xd81dc5.title,
        position: _0x17d932 + 1
      }))
    });
  }
}
function pumpQueue() {
  while (dlActive.size < dlConcurrency && dlQueue.length) {
    const _0x3b2859 = dlQueue.shift();
    const _0x35091d = {
      abort: false
    };
    dlActive.set(_0x3b2859.gameId, _0x35091d);
    emitQueueState();
    performVcDownload({
      ..._0x3b2859.opts,
      _abort: _0x35091d
    }).then(_0x3cd800 => _0x3b2859.resolve(_0x3cd800)).catch(_0x3d50b6 => _0x3b2859.resolve({
      ok: false,
      error: _0x3d50b6 && _0x3d50b6.message || "Download fehlgeschlagen."
    })).finally(() => {
      dlActive.delete(_0x3b2859.gameId);
      emitQueueState();
      pumpQueue();
    });
  }
}
function enqueueDownload(_0x4b14ba) {
  return new Promise(_0x45efd7 => {
    const _0x220bdf = String(_0x4b14ba.gameId);
    if (dlActive.has(_0x220bdf) || dlQueue.some(_0x484624 => _0x484624.gameId === _0x220bdf)) {
      _0x45efd7({
        ok: false,
        error: "Download läuft bereits oder ist eingereiht."
      });
      return;
    }
    dlQueue.push({
      gameId: _0x220bdf,
      title: _0x4b14ba.title,
      opts: _0x4b14ba,
      resolve: _0x45efd7
    });
    emitQueueState();
    pumpQueue();
  });
}
async function performVcDownload({
  gameId: _0x1bf83c,
  title: _0x9d6a89,
  key: _0x3cf1a6,
  targetDir: _0xd9defb,
  _abort: _0x5ee982
} = {}) {
  // asar-Bugfix: Spieldateien können app.asar heißen. Electrons gepatchtes fs behandelt
  // jeden .asar-Pfad als (schreibgeschütztes) Archiv → ENOENT beim Download. original-fs
  // ist Electrons ungepatchtes fs ohne asar-Sonderbehandlung. Nur diese Funktion (inkl.
  // aller verschachtelten Download-Helfer via Closure) schreibt/liest echte Spieldateien.
  const fs = require("original-fs");
  const _0x47befd = loadSettings();
  const _0x5f1c75 = (_0x47befd.apiBaseUrl || "").replace(/\/$/, "");
  const _0x39944e = _0x47befd.user && (_0x47befd.user.id || _0x47befd.user.user_id);
  if (!_0x5f1c75 || !_0x1bf83c) {
    return {
      ok: false,
      error: "Keine GameID."
    };
  }
  const _0x5c2677 = {
    "Content-Type": "application/json",
    "X-Launcher-Version": app.getVersion(),
    ...(_0x47befd.sessionToken ? {
      Authorization: "Bearer " + _0x47befd.sessionToken
    } : {})
  };
  const _0x5a8a10 = {
    "X-Launcher-Version": app.getVersion(),
    ...(_0x47befd.sessionToken ? {
      Authorization: "Bearer " + _0x47befd.sessionToken
    } : {})
  };
  let _0x4e6d6a = Date.now();
  let _0x513b00 = 0;
  let _0x4d5632 = 0;
  const _0x1d2fdd = (_0x784aed, _0x51b357, _0x4c4c91) => {
    const _0x1fd348 = Date.now();
    if (_0x51b357 != null && _0x1fd348 - _0x4e6d6a >= 500) {
      const _0x5049f7 = (_0x1fd348 - _0x4e6d6a) / 1000;
      if (_0x5049f7 > 0) {
        _0x4d5632 = Math.max(0, (_0x51b357 - _0x513b00) / _0x5049f7);
      }
      _0x4e6d6a = _0x1fd348;
      _0x513b00 = _0x51b357;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("download:progress", {
        gameId: _0x1bf83c,
        pct: _0x784aed,
        ...(_0x51b357 != null ? {
          done: _0x51b357
        } : {}),
        ...(_0x4c4c91 != null ? {
          total: _0x4c4c91
        } : {}),
        bps: Math.round(_0x4d5632)
      });
    }
  };
  if (!_0x3cf1a6 && _0x39944e) {
    try {
      const _0x1e1d00 = await fetch(_0x5f1c75 + "/removed", {
        method: "POST",
        headers: {
          ..._0x5c2677,
          ...watermarkHeaders(_0x5f1c75 + "/removed")
        },
        body: JSON.stringify({
          userId: _0x39944e,
          game_id: _0x1bf83c
        })
      });
      const _0x173287 = await _0x1e1d00.json().catch(() => null);
      if (_0x173287 && _0x173287.key) {
        _0x3cf1a6 = _0x173287.key;
      }
    } catch {}
  }
  const _0x1c1ffd = _0x3cf1a6 ? {
    k: _0x3cf1a6,
    gid: _0x1bf83c
  } : null;
  const _0x1602c6 = currentPlatformId();
  let _0x78d68e = null;
  let _0x530430 = 0;
  try {
    const _0xffac1f = await fetch(_0x5f1c75 + "/removed", {
      method: "POST",
      headers: {
        ..._0x5c2677,
        ...watermarkHeaders(_0x5f1c75 + "/removed", _0x1c1ffd)
      },
      body: JSON.stringify(_0x3cf1a6 ? {
        game_id: _0x1bf83c,
        key: _0x3cf1a6,
        platform: _0x1602c6
      } : {
        game_id: _0x1bf83c,
        platform: _0x1602c6
      })
    });
    _0x530430 = _0xffac1f.status;
    _0x78d68e = await _0xffac1f.json().catch(() => null);
  } catch {
    return {
      ok: false,
      error: "Server nicht erreichbar."
    };
  }
  if (!_0x78d68e || _0x78d68e.ok === false || _0x78d68e.download_allowed === false) {
    return {
      ok: false,
      error: _0x78d68e && _0x78d68e.error || "Download abgelehnt (HTTP " + _0x530430 + ")."
    };
  }
  const _0x592b4e = String(_0x9d6a89 || _0x1bf83c).replace(/[^\w.\- ]+/g, "_").trim() || String(_0x1bf83c);
  const _0x2be191 = (loadSettings().vcInstalled || {})[_0x1bf83c];
  let _0x4b3eb9;
  if (_0x2be191 && _0x2be191.dir) {
    _0x4b3eb9 = _0x2be191.dir;
  } else {
    const _0x25394e = _0xd9defb ? path.join(_0xd9defb, "VisCode Games") : path.join(app.getPath("downloads"), "VisCode Games");
    _0x4b3eb9 = path.join(_0x25394e, _0x592b4e);
  }
  try {
    let _0x7016a = _0x78d68e.manifest && (/^https?:/i.test(_0x78d68e.manifest) ? _0x78d68e.manifest : _0x5f1c75 + _0x78d68e.manifest) || _0x5f1c75 + "/removed/" + encodeURIComponent(_0x1bf83c) + "/manifest";
    // Immer die NEUESTE Fassung laden: slot=latest erzwingen, wenn keine explizite version/slot in der URL steht.
    // Verhindert, dass eine alte/gecachte Manifest-URL vom download/start die alte Version herunterlädt.
    if (!/[?&](slot|version)=/i.test(_0x7016a)) _0x7016a += (_0x7016a.includes("?") ? "&" : "?") + "slot=latest";
    const _0x372436 = await fetchJson(withPlatform(_0x7016a, _0x1602c6), {
      headers: _0x5a8a10,
      wm: _0x1c1ffd
    }, 15000);
    if (!_0x372436 || !Array.isArray(_0x372436.files)) {
      return {
        ok: false,
        error: "Manifest ungültig oder leer."
      };
    }
    const _0x29cdfe = _0x372436.total_size || _0x78d68e.total_size || _0x372436.files.reduce((_0x5b0470, _0x94e993) => _0x5b0470 + (_0x94e993.size || 0), 0) || 1;
    let _0x4bb0a6 = 0;
    let _changedBytes = 0;
    let _skippedBytes = 0;
    fs.mkdirSync(_0x4b3eb9, {
      recursive: true
    });
    _0x1d2fdd(0, 0, _0x29cdfe);
    // ── Delta-Helfer ────────────────────────────────────────────────────────
    const _isAbort = () => _0x5ee982 && _0x5ee982.abort;
    // lädt einen Chunk vom Server und prüft SHA256 (wie im alten Voll-Download)
    const _fetchChunkChecked = async _0x54c64e => {
      const _0x6ebeeb = await fetchVcChunk(_0x5f1c75, _0x1bf83c, _0x54c64e.hash, _0x47befd.sessionToken, _0x1c1ffd);
      if (!_0x6ebeeb) {
        throw new Error("Chunk " + _0x54c64e.nr + " nicht ladbar");
      }
      if (_0x54c64e.hash) {
        const _0x49dcde = crypto.createHash("sha256").update(_0x6ebeeb).digest("hex");
        if (_0x49dcde !== _0x54c64e.hash) {
          throw new Error("Chunk " + _0x54c64e.nr + " beschädigt (Hash stimmt nicht)");
        }
      }
      return _0x6ebeeb;
    };
    // Fortschritt fortschreiben (changed = frisch geladen, sonst übersprungen/lokal wiederverwendet)
    const _bump = (_0x5b1f2e, _0x2c9a01) => {
      _0x4bb0a6 += _0x5b1f2e;
      if (_0x2c9a01) {
        _changedBytes += _0x5b1f2e;
      } else {
        _skippedBytes += _0x5b1f2e;
      }
      _0x1d2fdd(Math.min(99, Math.floor(_0x4bb0a6 / _0x29cdfe * 100)), _0x4bb0a6, _0x29cdfe);
    };
    // Per-Chunk-in-place-Delta über Temp-Datei (.vupd) + atomarem rename.
    // Passende Chunks werden aus der alten Datei kopiert, nur abweichende neu geladen.
    const _processFileDelta = async (_0x3fcf4f, _0x17a505) => {
      const _tmpPath = _0x3fcf4f + ".vupd";
      let _off = 0;
      const _plan = _0x17a505.map(_0x54c64e => {
        const _entry = {
          chunk: _0x54c64e,
          offset: _off,
          size: _0x54c64e.size || 0
        };
        _off += _0x54c64e.size || 0;
        return _entry;
      });
      let _oldFd = null;
      let _oldSize = 0;
      if (fs.existsSync(_0x3fcf4f)) {
        try {
          _oldFd = fs.openSync(_0x3fcf4f, "r");
          _oldSize = fs.statSync(_0x3fcf4f).size;
        } catch {
          _oldFd = null;
        }
      }
      const _tmpFd = fs.openSync(_tmpPath, "w");
      try {
        for (const _p of _plan) {
          if (_isAbort()) {
            throw new Error("Abgebrochen");
          }
          let _reuse = null;
          // Lokalen Byte-Bereich lesen + hashen; bei Übereinstimmung wiederverwenden.
          if (_oldFd != null && _p.chunk.hash && _oldSize >= _p.offset + _p.size) {
            try {
              const _rb = Buffer.allocUnsafe(_p.size);
              fs.readSync(_oldFd, _rb, 0, _p.size, _p.offset);
              const _rh = crypto.createHash("sha256").update(_rb).digest("hex");
              if (_rh === _p.chunk.hash) {
                _reuse = _rb;
              }
            } catch {
              _reuse = null;
            }
          }
          if (_reuse) {
            fs.writeSync(_tmpFd, _reuse, 0, _p.size);
            _bump(_p.size, false);
          } else {
            const _0x6ebeeb = await _fetchChunkChecked(_p.chunk);
            fs.writeSync(_tmpFd, _0x6ebeeb, 0, _0x6ebeeb.length);
            _bump(_0x6ebeeb.length, true);
          }
        }
      } finally {
        fs.closeSync(_tmpFd);
        if (_oldFd != null) {
          try {
            fs.closeSync(_oldFd);
          } catch {}
        }
      }
      // atomar ersetzen (unter Windows Ziel vorher entfernen)
      try {
        if (fs.existsSync(_0x3fcf4f)) {
          fs.unlinkSync(_0x3fcf4f);
        }
      } catch {}
      fs.renameSync(_tmpPath, _0x3fcf4f);
    };
    // Voll-Download einer Datei (Fallback bei Delta-Fehler, oder für neue Dateien).
    const _processFileFull = async (_0x3fcf4f, _0x17a505) => {
      const _0xc8fc68 = fs.openSync(_0x3fcf4f, "w");
      try {
        for (const _0x54c64e of _0x17a505) {
          if (_isAbort()) {
            throw new Error("Abgebrochen");
          }
          const _0x6ebeeb = await _fetchChunkChecked(_0x54c64e);
          fs.writeSync(_0xc8fc68, _0x6ebeeb, 0, _0x6ebeeb.length);
          _bump(_0x6ebeeb.length, true);
        }
      } finally {
        fs.closeSync(_0xc8fc68);
      }
    };
    // ────────────────────────────────────────────────────────────────────────
    const _keptFiles = new Set(); // absolute (lowercase) Pfade aller Manifest-Dateien → Orphan-Schutz
    for (const _0x5da46a of _0x372436.files) {
      if (_isAbort()) {
        throw new Error("Abgebrochen");
      }
      const _0x5ca67a = String(_0x5da46a.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!_0x5ca67a || _0x5ca67a.split("/").includes("..")) {
        continue;
      }
      const _0x3fcf4f = path.join(_0x4b3eb9, _0x5ca67a);
      _keptFiles.add(path.resolve(_0x3fcf4f).toLowerCase());
      fs.mkdirSync(path.dirname(_0x3fcf4f), {
        recursive: true
      });
      const _0x17a505 = (_0x5da46a.chunks || []).slice().sort((_0x4533af, _0x14ed84) => (_0x4533af.index || 0) - (_0x14ed84.index || 0));
      // Zählerstände sichern, damit ein Delta-Fehler sauber auf Voll-Download zurückfallen kann.
      const _snapDone = _0x4bb0a6;
      const _snapChanged = _changedBytes;
      const _snapSkipped = _skippedBytes;
      try {
        await _processFileDelta(_0x3fcf4f, _0x17a505);
      } catch (_deltaErr) {
        if (_deltaErr && /Abgebrochen/.test(_deltaErr.message)) {
          throw _deltaErr;
        }
        // Delta gescheitert → Zähler zurücksetzen, Temp-Rest entfernen, Datei komplett neu laden.
        _0x4bb0a6 = _snapDone;
        _changedBytes = _snapChanged;
        _skippedBytes = _snapSkipped;
        try {
          if (fs.existsSync(_0x3fcf4f + ".vupd")) {
            fs.unlinkSync(_0x3fcf4f + ".vupd");
          }
        } catch {}
        await _processFileFull(_0x3fcf4f, _0x17a505);
      }
    }
    // Verwaiste Dateien entfernen (nur INNERHALB des Spiel-Ordners; strenge Pfad-Prüfung).
    try {
      const _dirResolved = path.resolve(_0x4b3eb9);
      const _dirPrefix = _dirResolved.toLowerCase() + path.sep;
      const _walkClean = _0xdir => {
        let _entries;
        try {
          _entries = fs.readdirSync(_0xdir, {
            withFileTypes: true
          });
        } catch {
          return;
        }
        for (const _ent of _entries) {
          const _full = path.join(_0xdir, _ent.name);
          const _resLower = path.resolve(_full).toLowerCase();
          // niemals außerhalb von dir agieren
          if (_resLower !== _dirResolved.toLowerCase() && !_resLower.startsWith(_dirPrefix)) {
            continue;
          }
          if (_ent.isDirectory()) {
            _walkClean(_full);
            try {
              if (fs.readdirSync(_full).length === 0) {
                fs.rmdirSync(_full);
              }
            } catch {}
          } else if (_ent.isFile()) {
            // nicht im Manifest (inkl. übrig gebliebener .vupd-Reste) → löschen
            if (!_keptFiles.has(_resLower)) {
              try {
                fs.unlinkSync(_full);
              } catch {}
            }
          }
        }
      };
      _walkClean(_0x4b3eb9);
    } catch {}
    _0x1d2fdd(100, _0x29cdfe, _0x29cdfe);
    const _0x31329b = findGameExe(_0x4b3eb9);
    let _0x4c908b = null;
    if (_0x31329b && _0x47befd.vcDesktopShortcut !== false) {
      try {
        const _0x32ff13 = app.getPath("desktop");
        const _0x159308 = String(_0x9d6a89 || _0x1bf83c).replace(/[\\/:*?"<>|]+/g, "").trim() || String(_0x1bf83c);
        const _0x3cd9d7 = path.join(_0x32ff13, _0x159308 + ".lnk");
        shell.writeShortcutLink(_0x3cd9d7, "create", {
          target: _0x31329b,
          cwd: path.dirname(_0x31329b),
          icon: _0x31329b,
          iconIndex: 0,
          description: (_0x9d6a89 || _0x1bf83c) + " – VisCode"
        });
        _0x4c908b = _0x3cd9d7;
      } catch (_0x37fb3a) {
        console.log("[VisCode] Desktop-Verknüpfung fehlgeschlagen:", _0x37fb3a && _0x37fb3a.message);
      }
    }
    const _0x3ac002 = loadSettings();
    _0x3ac002.vcInstalled = _0x3ac002.vcInstalled || {};
    _0x3ac002.vcInstalled[_0x1bf83c] = {
      ...(_0x3ac002.vcInstalled[_0x1bf83c] || {}),
      dir: _0x4b3eb9,
      title: _0x9d6a89 || _0x1bf83c,
      exe: _0x31329b || null,
      version: _0x372436.version || _0x78d68e.version || null,
      zip: null,
      shortcut: _0x4c908b
    };
    saveSettings(_0x3ac002);
    return {
      ok: true,
      path: _0x4b3eb9,
      dir: _0x4b3eb9,
      exe: _0x31329b,
      version: _0x372436.version || _0x78d68e.version || null,
      shortcut: _0x4c908b,
      changedBytes: _changedBytes,
      upToDate: _changedBytes === 0
    };
  } catch (_0x2be5d3) {
    return {
      ok: false,
      error: "Download fehlgeschlagen: " + (_0x2be5d3 && _0x2be5d3.message)
    };
  }
}
let gameUpdateTimer = null;
let gameUpdateRunning = false;
async function checkVcGameUpdates() {
  if (gameUpdateRunning) {
    return;
  }
  const _0x3716bf = loadSettings();
  if (_0x3716bf.vcAutoUpdate === false) {
    return;
  }
  const _0x2a2d37 = (_0x3716bf.apiBaseUrl || "").replace(/\/$/, "");
  const _0x54888a = _0x3716bf.vcInstalled || {};
  const _0x57c897 = Object.keys(_0x54888a);
  if (!_0x2a2d37 || !_0x3716bf.sessionToken || !_0x57c897.length) {
    return;
  }
  gameUpdateRunning = true;
  try {
    for (const _0x11cb66 of _0x57c897) {
      const _0x18fb16 = (loadSettings().vcInstalled || {})[_0x11cb66] || {};
      const _0x393a83 = await fetchJson(withPlatform(_0x2a2d37 + "/removed/" + encodeURIComponent(_0x11cb66) + "/manifest?slot=latest"), {
        headers: {
          Authorization: "Bearer " + _0x3716bf.sessionToken
        }
      }, 10000);
      const _0xa8d24d = _0x393a83 && _0x393a83.version;
      if (!_0xa8d24d) {
        continue;
      }
      if (_0x18fb16.version == null) {
        const _0x5f11a3 = loadSettings();
        if (_0x5f11a3.vcInstalled[_0x11cb66]) {
          _0x5f11a3.vcInstalled[_0x11cb66].version = _0xa8d24d;
          saveSettings(_0x5f11a3);
        }
        continue;
      }
      if (String(_0xa8d24d) !== String(_0x18fb16.version)) {
        console.log("[VisCode-Helper] Update für „" + (_0x18fb16.title || _0x11cb66) + "\": " + _0x18fb16.version + " → " + _0xa8d24d + " – lade herunter …");
        const _0xd6e329 = await performVcDownload({
          gameId: _0x11cb66,
          title: _0x18fb16.title
        });
        if (_0xd6e329 && _0xd6e329.ok) {
          // Nur bei echtem Update melden – wenn Delta nichts geladen hat (upToDate), kein Toast.
          if (!_0xd6e329.upToDate && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("vc:game-updated", {
              gameId: _0x11cb66,
              title: _0x18fb16.title,
              version: _0xa8d24d
            });
          }
          if (_0xd6e329.upToDate) {
            console.log("[VisCode-Helper] „" + (_0x18fb16.title || _0x11cb66) + "\" war bereits aktuell (Delta: nichts zu laden).");
          } else {
            console.log("[VisCode-Helper] „" + (_0x18fb16.title || _0x11cb66) + "\" auf " + _0xa8d24d + " aktualisiert ✓");
          }
        } else {
          console.log("[VisCode-Helper] Update für „" + (_0x18fb16.title || _0x11cb66) + "\" fehlgeschlagen: " + (_0xd6e329 && _0xd6e329.error));
        }
      }
    }
  } catch (_0x45040f) {
    console.log("[VisCode-Helper] Prüfung fehlgeschlagen:", _0x45040f && _0x45040f.message);
  } finally {
    gameUpdateRunning = false;
  }
}
function startGameUpdateHelper() {
  if (gameUpdateTimer) {
    return;
  }
  console.log("[VisCode-Helper] gestartet – prüft alle 10 Minuten auf Spiel-Updates (Hintergrund).");
  setTimeout(() => checkVcGameUpdates().catch(() => {}), 30000);
  gameUpdateTimer = setInterval(() => checkVcGameUpdates().catch(() => {}), 600000);
}
let currentGame = null;
async function setPresence(_0x378129) {
  const _0x2a30e9 = loadSettings();
  const _0x5fe243 = (_0x2a30e9.apiBaseUrl || "").replace(/\/$/, "");
  if (!_0x5fe243 || !_0x2a30e9.sessionToken) {
    return;
  }
  try {
    await fetch(_0x5fe243 + "/removed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + _0x2a30e9.sessionToken,
        "X-Launcher-Version": app.getVersion(),
        ...watermarkHeaders(_0x5fe243 + "/removed")
      },
      body: JSON.stringify({
        online: !!_0x378129,
        game: _0x378129 && currentGame ? {
          title: currentGame.title,
          platform: currentGame.platform
        } : null
      })
    });
  } catch {}
}
let presenceTimer = null;
function startPresence() {
  if (presenceTimer) {
    return;
  }
  setTimeout(() => setPresence(true), 8000);
  presenceTimer = setInterval(() => setPresence(true), 60000);
}
let gameExeMap = null;
let gameExeMapAt = 0;
async function buildGameExeMap() {
  const _0x378aab = new Map();
  const _0x521963 = (_0x567517, _0x4e8422, _0x5d7769) => {
    if (_0x567517 && _0x4e8422) {
      const _0x36692a = path.basename(String(_0x567517)).toLowerCase();
      if (!_0x378aab.has(_0x36692a)) {
        _0x378aab.set(_0x36692a, {
          title: _0x4e8422,
          platform: _0x5d7769
        });
      }
    }
  };
  try {
    const _0x3ebc14 = loadManualStore();
    (_0x3ebc14.games || []).forEach(_0x3c7c7c => _0x521963(_0x3c7c7c.exePath, _0x3c7c7c.title, "other"));
  } catch {}
  try {
    const _0x2839e8 = loadSettings().vcInstalled || {};
    Object.values(_0x2839e8).forEach(_0xfa2783 => {
      if (_0xfa2783 && _0xfa2783.dir) {
        const _0x4f4f09 = findGameExe(_0xfa2783.dir);
        if (_0x4f4f09) {
          _0x521963(_0x4f4f09, _0xfa2783.title, "viscode");
        }
      }
    });
  } catch {}
  try {
    const _0x37b053 = await scanXbox();
    (_0x37b053 || []).forEach(_0x550223 => _0x521963(_0x550223.exePath, _0x550223.title, "xbox"));
  } catch {}
  try {
    const _0x45f298 = await findSteamPath();
    if (_0x45f298) {
      for (const _0xb8e330 of steamLibraries(_0x45f298)) {
        const _0x242942 = path.join(_0xb8e330, "steamapps");
        let _0x2ff214 = [];
        try {
          _0x2ff214 = fs.readdirSync(_0x242942).filter(_0x33c0cb => /^appmanifest_\d+\.acf$/i.test(_0x33c0cb));
        } catch {
          continue;
        }
        for (const _0x28aa7e of _0x2ff214) {
          try {
            const _0x205de5 = fs.readFileSync(path.join(_0x242942, _0x28aa7e), "utf8");
            const _0x1e0ce7 = (_0x205de5.match(/"name"\s+"([^"]+)"/i) || [])[1];
            const _0x282ce4 = (_0x205de5.match(/"installdir"\s+"([^"]+)"/i) || [])[1];
            if (_0x1e0ce7 && _0x282ce4) {
              const _0x2ad4a3 = findGameExe(path.join(_0x242942, "common", _0x282ce4));
              if (_0x2ad4a3) {
                _0x521963(_0x2ad4a3, _0x1e0ce7, "steam");
              }
            }
          } catch {}
        }
      }
    }
  } catch {}
  try {
    const _0x1bea34 = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
    let _0x343258 = [];
    try {
      _0x343258 = fs.readdirSync(_0x1bea34).filter(_0x4822b9 => /\.item$/i.test(_0x4822b9));
    } catch {
      _0x343258 = [];
    }
    for (const _0x4a5cf6 of _0x343258) {
      try {
        const _0x30515f = JSON.parse(fs.readFileSync(path.join(_0x1bea34, _0x4a5cf6), "utf8"));
        const _0x1c5f3c = _0x30515f.LaunchExecutable && _0x30515f.InstallLocation ? path.join(_0x30515f.InstallLocation, _0x30515f.LaunchExecutable) : null;
        _0x521963(_0x1c5f3c, _0x30515f.DisplayName || _0x30515f.AppName, "epic");
      } catch {}
    }
  } catch {}
  return _0x378aab;
}
async function detectCurrentGame() {
  for (const _0x35a117 of Object.keys(vcChildren)) {
    const _0xd0fbfc = vcChildren[_0x35a117];
    if (_0xd0fbfc && _0xd0fbfc.exitCode == null && !_0xd0fbfc.killed) {
      const _0x50f6aa = (loadSettings().vcInstalled || {})[_0x35a117];
      if (_0x50f6aa) {
        return {
          title: _0x50f6aa.title || "VisCode-Spiel",
          platform: "viscode"
        };
      }
    }
  }
  if (!IS_WIN) {
    return null;
  }
  if (!gameExeMap || Date.now() - gameExeMapAt > 300000) {
    gameExeMap = await buildGameExeMap();
    gameExeMapAt = Date.now();
  }
  if (!gameExeMap.size) {
    return null;
  }
  const _0x2f44ee = await new Promise(_0x2c89c9 => {
    execFile("tasklist", ["/FO", "CSV", "/NH"], {
      maxBuffer: 4194304
    }, (_0x105d38, _0x5ca2be) => {
      if (_0x105d38 || !_0x5ca2be) {
        return _0x2c89c9(new Set());
      }
      const _0x83fd43 = new Set();
      _0x5ca2be.split(/\r?\n/).forEach(_0x5bc84 => {
        const _0x4f3da1 = _0x5bc84.match(/^"([^"]+\.exe)"/i);
        if (_0x4f3da1) {
          _0x83fd43.add(_0x4f3da1[1].toLowerCase());
        }
      });
      _0x2c89c9(_0x83fd43);
    });
  });
  for (const [_0x3aea6d, _0x144209] of gameExeMap) {
    if (_0x2f44ee.has(_0x3aea6d)) {
      return {
        title: _0x144209.title,
        platform: _0x144209.platform
      };
    }
  }
  return null;
}
let gameTrackTimer = null;
async function tickGameTracker() {
  let _0x1ce190 = null;
  try {
    _0x1ce190 = await detectCurrentGame();
  } catch {
    _0x1ce190 = null;
  }
  const _0x4a9fb8 = currentGame ? currentGame.title : null;
  const _0x58c5fb = _0x1ce190 ? _0x1ce190.title : null;
  currentGame = _0x1ce190;
  if (_0x4a9fb8 !== _0x58c5fb) {
    setPresence(true);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("presence:game", _0x58c5fb);
      }
    } catch {}
  }
}
function startGameTracker() {
  if (gameTrackTimer) {
    return;
  }
  setTimeout(() => tickGameTracker(), 15000);
  gameTrackTimer = setInterval(() => tickGameTracker(), 20000);
}
async function reportLauncherVersion() {
  const _0x3e64ad = loadSettings();
  const _0x55480c = (_0x3e64ad.apiBaseUrl || "").replace(/\/$/, "");
  const _0x2ae476 = _0x3e64ad.user && (_0x3e64ad.user.username || _0x3e64ad.user.displayName || _0x3e64ad.user.id);
  const _0x1f9672 = _0x3e64ad.user && (_0x3e64ad.user.id || _0x3e64ad.user.user_id) || null;
  const _0xeb42ad = app.getVersion();
  if (!_0x55480c || !_0x2ae476) {
    return;
  }
  const _0x586615 = _0x3e64ad.lastReportedVersion || null;
  const _0x5b5a3c = !!_0x586615 && _0x586615 !== _0xeb42ad;
  const _0x5c9771 = new Date().toISOString();
  try {
    const _0x4c3467 = await fetch(_0x55480c + "/removed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(_0x3e64ad.sessionToken ? {
          Authorization: "Bearer " + _0x3e64ad.sessionToken
        } : {}),
        ...watermarkHeaders(_0x55480c + "/removed")
      },
      body: JSON.stringify({
        userId: _0x1f9672,
        username: _0x2ae476,
        version: _0xeb42ad,
        previousVersion: _0x586615,
        updated: _0x5b5a3c,
        at: _0x5c9771
      })
    });
    if (_0x4c3467.ok) {
      const _0x4b7bd1 = loadSettings();
      _0x4b7bd1.lastReportedVersion = _0xeb42ad;
      saveSettings(_0x4b7bd1);
    }
  } catch {}
}
try {
  if (loadSettings().performanceMode) {
    app.commandLine.appendSwitch("js-flags", "--expose-gc --max-old-space-size=384");
    app.commandLine.appendSwitch("disk-cache-size", "8388608");
    app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  }
} catch {}
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else {
  app.on("second-instance", (_0x18fbd4, _0x59a2e8) => {
    const _0xvybg = parseVybgArg(_0x59a2e8);
    if (_0xvybg) {
      deliverVybg(_0xvybg);
      return;
    }
    const _0xwaArg = parseWebAppArg(_0x59a2e8);
    if (_0xwaArg) {
      openWebAppWindow(_0xwaArg, "", "");
      return;
    }
    const _0x148901 = findDeepLinkInArgv(_0x59a2e8);
    if (_0x148901) {
      dispatchDeepLink(_0x148901);
    } else {
      hauptfensterZeigen();
    }
  });
  app.on("open-url", (_0x3674c7, _0x1a5338) => {
    _0x3674c7.preventDefault();
    dispatchDeepLink(_0x1a5338);
  });
  app.whenReady().then(() => {
    // Mini-Musik-Player: vystra-audio:// -> echte Datei auf der Platte.
    // Renderer setzt audio.src = "vystra-audio://" + encodeURI(pfadMitForwardSlashes).
    try {
      protocol.registerFileProtocol("vystra-audio", (_0xmreq, _0xmcb) => {
        try {
          let _0xmp = decodeURIComponent(_0xmreq.url.replace(/^vystra-audio:\/\//, ""));
          // Windows-Pfade: aus /C:/... wieder C:\... machen.
          _0xmp = _0xmp.replace(/\//g, path.sep);
          if (IS_WIN) {
            _0xmp = _0xmp.replace(/^\\+/, "");
          }
          _0xmcb({
            path: _0xmp
          });
        } catch (_0xmperr) {
          _0xmcb({
            error: -2
          });
        }
      });
    } catch (_0xmpreg) {
      console.log("[Music] Protokoll-Registrierung fehlgeschlagen:", _0xmpreg && _0xmpreg.message);
    }
    // Einstellungen/Login vom alten VisCode-Ordner übernehmen, falls der neue leer ist
    try {
      const _ud = app.getPath("userData");            // neuer Ordner (Vystra Launcher)
      if (!fs.existsSync(path.join(_ud, "settings.json"))) {
        const _appData = app.getPath("appData");
        for (const _old of ["VisCode Launcher", "viscode-launcher"]) {
          const _oldDir = path.join(_appData, _old);
          if (fs.existsSync(path.join(_oldDir, "settings.json"))) {
            fs.cpSync(_oldDir, _ud, { recursive: true, errorOnExist: false, force: false });
            console.log("[Migration] Einstellungen von", _old, "uebernommen.");
            break;
          }
        }
      }
    } catch (e) { console.log("[Migration] fehlgeschlagen:", e && e.message); }
    // App-Start zählen (für „Bewertungs-Popup erst ab dem 2. Öffnen")
    try {
      const _s = loadSettings();
      _s.appOpenCount = (_s.appOpenCount || 0) + 1;
      saveSettings(_s);
    } catch {}
    try {
      app.setAppUserModelId("com.vystra.launcher");
    } catch {}
    try {
      if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient("viscode", process.execPath, [path.resolve(process.argv[1])]);
      } else {
        app.setAsDefaultProtocolClient("viscode");
      }
    } catch {}
    const _0x3b991d = findDeepLinkInArgv(process.argv);
    if (_0x3b991d) {
      pendingDeepLink = parseDeepLink(_0x3b991d);
    }
    initWatermarkHwid();
    registerIpc();
    createWindow();
    // Von einer „Web zu App"-Desktop-Verknüpfung gestartet? → direkt App-Fenster öffnen.
    try {
      const _0xwaStart = parseWebAppArg(process.argv);
      if (_0xwaStart) {
        openWebAppWindow(_0xwaStart, "", "");
      }
    } catch {}
    // Per Doppelklick auf eine .vybg-Datei gestartet? -> Hintergrund uebernehmen
    try {
      const _0xvybgStart = parseVybgArg(process.argv);
      if (_0xvybgStart) {
        deliverVybg(_0xvybgStart);
      }
    } catch {}
    createTray();
    startGameBridge();
    // Loopback-Bestaetigung "Vystra hat mich gestartet" fuer Spiele/Software.
    startVlHandshakeServer();
    // LAN-Dienste fuer die Quest-App: erst der UDP-Steckbrief, dann der Kanal.
    startVrDiscovery();
    startVrLanBridge();
    startGameUpdateHelper();
    startPresence();
    startGameTracker();
    setTimeout(() => reportLauncherVersion().catch(() => {}), 12000);
    checkHardware();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
  app.on("before-quit", () => {
    isQuitting = true;
    try {
      setPresence(false);
    } catch {}
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      setPresence(false);
      app.quit();
    }
  });
}