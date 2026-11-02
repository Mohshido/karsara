# Karsara project audit

Audit date: 2026-11-02. Scope: application source, renderer pages, preload/IPC boundary, dependency lockfile, bundled model layout, build configuration, and repository documentation. The findings below describe the original audit baseline; remediation is tracked in FIXES.md.

## Assessment

This is an early Electron prototype with an implemented PDF → editable text → TXT/DOCX workflow and Persian offline speech. It needs reliability, accessibility, security, and packaged-Windows verification before release to its intended users.

The architecture is small: `main.js` owns parsing, speech, file dialogs, and exports; `preload.js` exposes IPC methods; three HTML pages contain their own scripts and styles. IndexedDB holds the source PDF and extracted text. The model is bundled locally (about 61 MB for the ONNX file). OCR, AI-assisted reading, and plugins are planned rather than implemented.

Positive foundations: Node integration is disabled, context isolation is enabled, renderer text is generally assigned through `textContent`/textarea rather than HTML injection, native save dialogs control export destinations, and the primary workflow does not require a remote service. Persian language/RTL metadata and several named native buttons are present.

## High-priority findings

### 1. Global shortcuts consume keystrokes without invoking renderer actions

Evidence: `main.js:72–90`, `preload.js:27–36`, `editor.html:996–1030`, `workSpace.html:709–718`.

Main registers system-wide shortcuts and sends `shortcut-*` events, but no renderer subscribes to the corresponding preload callbacks. Renderer handlers instead depend on ordinary DOM keydown events. Successful global registration consumes those combinations, bypassing the intended DOM route. Registration failure is ignored, so behavior can vary across machines. The native Open shortcut reaches a dialog, but its selected file is also unhandled (finding 2).

Use application-scoped accelerators or wire the IPC callbacks consistently; avoid taking system-wide combinations unless explicitly needed. Verify with NVDA, including while another application has focus.

### 2. Native file selection does not load the selected PDF

Evidence: `main.js:93–101`, `preload.js:9–11`; no HTML page calls `onFileSelected`.

The picker emits `file-selected`, but nothing receives it, updates IndexedDB, or extracts the selected file. The editor's Open shortcut therefore cannot replace the current document. Connect selection to one shared import flow with error handling and a clear policy for unsaved edits.

### 3. Speech generation blocks the privileged main process and cannot be cancelled

Evidence: `main.js:132–185`.

`tts.generate()` is called synchronously in an async IPC handler. The async keyword does not move that computation off the main thread. Long text blocks main-process event handling, including the `stop-speak` request; that handler only changes a flag and never cancels generation. There are no text/file-size limits. Synchronous file reads/writes add further blocking. Initialization also occurs before window creation (`main.js:298–300`), leaving no startup feedback during model loading.

Run synthesis in a worker/utility process, generate bounded chunks, and implement real cancellation. Put expensive parsing behind resource limits and isolation as well. Test long documents, cancellation during generation, repeated playback, and shutdown.

### 4. Electron is pinned to an unsupported major

Evidence: `package.json:18`; lockfile resolves Electron 28.3.3, builder 24.13.3, pdf-parse 1.1.1, and sherpa-onnx-node 1.13.4.

The `^28.0.0` range cannot advance to a supported major. Upgrade Electron with migration checks and native-addon validation. Electron supports its latest three stable major releases; see the [official support policy](https://www.electronjs.org/de/docs/latest/tutorial/electron-timelines) and [release schedule](https://releases.electronjs.org/schedule). A current dependency-advisory count could not be obtained in this environment.

### 5. IPC grants unnecessary file and navigation authority

Evidence: `main.js:116–119`, `main.js:284–294`, `preload.js:6–7`, `preload.js:22–25`.

The renderer can request parsing of arbitrary filesystem paths and load arbitrary local HTML paths into the privileged window. IPC handlers do not validate the sender, and the window has no explicit navigation or popup restrictions. Pages also lack a Content Security Policy. A renderer compromise could expand to access outside the intended document workflow; this audit did not demonstrate an initial injection vulnerability or arbitrary code execution.

Remove unused bridge capabilities, restrict navigation to known bundled pages, validate the main-frame sender and payload schema on each IPC request, and bind file access to user-selected files. Add a restrictive CSP after moving inline scripts to local files. These controls follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security/).

### 6. Saving can report success before the edited document is committed

Evidence: `editor.html:736–754`, `uploadFile.html:306–329`.

`saveTextToDB` queues `store.put(data)` and resolves immediately, without observing the write request or transaction completion/abort. A quota or transaction failure can be missed, then the page navigates or exports stale text. Upload saving similarly resolves on request success rather than transaction completion; its outer catch logs and suppresses failures, allowing navigation after a failed save.

Resolve only on `transaction.oncomplete`, reject on abort/error, close database connections, and propagate storage errors to the user. Add a failure-path check that proves navigation does not occur after an aborted write.

## Medium-priority findings

### 7. Text correction corrupts content and misses Persian prefixes

Evidence: `editor.html:773–796`. Reproduced by evaluating the actual function in Node:

| Input | Actual output |
|---|---|
| `می روم` | `می روم` (prefix correction misses it) |
| `نمی روم` | `نمی روم` |
| `"سلام"` | `«سلام«` |
| `3.14` | `۳. ۱۴` |
| `https://example.com` | `https: //example. com` |

JavaScript `\b` does not provide the intended Persian word boundaries. The first quote replacement consumes all quotes, making the closing-quote replacement ineffective. Punctuation spacing changes decimals and URLs. Use Unicode-aware boundaries and conservative, separately selectable transformations; preserve undo and add regression fixtures for mixed Persian/Latin text.

### 8. PDF filename validation rejects valid names and accepts misleading ones

Evidence: `uploadFile.html:246–252`.

The second dot-separated segment is checked rather than the final extension. Reproduced results: `report.final.pdf` and `REPORT.PDF` are rejected; `report.pdf.exe` is accepted. Use a case-insensitive final-extension check for UX, then validate bounded content in the main process. Do not treat an extension as proof of safe input.

### 9. Working edits have no recovery path on restart

Evidence: `uploadFile.html:225–227`, `editor.html:975`, `editor.html:989–992`.

Typing only updates statistics; edits are persisted when advancing/exporting. Closing the window can lose edits without warning. Every load of the upload page additionally requests deletion of the entire working database, so stored work is discarded when the application restarts. Database deletion also has no completion/blocked/error handling.

Implement transactional draft saving and startup recovery, with explicit discard/new-document actions. If sessions are intentionally ephemeral, make that behavior visible and protect modified text on exit.

### 10. Speech audio is retained on disk

Evidence: `main.js:160–168`.

Each generation writes a WAV containing document speech to the temp directory and never removes it. This retains potentially private content and grows disk use. Encode in memory or delete temporary files in a finally block, and clean up stale files from earlier runs.

### 11. Accessibility is incomplete in the core workflow

Evidence: `uploadFile.html:188–201`, `uploadFile.html:215`, `editor.html:224–245`; dynamic status/toast elements across all pages.

The file input has no associated label or accessible name; its visible prompt is a sibling div. Its opacity hides the native focus indication without a visible replacement. The editor removes the focus outline and only slightly changes background. Status/toast/loading updates lack live-region semantics, so success and failure feedback cannot be relied upon to announce. ARIA labels on unrelated spans do not label the input.

Associate a proper label, provide clear focus-visible styles, and use appropriate status/alert live regions. Test the complete flow with keyboard-only navigation, NVDA on Windows, high contrast, and zoom. These are source-level gaps, not a completed WCAG conformance assessment.

### 12. Packaged speech model paths need explicit resource configuration

Evidence: `main.js:14`, `main.js:26–36`, `package.json:21–29`.

`app.asar = false` is not an electron-builder packaging setting. There is no build-level model unpack/resource configuration, while native speech code receives paths under `__dirname`. A default ASAR build can place model/data files inside an archive that native filesystem code cannot read. This is a packaging risk, not an observed installer failure: no Windows artifact was built here.

Configure model files through `extraResources` and packaged paths under `process.resourcesPath`, or explicitly unpack them and use real unpacked paths. Validate on a clean Windows machine offline. See [electron-builder application contents](https://www.electron.build/v26/docs/contents/); consult the installed builder version's options when implementing.

### 13. Workspace advertises actions it does not implement

Evidence: `workSpace.html:457–459`, `workSpace.html:563`, `workSpace.html:572–728`.

The workspace displays the speech shortcut but has no speech handler; speech buttons are commented out. The output Download button has no listener, although export already saved the file through a native dialog. Implement the advertised actions or remove misleading UI; a post-export action could reveal the saved file.

### 14. Drag/drop is incomplete

Evidence: `uploadFile.html:391–406`.

There is no dragover handler cancelling the browser default, which is normally required to accept a drop. The transparent file input also overlays the custom drop zone. The drop callback accesses `dt.files[0].name` without checking for an empty file list, and custom/default file handling may diverge. Verify on Windows and consolidate into one validated import function.

## Lower-priority engineering issues

- `editor.html:819–905`: stopping playback pauses Audio but does not settle the Promise awaiting `onended`/`onerror`, leaving the old play operation pending. Use an explicit cancellation result and settle all playback paths.
- `main.js:224–227`: DOCX export trims lines and drops blank paragraphs, changing user formatting. Preserve intentional paragraph spacing and test mixed-direction content.
- `editor.html:948–968`: a scanned PDF with no text is reported as a successful extraction. Explain when OCR is required; OCR is currently absent.
- Inline page scripts duplicate storage and status logic. Separate storage/import/export/speech modules and make ownership of document state explicit before adding features.
- No automated test script, lint configuration, or CI workflow exists. `test-tts.js` is a manual smoke script with no assertions. Add focused regression checks for the confirmed defects, IPC validation, transaction failure, and one complete Windows workflow.
- README describes a repository layout that is not present and omits installation, supported runtime, model setup, development, and build instructions. Empty `src`, `apps`, and `docs` directories obscure the actual architecture.
- `.gitignore` ignores `package-lock.json` although it is already tracked; remove that rule to keep dependency-reproducibility intent clear.

## Validation performed and limits

- Parsed main, preload, manual TTS script, and every inline application script with Node's JavaScript parser: all passed syntax checks.
- Evaluated the actual text-normalization function and filename predicate: failures reproduced above.
- Traced every IPC bridge method and renderer event subscription, storage write path, and export flow.
- Inspected build configuration and the bundled model files.
- `npm audit --package-lock-only --json` failed with `EAI_AGAIN registry.npmjs.org`; no vulnerability totals are asserted.
- There is no installed `node_modules` directory. The Electron UI, native speech engine, actual PDF parsing, DOCX output, Windows installer, and screen-reader behavior were not executed. Performance impact is inferred from synchronous code; no timing claims are made.
- No initial renderer injection exploit was demonstrated. Security findings identify missing boundaries and release risks, not a proven remote compromise chain.

## Recommended order

1. Repair shortcut/file-import wiring and transactional saves; protect unsaved work.
2. Correct text normalization and file validation using the reproduced cases.
3. Move speech out of the main process, implement cancellation, and remove audio retention.
4. Upgrade Electron, narrow IPC/navigation, and add CSP.
5. Fix accessibility feedback/focus, then validate the full workflow with NVDA.
6. Configure native/model packaging and run clean offline Windows installer checks.
7. Add focused regression tests/CI and update contributor/development documentation.
