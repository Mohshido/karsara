# karsara
Mohshid Karsara

Mohshid Karsara is the first application of the Mohshid Open Accessibility Platform.

Karsara is an offline-first Windows desktop application designed to improve digital accessibility for blind and low-vision users.

The project focuses on providing accessible document processing, text extraction, AI-assisted reading, and future accessibility tools in a simple and user-friendly environment.

---

Current Status

🚧 Under Active Development

This project is currently in its early development stage (MVP).

---

Vision

Our vision is to build an open accessibility ecosystem that empowers everyone to access digital information independently.

---

Planned Features

- PDF Processing
- Text Extraction
- AI-assisted Reading
- OCR Support
- Offline-first Architecture
- Accessibility-first Design
- Plugin System (Future)

---

Technology Stack

- Electron
- Node.js
- HTML
- CSS
- JavaScript

---

Repository Structure

Application entrypoint: `main.js` (see Development below for the current layout).

---

Contributing

We welcome developers, designers, researchers, accessibility specialists, translators, and open-source contributors from around the world.

Please read our contribution guidelines before submitting changes.

---

License

Karsara is licensed under the GNU General Public License v3.0.

See the [LICENSE](LICENSE) file for details.

---

Part of

Mohshid
Open Accessibility Platform

Light Beyond Technology

نور دیگر

## Development

Use Node.js 24 LTS and npm. Install the locked dependencies with `npm ci`, then
run `npm start`. Installation downloads Electron and the platform-specific native
speech library. The application itself works offline after installation.

The Persian model and eSpeak data are included under
`models/vits-piper-fa_IR-ganji-medium/`; retain its model card and dataset license.

- `npm test`: regression checks for validation, Persian text preservation, WAV encoding, database failures, and IPC authorization/cancellation.
- `npm run test:smoke`: isolated Electron integration test (requires a graphical session; on Linux use `xvfb-run -a npm run test:smoke`). Tests native import, renderer persistence, speech, cancellation, and TXT/DOCX exports using a temporary profile.
- `npm run build`: build the Windows NSIS installer; run on Windows so the correct native speech dependency is installed. CI runs these checks on Windows.

## Current implementation

`main.js` owns window security, dialogs, and IPC. `processor.js` performs PDF parsing
and speech synthesis in disposable utility processes. `preload.js` exposes the
restricted renderer API. `shared.js` owns transactional IndexedDB storage and
import validation. Each HTML page loads its matching JavaScript file; shared focus
styles are in `accessibility.css`.

The workflow is `uploadFile.html` → `editor.html` → `workSpace.html`. Choose a PDF,
edit its extracted text, then export TXT or DOCX. PDFs are limited to 25 MiB and
extracted/exported text to two million characters. Speech is generated in bounded
chunks, with a two-minute timeout per chunk; Stop terminates the current process.
Scanned PDFs require OCR, which is not implemented yet.

Edits autosave locally after a short pause. On startup, choose “ادامه ویرایش” to
resume the saved document. Importing a new document replaces the current one after
confirmation. An unsaved edit prevents closing unless you explicitly discard it.
Local drafts contain the source document and edited text in the application's
profile; generated speech stays in memory.

Shortcuts work while the application has focus: Ctrl+Shift+O opens a PDF;
Ctrl+Shift+P/Q plays/stops in the editor; Ctrl+Shift+W/L exports DOCX/TXT;
Ctrl+Shift+V pastes with conservative Persian prefix correction. The same actions
are available through buttons. Standard editor undo remains available.

Before a release, validate the installed application offline on a clean Windows
machine, including NVDA, keyboard-only use, zoom, and high contrast. The source
changes and automated checks do not constitute screen-reader certification.
