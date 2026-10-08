"use strict";

const shot = document.getElementById("shot");
const grid = document.getElementById("grid");
const logEl = document.getElementById("log");
const gamesEl = document.getElementById("games");
const nowEl = document.getElementById("now");
const errEl = document.getElementById("err");
const ctx = grid.getContext("2d");
let last = null;

function pad(n) { return String(n).padStart(2, "0"); }
function stamp() {
  const d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

function addLog(text, kind) {
  const row = document.createElement("div");
  row.className = "row" + (kind ? " " + kind : "");
  row.innerHTML = "<span class=\"t\">" + stamp() + "</span>" + String(text || "");
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function drawOverlay() {
  const w = grid.clientWidth;
  const h = grid.clientHeight;
  if (!w || !h) return;
  grid.width = w;
  grid.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(124,106,242,.22)";
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  if (!last || !last.win) return;
  const iw = last.win.w || 1;
  const ih = last.win.h || 1;
  const scale = Math.min(w / iw, h / ih);
  const ox = (w - iw * scale) / 2;
  const oy = (h - ih * scale) / 2;
  const map = (x, y) => [ox + x * scale, oy + y * scale];
  ctx.strokeStyle = "#7dffa0";
  ctx.lineWidth = 2;
  for (const hit of last.hits || []) {
    const [x, y] = map(hit.x, hit.y);
    ctx.strokeRect(x, y, (hit.w || 20) * scale, (hit.h || 16) * scale);
  }
  if (last.click) {
    const cx = last.click.x - (last.win.x || 0);
    const cy = last.click.y - (last.win.y || 0);
    const [x, y] = map(cx, cy);
    ctx.fillStyle = "#fa5c7c";
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function onEvent(d) {
  if (!d) return;
  if (d.text) {
    nowEl.textContent = d.text;
    addLog(d.text, d.type === "error" ? "err" : (d.phase === "scan" || d.phase === "onlib" ? "ok" : ""));
  }
  if (d.type === "image") {
    last = d;
    if (d.dataUrl) shot.src = d.dataUrl;
    requestAnimationFrame(drawOverlay);
  }
  if (d.type === "games") {
    const name = d.launcher && d.launcher.name || "Launcher";
    const list = d.games || [];
    if (!list.length) {
      gamesEl.innerHTML = "<div class=\"g\">" + name + ": 0 Spiele</div>" + gamesEl.innerHTML;
    } else {
      gamesEl.innerHTML = "<div class=\"g\"><b>" + name + " · " + list.length + "</b></div>" +
        list.map(g => "<div class=\"g\">" + (g.name || g.title || g.id) + "</div>").join("") +
        gamesEl.innerHTML;
    }
  }
  if (d.type === "error") {
    errEl.hidden = false;
    errEl.textContent = d.text || ("Leider nicht möglich. " + (d.code || "") + " · " + (d.launcher || ""));
  }
}

window.addEventListener("resize", drawOverlay);
document.getElementById("startBtn").addEventListener("click", () => {
  errEl.hidden = true;
  window.aiScan.start();
});
document.getElementById("stopBtn").addEventListener("click", () => window.aiScan.stop());
window.aiScan.onEvent(onEvent);
window.aiScan.start();
