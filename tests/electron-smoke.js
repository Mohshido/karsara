// Runs the real preload, renderer storage and IPC in an isolated Electron profile.
const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "karsara-smoke-"));
app.setPath("userData", path.join(root, "profile"));
let exportPath;
const pdfPath = path.join(root, "report.final.PDF");
let pdf = "%PDF-1.4\n";
const offsets = [0];
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
const stream = "BT /F1 12 Tf 72 720 Td (Karsara PDF import) Tj ET\n";
objects.push(
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
);
objects.forEach((object, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
  .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(pdfPath, pdf);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfPath] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
require("../main");
const timeout = setTimeout(() => {
  console.error("Smoke test timed out");
  app.exit(1);
}, 90000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(win, expression) {
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(50);
  }
  throw new Error("Timed out: " + expression);
}
app
  .whenReady()
  .then(async () => {
    await delay(100);
    const win = BrowserWindow.getAllWindows()[0];
    if (win.webContents.isLoading())
      await once(win.webContents, "did-finish-load");
    const errors = [];
    win.webContents.on("console-message", (details) => {
      if (details.level === "error") {
        errors.push(details.message);
        console.error("Renderer:", details.message);
      }
    });
    const execute = (code) => win.webContents.executeJavaScript(code);
    assert.equal(
      await execute("typeof window.electronAPI.extractPDF"),
      "function",
    );
    assert.equal(await execute("window.electronAPI.extractPDFPath"), undefined);
    const invalid = await execute(
      'window.electronAPI.extractPDF(new TextEncoder().encode("not PDF"))',
    );
    assert.equal(invalid.success, false);
    await execute("documents.openFile()");
    await waitFor(
      win,
      'location.pathname.endsWith("editor.html") && document.getElementById("loadingOverlay").classList.contains("hidden")',
    );
    assert.match(
      await execute('document.getElementById("editorTextarea").value'),
      /Karsara PDF import/,
    );
    await execute(
      `documents.put({ id: "currentPDF", name: "report.final.PDF", size: 100, type: "application/pdf", extractedText: 'می روم "سلام" 3.14 https://example.com\\n\\nLatin', file: new Blob(["%PDF-1.7"]) })`,
    );
    await win.loadFile(path.join(__dirname, "../editor.html"));
    await waitFor(
      win,
      'document.getElementById("loadingOverlay").classList.contains("hidden")',
    );
    assert.match(
      await execute('document.getElementById("editorTextarea").value'),
      /می روم/,
    );
    await execute('document.getElementById("fixTextBtn").click()');
    await waitFor(
      win,
      'documents.get().then(record => record.extractedText.startsWith("می‌روم"))',
    );
    assert.match(
      await execute('document.getElementById("editorTextarea").value'),
      /3\.14 https:\/\/example\.com/,
    );
    const content = "ویرایش تازه\n\n  Latin content";
    await execute(
      `document.getElementById("editorTextarea").value = ${JSON.stringify(content)}; document.getElementById("editorTextarea").dispatchEvent(new Event("input"))`,
    );
    await waitFor(
      win,
      `documents.get().then(record => record.extractedText === ${JSON.stringify(content)})`,
    );
    // Real synthesis and cancellation, with no generated files on disk.
    const spoken = await execute('window.electronAPI.speakText("سلام")');
    assert.equal(spoken.success, true, spoken.error);
    assert.equal(
      Buffer.from(spoken.buffer, "base64").subarray(0, 4).toString(),
      "RIFF",
    );
    const pending = execute(
      'window.electronAPI.speakText("سلام دنیا ".repeat(100))',
    );
    await delay(50);
    assert.equal(
      (await execute("window.electronAPI.stopSpeak()")).success,
      true,
    );
    assert.equal((await pending).success, false);
    await execute('document.getElementById("nextBtn").click()');
    await waitFor(
      win,
      'location.pathname.endsWith("workSpace.html") && document.getElementById("displayFileName").textContent.includes("report.final.PDF")',
    );
    exportPath = path.join(root, "output.txt");
    await execute(
      'document.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, code: "KeyL", bubbles: true }))',
    );
    await waitFor(
      win,
      'document.getElementById("outputArea").classList.contains("active")',
    );
    assert.equal(fs.readFileSync(exportPath, "utf8"), "\ufeff" + content);
    exportPath = path.join(root, "output.docx");
    await execute(
      `document.querySelector(${JSON.stringify('[data-format="docx"]')}).click()`,
    );
    await waitFor(
      win,
      'document.getElementById("outputContent").textContent.includes("output.docx")',
    );
    const zip = await require("jszip").loadAsync(fs.readFileSync(exportPath));
    const xml = await zip.file("word/document.xml").async("string");
    assert.equal((xml.match(/<w:p>/g) || []).length, 3);
    await win.loadFile(path.join(__dirname, "../uploadFile.html"));
    await waitFor(
      win,
      `!!document.querySelector(${JSON.stringify('a[href="editor.html"]')})`,
    );
    assert.equal(
      await execute("documents.get().then(record => record.extractedText)"),
      content,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: native PDF import/parsing, renderer/CSP, correction/undo path, autosave/recovery, speech/cancellation, TXT/DOCX export",
    );
    clearTimeout(timeout);
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  });
