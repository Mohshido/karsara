const sherpa = require('sherpa-onnx-node')
const path = require('path')
const fs = require('fs')

const tts = new sherpa.OfflineTts({
  model: {
    vits: {
      model: path.join(__dirname, 'models/vits-piper-fa_IR-ganji-medium/fa_IR-ganji-medium.onnx'),
      tokens: path.join(__dirname, 'models/vits-piper-fa_IR-ganji-medium/tokens.txt'),
      dataDir: path.join(__dirname, 'models/vits-piper-fa_IR-ganji-medium/espeak-ng-data'),
    },
    numThreads: 1,
    debug: 0,
    provider: 'cpu',
  },
  maxNumSentences: 1,
})

const audio = tts.generate({
  text: 'روزی روزگاری یکی بود یکی نبود زیر گنبد کبود هیچ کسی جز مملی نبود',
  sid: 0,
  speed: 1.0,
})

sherpa.writeWave(
  path.join(__dirname, 'test-output.wav'),
  { samples: audio.samples, sampleRate: audio.sampleRate }
)

console.log('موفق! فایل test-output.wav ساخته شد')