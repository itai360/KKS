// A talk's recording made ready for the server, all in the browser: decoded, turned into one channel at
// 16 kHz (what speech-to-text listens to), its volume evened out, and cut into parts of up to two
// minutes - each cut at a pause - that go out one by one as small WAV files. The host takes up to
// 4.5 MB in a request; two minutes of this WAV is 3.84 MB. Nothing is sent before the parts.

export const RATE = 16_000;
const PART_SECONDS = 120;
/** the cut looks for the quietest moment in the part's last seconds, so a word is not split */
const SEEK_SECONDS = 20;
const FRAME = RATE / 20; // 50 ms
/** a recording longer than this is too heavy for a phone's memory */
export const MAX_MINUTES = 150;
/** a part this quiet even after evening out holds no speech: it is not sent */
const SILENT_PEAK = 0.02;

export interface PreparedRecording {
  seconds: number;
  /** the parts to write out, in order (silent ones already left out) */
  count: number;
  /** a part as a WAV file */
  part: (i: number) => Blob;
}

export class RecordingError extends Error {}

/** one channel at RATE: a browser that cannot decode at RATE decodes at its own rate, then the samples are thinned */
async function decode(file: Blob): Promise<Float32Array> {
  const data = await file.arrayBuffer();
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext(1, 1, RATE);
  } catch {
    ctx = new OfflineAudioContext(1, 1, 44_100);
  }
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(data);
  } catch {
    throw new RecordingError('לא הצלחנו לקרוא את הקובץ כהקלטה. נסו קובץ m4a, mp3 או wav');
  }
  // one channel: the first one, with the others added in (in place - a long recording is big)
  const mono = audio.getChannelData(0);
  if (audio.numberOfChannels > 1) {
    const others = Array.from({ length: audio.numberOfChannels - 1 }, (_, c) => audio.getChannelData(c + 1));
    for (let i = 0; i < mono.length; i++) {
      let sum = mono[i];
      for (const ch of others) sum += ch[i];
      mono[i] = sum / audio.numberOfChannels;
    }
  }
  return audio.sampleRate === RATE ? mono : thin(mono, audio.sampleRate);
}

/** down to RATE: each new sample the average of the ones it covers (enough of a filter for speech) */
function thin(src: Float32Array, from: number): Float32Array {
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.min(src.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += src[j];
    out[i] = sum / (b - a);
  }
  return out;
}

const peakOf = (s: Float32Array, a = 0, b = s.length) => {
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(s[i]));
  return p;
};

/** a quiet recording brought up (up to ten times), so the quiet parts are not mistaken for silence */
function evenOut(s: Float32Array): void {
  const peak = peakOf(s);
  if (peak <= 0 || peak >= 0.5) return;
  const gain = Math.min(10, 0.9 / peak);
  for (let i = 0; i < s.length; i++) s[i] *= gain;
}

/** where a part that starts at `start` ends: at the quietest 50 ms of its last seconds */
export function cutAt(s: Float32Array, start: number): number {
  const end = start + PART_SECONDS * RATE;
  if (end >= s.length) return s.length;
  let best = end;
  let quietest = Infinity;
  for (let f = end - SEEK_SECONDS * RATE; f + FRAME <= end; f += FRAME) {
    let energy = 0;
    for (let i = f; i < f + FRAME; i++) energy += s[i] * s[i];
    if (energy < quietest) {
      quietest = energy;
      best = f + FRAME / 2;
    }
  }
  return Math.floor(best);
}

/** 16-bit PCM WAV, one channel at RATE */
export function wav(s: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + s.length * 2);
  const v = new DataView(buf);
  const text = (at: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(at + i, t.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + s.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // one channel
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, s.length * 2, true);
  for (let i = 0; i < s.length; i++) {
    const x = Math.max(-1, Math.min(1, s[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** The recording decoded and cut, ready to be sent part by part. */
export async function prepareRecording(file: Blob): Promise<PreparedRecording> {
  let samples: Float32Array;
  try {
    samples = await decode(file);
  } catch (e) {
    if (e instanceof RecordingError) throw e;
    throw new RecordingError('ההקלטה כבדה מדי לדפדפן הזה. נסו מהמחשב, או קובץ קצר יותר');
  }
  const seconds = samples.length / RATE;
  if (seconds < 1) throw new RecordingError('ההקלטה ריקה');
  if (seconds > MAX_MINUTES * 60) throw new RecordingError(`ההקלטה ארוכה מ-${MAX_MINUTES} דקות. חלקו אותה לכמה קבצים`);
  evenOut(samples);
  const cuts: [number, number][] = [];
  for (let start = 0; start < samples.length; ) {
    const end = cutAt(samples, start);
    if (peakOf(samples, start, end) >= SILENT_PEAK) cuts.push([start, end]);
    start = end;
  }
  if (!cuts.length) throw new RecordingError('לא נשמע דיבור בהקלטה');
  return { seconds, count: cuts.length, part: (i) => wav(samples.subarray(cuts[i][0], cuts[i][1])) };
}
