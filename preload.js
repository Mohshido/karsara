const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  extractPDF: (arrayBuffer) =>
    ipcRenderer.invoke("extract-pdf", arrayBuffer),
  extractPDFPath: (filePath) =>
    ipcRenderer.invoke("extract-pdf-path", filePath),

  openFile: () => ipcRenderer.invoke("open-file"),
  onFileSelected: (callback) =>
    ipcRenderer.on("file-selected", (_e, filePath) => callback(filePath)),

  speakText: (text) => ipcRenderer.invoke("speak-text", text),
  stopSpeak: () => ipcRenderer.invoke("stop-speak"),
  onTTSDone: (callback) =>
    ipcRenderer.on("tts-done", () => callback()),

  saveTxt: (text, fileName) =>
    ipcRenderer.invoke("save-txt", { text, fileName }),
  saveDocx: (text, fileName) =>
    ipcRenderer.invoke("save-docx", { text, fileName }),
  openInExplorer: (filePath) =>
    ipcRenderer.invoke("open-in-explorer", filePath),

  navigate: (page) => ipcRenderer.invoke("navigate", page),

  onShortcutPlay: (cb) =>
    ipcRenderer.on("shortcut-play", () => cb()),
  onShortcutStop: (cb) =>
    ipcRenderer.on("shortcut-stop", () => cb()),
  onShortcutExportDocx: (cb) =>
    ipcRenderer.on("shortcut-export-docx", () => cb()),
  onShortcutExportTxt: (cb) =>
    ipcRenderer.on("shortcut-export-txt", () => cb()),
  onShortcutPasteFix: (cb) =>
    ipcRenderer.on("shortcut-paste-fix", () => cb()),
});
