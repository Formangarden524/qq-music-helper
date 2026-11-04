const DB_NAME = 'qqMusicSaveDirectory';
async function database() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function savedDirectory(key = 'directory') {
  const db = await database();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction('preferences','readonly');
      const request = tx.objectStore('preferences').get(key);
      let value;
      request.onsuccess = () => { value = request.result || null; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('读取保存位置已中断'));
    });
  } finally { db.close(); }
}
export async function rememberDirectory(handle,key = 'directory') {
  const db = await database();
  try {
    await new Promise((resolve,reject) => {
      const tx = db.transaction('preferences','readwrite');
      tx.objectStore('preferences').put(handle,key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('保存位置设置已中断'));
    });
  } finally { db.close(); }
}
// File System Access API exposes directory names, not absolute paths.
export async function writeUniqueFile(directory,filename,blob) {
  if (!filename || /[\x00-\x1f/\\]/.test(filename) || filename === '.' || filename === '..') throw new Error('文件名无效。');
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0,dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  for (let i=0;i<1000;i++) {
    const name = i ? `${stem} (${i})${extension}` : filename;
    try { await directory.getFileHandle(name); continue; }
    catch(e) { if (e.name === 'TypeMismatchError') continue; if (e.name !== 'NotFoundError') throw e; }
    const handle = await directory.getFileHandle(name,{create:true});
    const writer = await handle.createWritable({keepExistingData:false});
    try { await writer.write(blob); await writer.close(); }
    catch(e) { await writer.abort().catch(() => {}); throw e; }
    return name;
  }
  throw new Error('同名文件过多，请更换保存目录。');
}
