"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("aiScan", {
  start: () => ipcRenderer.invoke("ai-scan:start"),
  stop: () => ipcRenderer.invoke("ai-scan:stop"),
  onEvent: cb => ipcRenderer.on("ai-scan:event", (_e, d) => cb(d))
});
