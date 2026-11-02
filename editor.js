(function () {
  const textarea = document.getElementById("editorTextarea");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const ttsStatus = document.getElementById("ttsStatus");
  const playBtn = document.getElementById("playBtn");
  const stopBtn = document.getElementById("stopBtn");
  const fixTextBtn = document.getElementById("fixTextBtn");
  const fixBtn2 = document.getElementById("fixBtn2");
  const selectAllBtn = document.getElementById("selectAllBtn");
  const clearBtn = document.getElementById("clearBtn");
  const rtlBtn = document.getElementById("rtlBtn");
  const ltrBtn = document.getElementById("ltrBtn");
  const nextBtn = document.getElementById("nextBtn");
  const wordCount = document.getElementById("wordCount");
  const charCount = document.getElementById("charCount");
  const footerFile = document.getElementById("footerFile");
  const footerWords = document.getElementById("footerWords");
  const sideFileName = document.getElementById("sideFileName");
  const sideFileSize = document.getElementById("sideFileSize");
  const toast = document.getElementById("toast");

  let isPlaying = false;
  let currentFileInfo = null;
  let currentAudio = null;
  let currentAudioUrl = null;
  let stopRequested = false;
  let playbackGeneration = 0;
  let settlePlayback = null;

  function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function showToast(msg, duration = 3000) {
    toast.textContent = msg;
    toast.classList.add("show-toast");
    setTimeout(() => toast.classList.remove("show-toast"), duration);
  }
  function showLoading(msg) {
    loadingText.textContent = msg;
    loadingOverlay.classList.remove("hidden");
  }
  function hideLoading() {
    loadingOverlay.classList.add("hidden");
  }
  function setStatus(msg, state = "ok") {
    statusText.textContent = msg;
    statusDot.className = "dot";
    if (state === "loading") statusDot.classList.add("loading");
    if (state === "error") statusDot.classList.add("error");
  }

  const getFileFromDB = async () => {
    const record = await documents.get();
    if (!record) throw new Error("فایلی وجود ندارد");
    return record;
  };
  const saveTextToDB = (text) => documents.saveText(text);
  let dirty = false;
  let transitioning = false;
  let revision = 0;
  let saveTimer;
  let saveQueue = Promise.resolve();
  function saveDraft() {
    clearTimeout(saveTimer);
    const text = textarea.value;
    const savedRevision = revision;
    saveQueue = saveQueue.catch(() => {}).then(() => saveTextToDB(text));
    return saveQueue.then(() => {
      if (revision === savedRevision) dirty = false;
    });
  }
  function changed() {
    updateStats();
    if (!currentFileInfo) return;
    dirty = true;
    revision++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () =>
        saveDraft().catch((error) => {
          setStatus("ذخیره انجام نشد", "error");
          showToast(error.message);
        }),
      400,
    );
  }
  function setTransition(value) {
    transitioning = value;
    textarea.disabled = value;
    nextBtn.disabled = value;
    document.getElementById("openDocumentBtn").disabled = value;
  }
  async function advance(format) {
    if (transitioning) return;
    setTransition(true);
    try {
      await saveDraft();
      if (format) localStorage.setItem("pendingExport", format);
      await stopText();
      location.href = "workSpace.html";
    } catch (error) {
      showToast("ذخیره انجام نشد: " + error.message);
    } finally {
      setTransition(false);
    }
  }
  async function openDocument() {
    if (transitioning) return;
    setTransition(true);
    try {
      if (currentFileInfo) {
        await saveDraft();
        if (!confirm("فایل فعلی با فایل جدید جایگزین شود؟")) return;
      }
      await stopText();
      await documents.openFile();
    } catch (error) {
      showToast(error.message);
    } finally {
      setTransition(false);
    }
  }
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} بایت`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
    return `${(bytes / 1048576).toFixed(1)} مگابایت`;
  }

  function updateStats() {
    const text = textarea.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    wordCount.textContent = words.toLocaleString("fa");
    charCount.textContent = chars.toLocaleString("fa");
    footerWords.textContent = `کلمات: ${words.toLocaleString("fa")}`;
  }

  const fixPersianText = documents.fixPersianText;
  function replaceText(text) {
    if (transitioning) return;
    textarea.focus();
    textarea.select();
    // Chromium's editing command preserves the native undo history.
    document.execCommand("insertText", false, text);
    changed();
  }

  async function extractTextFromPDF(fileData) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const result = await window.electronAPI.extractPDF(e.target.result);
          if (result.success) res(result.text);
          else rej(result.error);
        } catch (err) {
          rej(err);
        }
      };
      reader.onerror = () => rej("خطا در خواندن فایل");
      reader.readAsArrayBuffer(fileData);
    });
  }

  // ─── TTS via WebAudio در رندر ───
  async function playAudioBuffer(b64) {
    const bytes = base64ToUint8Array(b64);
    const blob = new Blob([bytes], { type: "audio/wav" });
    cleanupAudio();
    currentAudioUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentAudioUrl);
    const audio = currentAudio;
    return new Promise((resolve, reject) => {
      settlePlayback = resolve;
      currentAudio.onended = () => {
        cleanupAudio();
        resolve();
      };
      currentAudio.onerror = () => {
        settlePlayback = null;
        cleanupAudio();
        reject(new Error("خطا در پخش"));
      };
      currentAudio.play().catch((error) => {
        if (currentAudio !== audio) return;
        settlePlayback = null;
        cleanupAudio();
        reject(error);
      });
    });
  }

  function cleanupAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.onended = null;
      currentAudio.onerror = null;
    }
    if (settlePlayback) {
      const settle = settlePlayback;
      settlePlayback = null;
      settle();
    }
    if (currentAudioUrl) {
      try {
        URL.revokeObjectURL(currentAudioUrl);
      } catch (e) {}
      currentAudioUrl = null;
    }
    currentAudio = null;
  }

  async function playText() {
    const text = textarea.value.trim();
    if (!text) return showToast("متنی برای پخش وجود ندارد");
    if (isPlaying) return showToast("در حال پخش است");

    const selected = textarea.value
      .substring(textarea.selectionStart, textarea.selectionEnd)
      .trim();
    const toSpeak = selected || text;

    const generation = ++playbackGeneration;
    try {
      isPlaying = true;
      stopRequested = false;
      ttsStatus.textContent = "در حال آماده‌سازی صدا...";
      ttsStatus.className = "tts-status playing";
      playBtn.disabled = true;
      stopBtn.disabled = false;

      const chunks =
        toSpeak.match(/[\s\S]{1,1000}(?:\s|$)|[\s\S]{1,1000}/g) || [];
      for (const chunk of chunks) {
        if (generation !== playbackGeneration) return;
        const result = await window.electronAPI.speakText(chunk);
        if (generation !== playbackGeneration) return;
        if (!result?.success) throw new Error(result?.error || "خطا در TTS");
        if (stopRequested) return;
        ttsStatus.textContent = "در حال پخش...";
        await playAudioBuffer(result.buffer);
      }

      if (!stopRequested && generation === playbackGeneration) {
        ttsStatus.textContent = "پخش تمام شد";
        setTimeout(() => {
          if (generation !== playbackGeneration) return;
          ttsStatus.textContent = "آماده";
          ttsStatus.className = "tts-status";
        }, 1500);
      }
    } catch (err) {
      if (generation !== playbackGeneration) return;
      console.error(err);
      ttsStatus.textContent = "خطا در پخش";
      showToast("خطا در پخش صدا: " + (err.message || err));
    } finally {
      if (generation !== playbackGeneration) return;
      isPlaying = false;
      playBtn.disabled = false;
      stopBtn.disabled = false;
    }
  }

  async function stopText() {
    stopRequested = true;
    playbackGeneration++;
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (e) {}
      cleanupAudio();
    }
    try {
      await window.electronAPI.stopSpeak();
    } catch (e) {}
    isPlaying = false;
    ttsStatus.textContent = "متوقف شد";
    ttsStatus.className = "tts-status";
    playBtn.disabled = false;
    stopBtn.disabled = false;
  }

  async function pasteAndFix() {
    if (transitioning) return;
    try {
      const clipText = await navigator.clipboard.readText();
      if (transitioning) return;
      if (!clipText) return showToast("کلیپبورد خالی است");
      const fixed = fixPersianText(clipText);
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      document.execCommand("insertText", false, fixed);
      changed();
      showToast("paste شد، در حال پخش...");
      await playText();
    } catch (err) {
      showToast("خطا در paste: " + err.message);
    }
  }

  async function init() {
    showLoading("در حال بارگذاری فایل PDF...");
    setStatus("در حال بارگذاری...", "loading");
    try {
      const rec = await getFileFromDB();
      currentFileInfo = rec;
      sideFileName.textContent = rec.name;
      sideFileName.title = rec.name;
      sideFileSize.textContent = formatSize(rec.size);
      footerFile.textContent = `فایل: ${rec.name}`;

      if (typeof rec.extractedText === "string") {
        textarea.value = rec.extractedText;
        updateStats();
        hideLoading();
        setStatus(rec.name, "ok");
        return;
      }

      loadingText.textContent = "در حال استخراج متن از PDF...";
      const text = await extractTextFromPDF(rec.file);
      textarea.value = text || "";
      updateStats();
      await saveTextToDB(text);
      hideLoading();
      setStatus(rec.name, "ok");
      showToast(
        text.trim()
          ? "متن با موفقیت استخراج شد"
          : "متنی پیدا نشد؛ برای فایل تصویری به OCR نیاز است. می‌توانید متن را وارد کنید.",
        10000,
      );
    } catch (err) {
      hideLoading();
      setStatus("خطا در بارگذاری", "error");
      textarea.value = "";
      showToast("خطا: " + err);
      console.error(err);
    }
  }

  textarea.addEventListener("input", changed);
  document
    .getElementById("openDocumentBtn")
    .addEventListener("click", openDocument);
  playBtn.addEventListener("click", playText);
  stopBtn.addEventListener("click", stopText);
  fixTextBtn.addEventListener("click", () => {
    replaceText(fixPersianText(textarea.value));
    showToast("متن اصلاح شد");
  });
  fixBtn2.addEventListener("click", () => {
    replaceText(fixPersianText(textarea.value));
    showToast("فاصله‌گذاری اصلاح شد");
  });
  selectAllBtn.addEventListener("click", () => textarea.select());
  clearBtn.addEventListener("click", () => {
    if (confirm("متن پاک شود؟")) {
      replaceText("");
    }
  });
  rtlBtn.addEventListener("click", () => {
    textarea.style.direction = "rtl";
    textarea.style.textAlign = "right";
  });
  ltrBtn.addEventListener("click", () => {
    textarea.style.direction = "ltr";
    textarea.style.textAlign = "left";
  });
  nextBtn.addEventListener("click", () => advance());

  document.addEventListener("keydown", async (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    switch (e.code) {
      case "KeyO":
        e.preventDefault();
        await openDocument();
        break;
      case "KeyP":
        e.preventDefault();
        playText();
        break;
      case "KeyQ":
        e.preventDefault();
        stopText();
        break;
      case "KeyV":
        e.preventDefault();
        pasteAndFix();
        break;
      case "KeyW":
        e.preventDefault();
        await advance("docx");
        break;
      case "KeyL":
        e.preventDefault();
        await advance("txt");
        break;
    }
  });

  init();
})();
