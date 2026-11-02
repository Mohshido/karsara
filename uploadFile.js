(async function () {
  const input = document.getElementById("fileInput");
  const dropZone = document.getElementById("dropZone");
  const add = document.getElementById("addBtn");
  const toast = document.getElementById("toast");
  let selected = null;
  function notify(message) {
    toast.textContent = message;
    toast.classList.add("show-toast");
  }
  function select(files) {
    selected = null;
    if (files.length !== 1 || !documents.isPDFName(files[0].name)) {
      notify("فقط یک فایل PDF انتخاب کنید");
      return;
    }
    selected = files[0];
    document.getElementById("fileNameDisplay").textContent = selected.name;
    dropZone.querySelector(".main-text").textContent = selected.name;
  }
  input.addEventListener("change", () => select(input.files));
  // The native input overlays the drop zone: handle both through the wrapper.
  const wrapper = document.querySelector(".file-input-wrapper");
  wrapper.addEventListener("dragover", (event) => event.preventDefault());
  wrapper.addEventListener("drop", (event) => {
    event.preventDefault();
    select(event.dataTransfer?.files || []);
  });
  add.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!selected) {
      notify("ابتدا یک فایل PDF انتخاب کنید");
      input.focus();
      return;
    }
    add.disabled = true;
    try {
      if (
        (await documents.get()) &&
        !confirm("فایل فعلی با فایل جدید جایگزین شود؟")
      )
        return;
      await documents.importFile(selected);
      location.href = "editor.html";
    } catch (error) {
      notify(error.message);
    } finally {
      add.disabled = false;
    }
  });
  document.addEventListener("keydown", async (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.code === "KeyO"
    ) {
      event.preventDefault();
      try {
        if ((await documents.get()) && !confirm("فایل فعلی جایگزین شود؟"))
          return;
        await documents.openFile();
      } catch (error) {
        notify(error.message);
      }
    }
  });
  try {
    const draft = await documents.get();
    if (draft) {
      const resume = document.createElement("a");
      resume.href = "editor.html";
      resume.textContent = `ادامه ویرایش: ${draft.name}`;
      document.querySelector(".upload-content").append(resume);
      notify("فایل قبلی برای ادامه ویرایش در دسترس است");
    }
  } catch (error) {
    notify(error.message);
  }
})();
