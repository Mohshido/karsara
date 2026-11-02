const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  utilityProcess,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("node:url");
const { validatePDF, validateText, safeName } = require("./validation");

let win = null;
const jobs = new Set();
const exportedFiles = new Set();
const pages = new Set(["uploadFile.html", "editor.html", "workSpace.html"]);
const allowedURLs = new Set(
  [...pages].map((page) => pathToFileURL(path.join(__dirname, page)).href),
);
function trusted(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !allowedURLs.has(event.senderFrame.url)
  )
    throw new Error("Untrusted IPC sender");
}
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      trusted(event);
      return await action(event, ...args);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}
function runJob(kind, data) {
  if ([...jobs].some((job) => job.kind === kind))
    return Promise.reject(new Error("پردازش قبلی هنوز تمام نشده است"));
  return new Promise((resolve, reject) => {
    const worker = utilityProcess.fork(
      path.join(__dirname, "processor.js"),
      [],
      {
        serviceName: "Karsara document processor",
        execArgv: ["--max-old-space-size=256"],
      },
    );
    worker.once("spawn", () => {
      if (jobs.has(job))
        worker.postMessage({
          kind,
          data,
          modelRoot: path.join(
            app.isPackaged ? process.resourcesPath : __dirname,
            "models",
          ),
        });
      else worker.kill();
    });
    const job = {
      worker,
      kind,
      cancel: () => {
        finish(new Error("لغو شد"));
        worker.kill();
      },
    };
    const timer = setTimeout(job.cancel, 120000);
    function finish(error, result) {
      if (!jobs.delete(job)) return;
      clearTimeout(timer);
      worker.kill();
      error ? reject(error) : resolve(result);
    }
    jobs.add(job);
    worker.once("message", (result) =>
      result.success ? finish(null, result) : finish(new Error(result.error)),
    );
    worker.once("error", (type) => finish(new Error(String(type))));
    worker.once("exit", (code) =>
      finish(new Error(`Processor exited (${code})`)),
    );
  });
}
function cancelJobs(kind) {
  for (const job of [...jobs]) if (!kind || job.kind === kind) job.cancel();
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
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!allowedURLs.has(url)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  win.webContents.on(
    "did-start-navigation",
    (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) cancelJobs();
    },
  );
  win.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(
        contents === win?.webContents &&
          allowedURLs.has(contents.getURL()) &&
          permission === "clipboard-read",
      ),
  );
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["ماندن", "خروج بدون ذخیره"],
      defaultId: 0,
      cancelId: 0,
      message:
        "تغییرات هنوز ذخیره نشده‌اند. برای تلاش دوباره در برنامه بمانید.",
    });
    if (choice === 1) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, "uploadFile.html"));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    cancelJobs();
    win = null;
  });
}

handle("open-file", async () => {
  const result = await dialog.showOpenDialog(win, {
    title: "انتخاب فایل PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const filePath = result.filePaths[0];
  const stat = await fs.promises.stat(filePath);
  if (stat.size > 25 * 1024 * 1024)
    throw new Error("حداکثر اندازه فایل ۲۵ مگابایت است");
  const buffer = await fs.promises.readFile(filePath);
  validatePDF(buffer);
  return {
    success: true,
    name: path.basename(filePath),
    buffer: new Uint8Array(buffer),
  };
});
handle("extract-pdf", async (_event, arrayBuffer) => {
  if (!(arrayBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(arrayBuffer))
    throw new Error("Invalid PDF input");
  if (arrayBuffer.byteLength > 25 * 1024 * 1024)
    throw new Error("PDF too large");
  const buffer = Buffer.from(arrayBuffer);
  validatePDF(buffer);
  return runJob("pdf", buffer);
});
handle("speak-text", async (_event, text) => {
  validateText(text, 12000);
  if (!text.trim()) throw new Error("متن خالی است");
  return runJob("speech", text.replace(/[\u200B\uFEFF]/g, "").trim());
});
handle("stop-speak", async () => {
  cancelJobs("speech");
  return { success: true };
});

// ─── ذخیره TXT ──────────────────────────────────────
handle("save-txt", async (event, { text, fileName }) => {
  try {
    validateText(text);
    const cleanName = safeName(fileName);
    const save = await dialog.showSaveDialog(win, {
      title: "ذخیره فایل متنی",
      defaultPath: cleanName + ".txt",
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (save.canceled || !save.filePath)
      return { success: false, canceled: true };
    await fs.promises.writeFile(save.filePath, "\uFEFF" + text, "utf8");
    exportedFiles.add(save.filePath);
    return { success: true, filePath: save.filePath };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

// ─── ذخیره DOCX ─────────────────────────────────────
handle("save-docx", async (event, { text, fileName }) => {
  try {
    validateText(text);
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      AlignmentType,
    } = require("docx");
    const cleanName = safeName(fileName);
    const save = await dialog.showSaveDialog(win, {
      title: "ذخیره فایل Word",
      defaultPath: cleanName + ".docx",
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (save.canceled || !save.filePath)
      return { success: false, canceled: true };

    const lines = text.split(/\r?\n/);
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
            }),
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
    await fs.promises.writeFile(save.filePath, buffer);
    exportedFiles.add(save.filePath);
    return { success: true, filePath: save.filePath };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

handle("open-in-explorer", async (event, filePath) => {
  if (
    typeof filePath === "string" &&
    exportedFiles.has(filePath) &&
    fs.existsSync(filePath)
  ) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// ─── APP ─────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  // Remove only speech WAVs generated by older versions of this application.
  const oldAudio = path.join(app.getPath("temp"), "karsra-tts");
  fs.promises
    .readdir(oldAudio)
    .then((names) =>
      Promise.all(
        names
          .filter((name) => /^speech-\d+\.wav$/.test(name))
          .map((name) =>
            fs.promises.unlink(path.join(oldAudio, name)).catch(() => {}),
          ),
      ),
    )
    .catch(() => {});
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => cancelJobs());

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
