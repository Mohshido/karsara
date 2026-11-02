const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { validatePDF, validateText, safeName } = require("../validation");
const { encodeWav } = require("../wav");
function shared(indexedDB = {}) {
  const context = { window: {}, indexedDB };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../shared.js"), "utf8"),
    context,
  );
  return context.window.documents;
}
test("Persian correction preserves mixed content and uses Unicode boundaries", () => {
  const fix = shared().fixPersianText;
  assert.equal(fix("می روم، نمی روم و بی خبر"), "می‌روم، نمی‌روم و بی‌خبر");
  const mixed = '"سلام" 3.14 https://example.com\n\n  Latin text';
  assert.equal(fix(mixed), mixed);
  assert.equal(fix("آدمی رود"), "آدمی رود");
});
test("PDF name and content validation reject disguised/non-PDF or oversized files", () => {
  const api = shared();
  for (const name of ["report.final.pdf", "REPORT.PDF"])
    assert.equal(api.isPDFName(name), true);
  for (const name of ["report.pdf.exe", "", undefined])
    assert.equal(api.isPDFName(name), false);
  assert.doesNotThrow(() => validatePDF(Buffer.from("%PDF-1.7\n")));
  assert.throws(() => validatePDF(Buffer.from("not pdf")));
  assert.throws(() => validatePDF(Buffer.alloc(25 * 1024 * 1024 + 1)));
  assert.throws(() => validateText({}, 10));
  assert.throws(() => validateText("123", 2));
  assert.equal(safeName("../../report.PDF"), "report");
});
test("WAV encoder creates valid bounded mono PCM data without temporary files", () => {
  const wav = encodeWav(new Float32Array([-2, 0, 2]), 22050);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.readInt16LE(44), -32768);
  assert.equal(wav.readInt16LE(48), 32767);
});
function database() {
  let request,
    tx,
    getRequest,
    record,
    closed = false;
  const store = {
    get() {
      return (getRequest = {});
    },
    put(value) {
      record = value;
    },
  };
  const db = {
    close() {
      closed = true;
    },
    transaction() {
      return (tx = {
        objectStore() {
          return store;
        },
        abort() {
          tx.onabort();
        },
      });
    },
  };
  store.transaction = {
    abort() {
      tx.onabort();
    },
  };
  const indexedDB = {
    open() {
      request = {};
      return request;
    },
  };
  return {
    indexedDB,
    open() {
      request.result = db;
      request.onsuccess();
    },
    read(value) {
      getRequest.onsuccess({ target: { result: value } });
    },
    commit() {
      tx.oncomplete();
    },
    abort() {
      tx.onabort();
    },
    get closed() {
      return closed;
    },
    get record() {
      return record;
    },
  };
}
test("document save waits for transaction commit and closes the connection", async () => {
  const db = database();
  let settled = false;
  const saving = shared(db.indexedDB)
    .saveText("edited")
    .then(() => {
      settled = true;
    });
  db.open();
  db.read({ id: "currentPDF", extractedText: "old" });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(db.record.extractedText, "edited");
  db.commit();
  await saving;
  assert.equal(db.closed, true);
});
test("document save reports a transaction failure after the put was queued", async () => {
  const db = database();
  const saving = shared(db.indexedDB).saveText("edited");
  const failure = assert.rejects(saving);
  db.open();
  db.read({ id: "currentPDF" });
  db.abort();
  await failure;
  assert.equal(db.closed, true);
});
test("missing document is a failed save, not success", async () => {
  const db = database();
  const saving = shared(db.indexedDB).saveText("edited");
  const failure = assert.rejects(saving);
  db.open();
  db.read(undefined);
  await failure;
});
test("page scripts parse and CSP hashes match the embedded styles", () => {
  const crypto = require("node:crypto");
  function assertStyleHashes(html, label) {
    const policy = html.match(
      /http-equiv="Content-Security-Policy" content="([^"]+)"/,
    );
    assert.ok(policy, `${label}: missing CSP`);
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    assert.ok(styles.length, `${label}: missing embedded styles`);
    for (const match of styles) {
      // HTML parsing normalizes CRLF and CR to LF before CSP hashes the DOM text.
      // https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream
      const style = match[1].replace(/\r\n?/g, "\n");
      const hash = crypto.createHash("sha256").update(style).digest("base64");
      assert.ok(
        policy[1].includes(`'sha256-${hash}'`),
        `${label}: CSP style hash does not match`,
      );
    }
  }
  for (const file of [
    "main.js",
    "preload.js",
    "processor.js",
    "editor.js",
    "workSpace.js",
    "uploadFile.js",
    "shared.js",
  ])
    new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
  for (const file of ["editor.html", "workSpace.html", "uploadFile.html"]) {
    const html = fs.readFileSync(file, "utf8");
    assert.equal(/<script>/.test(html), false);
    const normalized = html.replace(/\r\n?/g, "\n");
    for (const [name, source] of [
      ["checkout", html],
      ["LF", normalized],
      ["CRLF", normalized.replace(/\n/g, "\r\n")],
      ["CR", normalized.replace(/\n/g, "\r")],
    ]) {
      assertStyleHashes(source, `${file} (${name})`);
    }
    assert.throws(
      () => assertStyleHashes(html.replace("<style>", "<style>/* changed */"), file),
      /CSP style hash does not match/,
    );
  }
});
test("IPC refuses untrusted senders and invalid payloads; jobs are cancelled on stop", async () => {
  const { EventEmitter } = require("node:events");
  const path = require("node:path");
  const handlers = new Map();
  let win, child;
  const app = new EventEmitter();
  app.whenReady = () => ({
    then(callback) {
      callback();
    },
  });
  app.getPath = () => "/tmp/karsara-test-nonexistent";
  class Window extends EventEmitter {
    constructor() {
      super();
      win = this;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: {
          url: require("node:url").pathToFileURL(path.resolve("editor.html"))
            .href,
        },
        setWindowOpenHandler() {},
        session: { setPermissionRequestHandler() {} },
      });
    }
    loadFile() {}
    show() {}
  }
  const electron = {
    app,
    BrowserWindow: Window,
    dialog: {},
    shell: {},
    ipcMain: {
      handle(name, fn) {
        handlers.set(name, fn);
      },
    },
    utilityProcess: {
      fork() {
        child = new EventEmitter();
        child.kill = () => {
          child.killed = true;
        };
        child.postMessage = () => {};
        return child;
      },
    },
  };
  const context = {
    require(name) {
      return name === "electron"
        ? electron
        : name === "./validation"
          ? require("../validation")
          : require(name);
    },
    __dirname: path.resolve("."),
    process,
    Buffer,
    ArrayBuffer,
    Uint8Array,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync("main.js", "utf8"), context);
  const good = {
    sender: win.webContents,
    senderFrame: win.webContents.mainFrame,
  };
  assert.equal(
    (
      await handlers.get("speak-text")(
        { sender: {}, senderFrame: good.senderFrame },
        "hello",
      )
    ).success,
    false,
  );
  assert.equal(
    (
      await handlers.get("speak-text")(
        { sender: good.sender, senderFrame: { url: good.senderFrame.url } },
        "hello",
      )
    ).success,
    false,
  );
  assert.equal(
    (await handlers.get("speak-text")(good, "x".repeat(12001))).success,
    false,
  );
  assert.equal((await handlers.get("save-txt")(good, null)).success, false);
  assert.equal(handlers.has("extract-pdf-path"), false);
  assert.equal(handlers.has("navigate"), false);
  const pending = handlers.get("speak-text")(good, "hello");
  child.emit("spawn");
  assert.equal((await handlers.get("stop-speak")(good)).success, true);
  assert.equal((await pending).success, false);
  assert.equal(child.killed, true);
});

test("late playback rejection cannot cancel the next audio operation", async () => {
  const source = fs.readFileSync("editor.js", "utf8");
  const audioFunctions = source.slice(
    source.indexOf("  async function playAudioBuffer"),
    source.indexOf("  async function playText"),
  );
  const players = [];
  class Audio {
    constructor() {
      players.push(this);
    }
    play() {
      return new Promise((resolve, reject) => {
        this.rejectPlay = reject;
      });
    }
    pause() {
      this.paused = true;
    }
  }
  const context = vm.createContext({
    Audio,
    Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    base64ToUint8Array: () => new Uint8Array(),
  });
  vm.runInContext(
    "let currentAudio = null, currentAudioUrl = null, settlePlayback = null;" +
      audioFunctions,
    context,
  );
  const first = vm.runInContext('playAudioBuffer("")', context);
  vm.runInContext("cleanupAudio()", context);
  await first;
  const second = vm.runInContext('playAudioBuffer("")', context);
  players[0].rejectPlay(new Error("old playback aborted"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(vm.runInContext("currentAudio", context), players[1]);
  vm.runInContext("cleanupAudio()", context);
  await second;
});
