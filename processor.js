const parentPort = process.parentPort;
const path = require("node:path");
parentPort.once("message", async ({ data: { kind, data, modelRoot } }) => {
  try {
    if (kind === "pdf") {
      const { CanvasFactory, getData } = require("pdf-parse/worker");
      const { PDFParse } = require("pdf-parse");
      PDFParse.setWorker(getData());
      const parser = new PDFParse({
        data: new Uint8Array(data),
        CanvasFactory,
        isEvalSupported: false,
      });
      try {
        const parsed = await parser.getText();
        const text = parsed.pages.map((page) => page.text).join("\n\n");
        require("./validation").validateText(text);
        parentPort.postMessage({ success: true, text, pages: parsed.total });
      } finally {
        await parser.destroy();
      }
    } else {
      const sherpa = require("sherpa-onnx-node");
      const root = path.join(modelRoot, "vits-piper-fa_IR-ganji-medium");
      const tts = new sherpa.OfflineTts({
        model: {
          vits: {
            model: path.join(root, "fa_IR-ganji-medium.onnx"),
            tokens: path.join(root, "tokens.txt"),
            dataDir: path.join(root, "espeak-ng-data"),
          },
          numThreads: 2,
          debug: 0,
          provider: "cpu",
        },
        maxNumSentences: 10,
      });
      // Electron's V8 sandbox disallows native external ArrayBuffers.
      const audio = tts.generate({
        text: data,
        sid: 0,
        speed: 1,
        enableExternalBuffer: false,
      });
      if (!audio.samples?.length) throw new Error("خروجی صوت خالی است");
      const wav = require("./wav").encodeWav(audio.samples, audio.sampleRate);
      parentPort.postMessage({ success: true, buffer: wav.toString("base64") });
    }
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
});
