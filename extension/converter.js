import {savedDirectory,writeUniqueFile} from './directory.js';
const id = new URL(location.href).searchParams.get('id');
const progress = document.getElementById('progress'), bar = document.getElementById('bar');
let blobURL, worker;
async function call(type,data = {}) {
  const response = await chrome.runtime.sendMessage({type,id,...data});
  if (!response?.ok) throw new Error(response?.error || '转换任务已结束');
  return response.result;
}
async function step(note,percent) {
  progress.textContent = note; bar.value = percent;
  await call('CONVERSION_PROGRESS',{note});
}
async function writableDirectory(key) {
  const handle = await savedDirectory(key);
  if (!handle) throw new Error('保存文件夹记录不可用，请重新选择保存位置。');
  if (await handle.queryPermission({mode:'readwrite'}) !== 'granted') {
    await step('请授权写入“'+handle.name+'”，然后继续保存。',0);
    const button = document.getElementById('authorize'); button.hidden = false;
    await new Promise((resolve,reject) => {
      button.onclick = async () => {
        try {
          const permission = await handle.requestPermission({mode:'readwrite'});
          if (permission !== 'granted') throw new Error('未获得文件夹写入权限；保存位置未改变。');
          button.hidden = true; resolve();
        } catch(e) { reject(e); }
      };
    });
  }
  return handle;
}
async function run() {
  const task = await call('GET_CONVERSION');
  document.getElementById('title').textContent = task.title;
  const directory = task.destination === 'directory' ? await writableDirectory(task.directoryId) : null;
  await step('正在读取网页音频…',3);
  const response = await fetch(task.url,{credentials:'include',signal:AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error('音频请求失败（'+response.status+'），请重新捕获。');
  const maxBytes = 80*1024*1024;
  if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('音频超过 80 MB，首版暂不转换。');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('音频超过 80 MB，首版暂不转换。'); }
    chunks.push(value);
  }
  const input = await new Blob(chunks).arrayBuffer();
  await step('正在解码音频…',12);
  const audio = new AudioContext({sampleRate:44100});
  let decoded;
  try { decoded = await audio.decodeAudioData(input); } finally { await audio.close(); }
  if (decoded.duration > 1800) throw new Error('首版仅处理 30 分钟以内的音频。');
  if (decoded.numberOfChannels > 2) throw new Error('首版仅支持单声道或双声道。');
  const channels = Array.from({length:decoded.numberOfChannels},(_,i) => new Float32Array(decoded.getChannelData(i)));
  let output;
  if (task.format === 'mp3') {
    output = new Blob([input],{type:'audio/mpeg'});
  } else {
    const parts = await new Promise((resolve,reject) => {
    worker = new Worker('encoder-worker.js',{type:'module'});
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') step(`正在转为 MP3：${data.percent}%`,15+data.percent*0.8).catch(() => worker.terminate());
      if (data.type === 'complete') { worker.terminate(); resolve(data.parts); }
      if (data.type === 'error') { worker.terminate(); reject(new Error(data.error)); }
    };
    worker.onerror = () => reject(new Error('MP3 编码器启动失败，请重新加载扩展。'));
    worker.postMessage({channels,sampleRate:decoded.sampleRate},channels.map(c => c.buffer));
    });
    output = new Blob(parts,{type:'audio/mpeg'});
  }
  progress.textContent = 'MP3 已准备好，正在保存…'; bar.value = 100;
  if (directory) {
    const result = await call('CONVERSION_READY',{seconds:decoded.duration});
    if (!result.writeAllowed) { progress.textContent = '已暂停保存，请打开扩展查看任务提示。'; return; }
    const filename = await writeUniqueFile(directory,task.filename,output);
    await call('DIRECT_SAVE_COMPLETE',{filename});
  } else {
    blobURL = URL.createObjectURL(output);
    const result = await call('CONVERSION_READY',{blobURL,seconds:decoded.duration});
    if (result.status !== 'downloading') { URL.revokeObjectURL(blobURL); progress.textContent = '已暂停保存，请打开扩展查看任务提示。'; }
  }
}
run().catch(async e => {
  if (worker) worker.terminate();
  progress.textContent = '转换未完成：'+e.message;
  await call('CONVERSION_FAILED',{error:e.message}).catch(() => {});
});
window.addEventListener('pagehide',() => { if (blobURL) URL.revokeObjectURL(blobURL); if (worker) worker.terminate(); });
