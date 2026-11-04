import {Mp3Encoder} from './vendor/lamejs.js';
export function encodeMP3(channels,sampleRate,onProgress = () => {}) {
  if (!Array.isArray(channels) || ![1,2].includes(channels.length) || !channels[0]?.length || ![8000,11025,12000,16000,22050,24000,32000,44100,48000].includes(sampleRate)) throw new Error('不支持此音频声道或采样率。');
  if (channels.some(c => c.length !== channels[0].length)) throw new Error('左右声道长度不一致。');
  const encoder = new Mp3Encoder(channels.length,sampleRate,192);
  const parts = [], total = channels[0].length, block = 1152;
  let previous = -1;
  const pcm = (data,start,end) => {
    const out = new Int16Array(end-start);
    for (let i=start;i<end;i++) { const value = Math.max(-1,Math.min(1,Number.isFinite(data[i]) ? data[i] : 0)); out[i-start] = value < 0 ? value*32768 : value*32767; }
    return out;
  };
  for (let start=0;start<total;start+=block) {
    const end = Math.min(total,start+block);
    const bytes = encoder.encodeBuffer(pcm(channels[0],start,end),channels.length === 2 ? pcm(channels[1],start,end) : undefined);
    if (bytes.length) parts.push(new Uint8Array(bytes));
    const percent = Math.floor(end/total*100);
    if (percent >= previous+5 || percent === 100) { previous = percent; onProgress(percent); }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return parts;
}
