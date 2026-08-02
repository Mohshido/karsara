const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const sherpa = require("sherpa-onnx-node");

app.asar = false;

let win = null;
let tts = null;
let busySpeaking = false;

// ─── TTS INIT (قبل از پنجره) ───
function initTTS() {
  try {
    tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: path.join(
            __dirname,
            "models/vits-piper-fa_IR-ganji-medium/fa_IR-ganji-medium.onnx"
          ),
          tokens: path.join(
            __dirname,
            "models/vits-piper-fa_IR-ganji-medium/tokens.txt"
          ),
          dataDir: path.join(
            __dirname,
            "models/vits-piper-fa_IR-ganji-medium/espeak-ng-data"
          ),
        },
        numThreads: 2,
        debug: 0,
        provider: "cpu",
      },
      maxNumSentences: 10,
    });
    console.log("TTS آماده است");
  } catch (err) {
    console.error("خطا در راه‌اندازی TTS:", err);
    tts = null;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, "assets/icon.png"),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile("uploadFile.html");
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => (win = null));
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (win) openFileDialog();
  });
  globalShortcut.register("CommandOrControl+Shift+P", () => {
    if (win) win.webContents.send("shortcut-play");
  });
  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    if (win) win.webContents.send("shortcut-stop");
  });
  globalShortcut.register("CommandOrControl+Shift+W", () => {
    if (win) win.webContents.send("shortcut-export-docx");
  });
  globalShortcut.register("CommandOrControl+Shift+L", () => {
    if (win) win.webContents.send("shortcut-export-txt");
  });
  globalShortcut.register("CommandOrControl+Shift+V", () => {
    if (win) win.webContents.send("shortcut-paste-fix");
  });
}

async function openFileDialog() {
  const result = await dialog.showOpenDialog(win, {
    title: "انتخاب فایل PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["openFile"],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    win.webContents.send("file-selected", result.filePaths[0]);
  }
}

// ─── IPC ────────────────────────────────────────────────

ipcMain.handle("extract-pdf", async (event, arrayBuffer) => {
  try {
    const buffer = Buffer.from(arrayBuffer);
    const data = await pdfParse(buffer);
    return { success: true, text: data.text, pages: data.numpages };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("extract-pdf-path", async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return { success: true, text: data.text, pages: data.numpages };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-file", async () => {
  await openFileDialog();
  return true;
});

// TTS: فقط تولید + بازگشت WAV - پخش در رندر
ipcMain.handle("speak-text", async (event, text) => {
  if (!tts)
    return {
      success: false,
      error: "TTS آماده نیست - مدل sherpa بارگذاری نشد",
    };
  if (typeof text !== "string" || !text.trim())
    return { success: false, error: "متن خالی است" };
  if (busySpeaking) return { success: false, error: "در حال پخش قبلی" };

  try {
    busySpeaking = true;
    const clean = text
      .replace(/[""]/g, "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) {
      busySpeaking = false;
      return { success: false, error: "متن قابل پخش نیست" };
    }

    const audio = tts.generate({ text: clean, sid: 0, speed: 1.0 });
    if (!audio?.samples?.length) {
      busySpeaking = false;
      return { success: false, error: "خروجی صوت خالی" };
    }

    const tempDir = path.join(app.getPath("temp"), "karsra-tts");
    if (!fs.existsSync(tempDir))
      fs.mkdirSync(tempDir, { recursive: true });
    const wavPath = path.join(tempDir, `speech-${Date.now()}.wav`);
    sherpa.writeWave(wavPath, {
      samples: audio.samples,
      sampleRate: audio.sampleRate,
    });
    const b64 = fs.readFileSync(wavPath).toString("base64");

    busySpeaking = false;
    return {
      success: true,
      buffer: b64,
      sampleRate: audio.sampleRate,
      duration: audio.samples.length / audio.sampleRate,
    };
  } catch (err) {
    busySpeaking = false;
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("stop-speak", async () => {
  busySpeaking = false;
  return { success: true };
});

// ─── ذخیره TXT ──────────────────────────────────────
ipcMain.handle("save-txt", async (event, { text, fileName }) => {
  try {
    if (typeof text !== "string")
      return { success: false, error: "متن نامعتبر است" };
    const cleanName = (fileName || "output.pdf").replace(/\.pdf$/i, "");
    const save = await dialog.showSaveDialog(win, {
      title: "ذخیره فایل متنی",
      defaultPath: cleanName + ".txt",
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (save.canceled || !save.filePath)
      return { success: false, canceled: true };
    fs.writeFileSync(save.filePath, "\uFEFF" + text, "utf8");
    return { success: true, filePath: save.filePath };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

// ─── ذخیره DOCX ─────────────────────────────────────
ipcMain.handle("save-docx", async (event, { text, fileName }) => {
  try {
    if (typeof text !== "string")
      return { success: false, error: "متن نامعتبر است" };
    const { Document, Packer, Paragraph, TextRun, AlignmentType } =
      require("docx");
    const cleanName = (fileName || "output.pdf").replace(/\.pdf$/i, "");
    const save = await dialog.showSaveDialog(win, {
      title: "ذخیره فایل Word",
      defaultPath: cleanName + ".docx",
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (save.canceled || !save.filePath)
      return { success: false, canceled: true };

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const paragraphs = lines.length
      ? lines.map(
          (line) =>
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: line,
                  font: "B Nazanin",
                  size: 28,
                  rightToLeft: true,
                }),
              ],
            })
        )
      : [
          new Paragraph({
            children: [
              new TextRun({
                text,
                font: "B Nazanin",
                size: 24,
                rightToLeft: true,
              }),
            ],
          }),
        ];

    const doc = new Document({
      creator: "موهشید کارسرا",
      title: cleanName,
      styles: {
        default: {
          document: { run: { font: "B Nazanin", rightToLeft: true } },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children: paragraphs,
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(save.filePath, buffer);
    return { success: true, filePath: save.filePath };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("open-in-explorer", async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle("navigate", async (event, page) => {
  if (win) win.loadFile(page);
  return true;
});

// ─── APP ─────────────────────────────────────────────
app.whenReady().then(() => {
  initTTS();
  createWindow();
  registerShortcuts();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
