(async function () {
  async function getFIlefromDb() {
    const record = await documents.get();
    if (!record) throw new Error("فایلی وجود ندارد");
    return record;
  }
  async function getTextFromDb() {
    return (await getFIlefromDb()).extractedText || "";
  }
  let lastOutputPath = null;
  let exporting = false;
  document
    .getElementById("downloadOutputBtn")
    .addEventListener("click", async () => {
      if (lastOutputPath)
        await window.electronAPI.openInExplorer(lastOutputPath);
    });
  let currentFile = null;
  try {
    const file = await getFIlefromDb();
    currentFile = {
      name: file.name,
      size: file.size,
      type: file.type,
      ext: file.name.split(".").pop().toLowerCase(),
    };
  } catch (err) {
    document.getElementById("statusText").textContent = "خطا در خواندن فایل";
  }

  const displayFileName = document.getElementById("displayFileName");
  const displayFileSize = document.getElementById("displayFileSize");
  const displayFileExt = document.getElementById("displayFileExt");
  const displayFileType = document.getElementById("displayFileType");
  const statusText = document.getElementById("statusText");
  const convertBTNs = document.querySelectorAll(".convert-btn-ui");
  const processingStatus = document.getElementById("processingStatus");
  const outputArea = document.getElementById("outputArea");
  const outputContent = document.getElementById("outputContent");
  const outputFormt = document.getElementById("outputFormt");
  const openFileBtn = document.getElementById("openFileBtn");

  function formatFileSize(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} بایت`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} کیلوبایت`;
    return `${(bytes / 1048576).toFixed(2)} مگابایت`;
  }
  function getFileType(ext) {
    return (
      { txt: "متن ساده", docx: "مایکروسافت ورد", pdf: "پی دی اف" }[ext] ||
      "ناشناخته"
    );
  }
  function displayFileInfo(f) {
    displayFileName.textContent = `فایل: ${f.name}`;
    displayFileSize.textContent = `اندازه: ${formatFileSize(f.size)}`;
    displayFileExt.textContent = `اکستنشن: ${f.ext}`;
    displayFileType.textContent = `نوع: ${getFileType(f.ext)}`;
    statusText.textContent = `آماده - ${f.name}`;
    convertBTNs.forEach((b) => (b.disabled = false));
  }
  function showProcessing(msg) {
    processingStatus.removeAttribute("style");
    processingStatus.textContent = msg || "در حال پردازش...";
    processingStatus.className = "processing-status active";
    outputArea.classList.remove("active");
  }
  function showOutput(filePath, format) {
    lastOutputPath = filePath;
    processingStatus.classList.remove("active");
    processingStatus.className = "processing-status success";
    outputContent.textContent = `فایل ${format.toUpperCase()} در مسیر زیر ذخیره شد:\n${filePath}`;
    outputFormt.textContent = "فرمت: " + format.toUpperCase();
    outputArea.classList.add("active");
  }
  function showError(msg) {
    processingStatus.classList.remove("active");
    processingStatus.className = "processing-status";
    processingStatus.textContent = "خطا: " + msg;
    processingStatus.style.display = "block";
    processingStatus.style.background = "#ffebee";
    processingStatus.style.color = "#c62828";
  }

  async function exportFile(format) {
    if (exporting) return;
    if (!currentFile) return showError("فایلی بارگذاری نشده");
    exporting = true;
    convertBTNs.forEach((button) => (button.disabled = true));
    showProcessing("در حال تولید فایل...");
    try {
      const text = (await getTextFromDb()) || "";
      if (!text.trim())
        return showError(
          "متنی برای خروجی وجود ندارد - ابتدا PDF را ویرایش کنید",
        );

      const result =
        format === "docx"
          ? await window.electronAPI.saveDocx(text, currentFile.name)
          : await window.electronAPI.saveTxt(text, currentFile.name);

      if (result.canceled) {
        processingStatus.style.display = "none";
        return;
      }
      if (!result.success) return showError(result.error || "خطا در ذخیره");
      showOutput(result.filePath, format);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      exporting = false;
      convertBTNs.forEach((button) => (button.disabled = false));
    }
  }

  if (currentFile) displayFileInfo(currentFile);

  convertBTNs.forEach((btn) => {
    btn.addEventListener("click", () => exportFile(btn.dataset.format));
  });

  if (openFileBtn) {
    openFileBtn.addEventListener("click", async () => {
      try {
        if (confirm("فایل فعلی جایگزین شود؟")) await documents.openFile();
      } catch (error) {
        showError(error.message);
      }
    });
  }

  document.addEventListener("keydown", async (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (e.code === "KeyO") {
      e.preventDefault();
      try {
        if (confirm("فایل فعلی جایگزین شود؟")) await documents.openFile();
      } catch (error) {
        showError(error.message);
      }
    } else if (e.code === "KeyL") {
      e.preventDefault();
      exportFile("txt");
    } else if (e.code === "KeyW") {
      e.preventDefault();
      exportFile("docx");
    }
  });

  // اگر با میانبر از editor آمده باشیم
  const pending = localStorage.getItem("pendingExport");
  if (pending) {
    localStorage.removeItem("pendingExport");
    setTimeout(() => exportFile(pending), 300);
  }
})();
