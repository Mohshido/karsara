const MAX_PDF_BYTES = 25 * 1024 * 1024;
function validatePDF(buffer) {
  if (
    !buffer.length ||
    buffer.length > MAX_PDF_BYTES ||
    !buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))
  )
    throw new Error("فایل PDF معتبر نیست یا بیش از ۲۵ مگابایت است");
}
function validateText(text, max = 2000000) {
  if (typeof text !== "string" || text.length > max)
    throw new Error(`متن نامعتبر است یا بیش از ${max} نویسه دارد`);
}
function safeName(name) {
  if (name !== undefined && typeof name !== "string")
    throw new Error("Invalid filename");
  return (
    (name || "output.pdf")
      .split(/[\\/]/)
      .pop()
      .replace(/\.pdf$/i, "")
      .replace(/[<>:"|?*\x00-\x1f]/g, "_")
      .slice(0, 120) || "output"
  );
}
module.exports = { validatePDF, validateText, safeName };
