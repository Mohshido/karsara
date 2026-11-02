const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  extractPDF: (buffer) => ipcRenderer.invoke("extract-pdf", buffer),
  openFile: () => ipcRenderer.invoke("open-file"),
  speakText: (text) => ipcRenderer.invoke("speak-text", text),
  stopSpeak: () => ipcRenderer.invoke("stop-speak"),
  saveTxt: (text, fileName) =>
    ipcRenderer.invoke("save-txt", { text, fileName }),
  saveDocx: (text, fileName) =>
    ipcRenderer.invoke("save-docx", { text, fileName }),
  openInExplorer: (filePath) =>
    ipcRenderer.invoke("open-in-explorer", filePath),
});
