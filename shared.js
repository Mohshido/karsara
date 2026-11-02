/* Shared document storage. A write is successful only after transaction commit. */
window.documents = (() => {
  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open("FileDB", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("files", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("پایگاه داده در پنجره دیگری باز است"));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => db.close();
        let result;
        let tx;
        try {
          tx = db.transaction("files", mode);
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error || new Error("ذخیره انجام نشد"));
        };
        tx.onerror = () => {}; // abort reports the failure once
        try {
          action(tx.objectStore("files"), (value) => {
            result = value;
          });
        } catch (error) {
          tx.abort();
        }
      };
    });
  }
  const get = () =>
    transaction("readonly", (store, done) => {
      store.get("currentPDF").onsuccess = (event) => done(event.target.result);
    });
  const put = (record) =>
    transaction("readwrite", (store) => store.put(record));
  const saveText = (text) =>
    transaction("readwrite", (store) => {
      store.get("currentPDF").onsuccess = (event) => {
        const record = event.target.result;
        if (!record) {
          store.transaction.abort();
          return;
        }
        record.extractedText = text;
        store.put(record);
      };
    });
  function isPDFName(name) {
    return typeof name === "string" && /\.pdf$/i.test(name);
  }
  async function importFile(file) {
    if (!isPDFName(file.name) || file.size > 25 * 1024 * 1024 || !file.size)
      throw new Error("یک فایل PDF با اندازه حداکثر ۲۵ مگابایت انتخاب کنید");
    const header = new TextDecoder().decode(
      await file.slice(0, 1024).arrayBuffer(),
    );
    if (!header.includes("%PDF-"))
      throw new Error("محتوای فایل PDF معتبر نیست");
    await put({
      id: "currentPDF",
      name: file.name,
      size: file.size,
      type: "application/pdf",
      file,
    });
  }
  async function openFile() {
    const selected = await window.electronAPI.openFile();
    if (selected.canceled) return false;
    if (!selected.success) throw new Error(selected.error);
    await importFile(
      new File([selected.buffer], selected.name, { type: "application/pdf" }),
    );
    location.href = "editor.html";
    return true;
  }
  function fixPersianText(text) {
    // Preserve Latin content, decimal points, URLs, quotes, and paragraph structure.
    return text.replace(
      /(^|[^\p{L}\p{N}\u200c])(نمی|می|بی) +(?=[\u0600-\u06ff])/gu,
      "$1$2\u200c",
    );
  }
  return {
    get,
    put,
    saveText,
    importFile,
    openFile,
    isPDFName,
    fixPersianText,
  };
})();
