import {rememberDirectory,savedDirectory} from './directory.js';
const $ = id => document.getElementById(id);
async function call(data) {
  const r = await chrome.runtime.sendMessage(data);
  if (!r?.ok) throw new Error(r?.error || '无法读取扩展设置');
  return r.result;
}
function notice(text) { $('notice').textContent = text; }
async function refresh() {
  const state = await call({type:'GET'});
  $('folder').value = state.settings.folder;
  $('destination').textContent = state.settings.destination === 'directory' ? '当前已选：'+state.settings.directoryName : '当前使用浏览器下载目录 / '+state.settings.folder;
}
$('choose').addEventListener('click',async () => {
  if (!window.showDirectoryPicker) { notice('此 Chrome 环境不支持文件夹选择，请使用下方的浏览器下载目录。'); return; }
  try {
    // Invoke immediately in the click handler to preserve transient user activation.
    const handle = await window.showDirectoryPicker({id:'qq-music-save',mode:'readwrite',startIn:'downloads'});
    const directoryId = crypto.randomUUID();
    await rememberDirectory(handle,directoryId);
    await call({type:'SET_DESTINATION',destination:'directory',directoryName:handle.name,directoryId});
    await refresh(); notice('保存位置已设为“'+handle.name+'”。现在可以关闭此页并下载歌曲。');
  } catch(e) { notice(e.name === 'AbortError' ? '已取消选择，保存位置未改变。' : '未能选择文件夹：'+e.message); }
});
$('useDownloads').addEventListener('click',async () => {
  try { await call({type:'SET_DESTINATION',destination:'downloads',folder:$('folder').value}); await refresh(); notice('已切换为浏览器下载目录。'); }
  catch(e) { notice(e.message); }
});
try { await refresh(); const state = await call({type:'GET'}); const handle = state.settings.directoryId ? await savedDirectory(state.settings.directoryId) : null; notice(handle ? '可以重新选择文件夹，或切换回浏览器下载目录。' : '点击“选择保存文件夹”，浏览并选择你的音乐目录。'); }
catch(e) { notice(e.message); }
