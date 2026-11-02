# Audit remediation

The audit baseline is in AUDIT.md. Implemented changes:

- Removed system-wide shortcut interception; renderer shortcuts now call the same actions as buttons. Native import returns selected document bytes through validated IPC and stores them through the shared import path.
- Shared IndexedDB transactions resolve only after commit, reject missing documents/aborted writes, and close connections. Editor changes autosave; draft recovery is offered at startup. Dirty edits block closing unless explicitly discarded.
- PDF parsing and speech run in disposable Electron utility processes with concurrency limits, input limits, and timeouts. Stop kills the speech process. The renderer settles cancelled playback and ignores stale results; long text is split into bounded chunks.
- WAV audio is encoded in memory. Startup removes only legacy `speech-<timestamp>.wav` files from the application's old speech temp directory.
- Removed arbitrary path parsing and navigation APIs. IPC validates the owning window/main frame and bundled page URL. Navigation/popups are restricted, renderers are sandboxed, scripts are external, and CSP restricts resource loading.
- Persian correction only changes standalone Persian prefixes; quotes, URLs, decimals, and paragraph spacing are preserved. Editing commands retain Chromium undo history. PDF names use a final-extension check and file content/size are validated.
- Added labeled upload controls, visible focus indicators and live status regions. Workspace has a real open button, a link back to speech in the editor, and a working reveal-export button. Scanned PDFs explain the OCR limitation.
- DOCX preserves blank paragraphs and leading/trailing text. Export writes use asynchronous filesystem APIs.
- Updated Electron to 43.8.6, electron-builder to 26.18.0, and pdf-parse to 2.4.5. Added the parser's documented Electron compatibility setup and disabled native external audio buffers for Electron's V8 sandbox. Models are packaged as external resources; native speech libraries are unpacked. Added targeted regression checks, an isolated Electron integration test, and Windows CI including installer creation.
- Updated development instructions and lockfile tracking.

## Remaining release verification

Run the installer on a clean Windows machine offline and check NVDA, focus order,
high contrast, zoom, native speech playback, and cancellation. OCR remains a planned
feature. This change does not add it.

The npm advisory scan after upgrading reports 15 moderate build-time findings,
all originating from the transitive minimatch advisory GHSA-g3hv-75wg-m249. No high
or critical findings were reported. The current builder still depends on affected
minimatch majors. A forced major override would break consumers of the older API;
no such override was applied. Recheck upstream builder releases before publishing.

## Verification completed

- Nine focused regression checks pass, including aborted storage transactions, sender rejection, cancellation, and late audio completion.
- The real Electron workflow smoke test passes on Linux: native PDF selection/extraction, correction, autosave/recovery, native speech generation/cancellation, and TXT/DOCX output (including blank paragraphs).
- A Linux distribution builds successfully. The same workflow test also passes from a packaged test variant, verifying ASAR/native library loading and external model resource paths.
- `npm audit --omit=dev --package-lock-only` reports zero production dependency advisories. The full dependency tree retains the 15 moderate build-tool findings described above.
- Windows installer execution, actual audio-device playback, and NVDA behavior remain manual release checks. Windows CI is configured but was not executed locally.
