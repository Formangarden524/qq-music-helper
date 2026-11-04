import {extractLinks,SAMPLE} from './core.js';
const $ = id => document.getElementById(id);
const labels = {queued:'排队中',capturing:'正在捕获',converting:'转为MP3',downloading:'下载中',complete:'已保存',failed:'失败',review:'待确认','needs-action':'需要操作',cancelled:'已取消'};
async function call(type,data = {}) {
  const response = await chrome.runtime.sendMessage({type,...data});
  if (!response?.ok) throw new Error(response?.error || '扩展暂时无响应，请重新打开。');
  return response.result;
}
function notice(text,error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
function el(tag,className,text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
function action(text,fn) { const b = el('button','',text); b.addEventListener('click',async () => { b.disabled = true; try { await fn(); await refresh(); } catch(e) { notice(e.message,true); } finally { b.disabled = false; } }); return b; }
function render(state) {
  $('destination').textContent = state.settings.destination === 'directory' ? '已选择：'+state.settings.directoryName : '浏览器下载目录 / '+state.settings.folder;
  $('downloadFolder').hidden = state.settings.destination === 'directory';
  const list = $('jobs'); list.replaceChildren();
  if (!state.jobs.length) list.append(el('div','empty','复制 QQ 音乐分享链接，然后打开这个扩展。任务会在这里显示。'));
  for (const job of [...state.jobs].reverse()) {
    const card = el('article','job'); card.dataset.status = job.status;
    const head = el('div','job-head');
    head.append(el('div','job-title',job.meta?.title ? `${job.meta.title}${job.meta.artist ? ' · '+job.meta.artist : ''}` : 'QQ 音乐分享链接'),el('span','badge',labels[job.status] || job.status));
    card.append(head,el('div','note',job.note));
    if (job.actualFile || job.output) card.append(el('div','filename',job.actualFile || job.output));
    const buttons = el('div','actions');
    buttons.append(action('打开歌曲页',() => chrome.tabs.create({url:job.pageURL || job.link,active:true})));
    if (['queued','capturing','converting','downloading','review'].includes(job.status)) buttons.append(action('取消',() => call('CANCEL',{id:job.id})));
    if (['failed','review','needs-action','cancelled'].includes(job.status)) buttons.append(action('重新捕获',() => call('RETRY',{id:job.id})));
    if (job.status === 'complete' && job.downloadId !== undefined) buttons.append(action('在文件夹中显示',() => chrome.downloads.show(job.downloadId)));
    card.append(buttons);
    if (job.status === 'review') for (const c of job.candidates) {
      const row = el('div','candidate');
      const seconds = c.seconds ? `${Math.round(c.seconds)} 秒` : '时长未识别';
      row.append(el('span','',`${c.format.toUpperCase()} · ${c.size ? (c.size/1024/1024).toFixed(1)+' MB' : '大小未知'} · ${seconds}`),action('保存此音频',() => call('SAVE',{id:job.id,index:c.index})));
      card.append(row);
    }
    list.append(card);
  }
}
async function refresh() { const state = await call('GET'); render(state); return state; }
let starting = false;
async function start(text) {
  if (starting) return;
  starting = true; $('start').disabled = true;
  try {
    if (!extractLinks(text).length) throw new Error('没有识别到 QQ 音乐链接，请粘贴分享链接。');
    const state = await call('ADD',{text}); render(state); notice(state.notice);
  } catch(e) { notice(e.message,true); }
  finally { starting = false; $('start').disabled = false; }
}
async function clipboard(autoStart) {
  try {
    const text = await navigator.clipboard.readText();
    // Discard unrelated clipboard data without displaying or sending it to the worker.
    const links = extractLinks(text);
    if (!links.length) { notice('剪贴板里没有 QQ 音乐链接。可以直接粘贴到下方。'); return; }
    $('links').value = links.join('\n');
    if (autoStart) await start(links.join('\n')); else notice('链接已填入，点击“开始保存”。');
  } catch { notice('Chrome 未允许读取剪贴板，请粘贴链接后点击“开始保存”。'); }
}
$('start').addEventListener('click',() => start($('links').value));
$('paste').addEventListener('click',() => clipboard(false));
$('sample').addEventListener('click',() => { $('links').value = SAMPLE; notice('示例已填入，点击“开始保存”。'); });
$('clear').addEventListener('click',async () => { try { render(await call('CLEAR')); } catch(e) { notice(e.message,true); } });
$('settings').addEventListener('click',async () => {
  try { const state = await call('SETTINGS',{folder:$('folder').value,autoSave:$('autoSave').checked}); $('folder').value = state.settings.folder; notice('设置已保存。'); } catch(e) { notice(e.message,true); }
});
$('shortcuts').addEventListener('click',() => chrome.tabs.create({url:'chrome://extensions/shortcuts'}));
$('downloads').addEventListener('click',() => chrome.tabs.create({url:'chrome://downloads'}));
$('chooseFolder').addEventListener('click',() => chrome.tabs.create({url:chrome.runtime.getURL('settings.html'),active:true}));
try {
  const state = await refresh(); $('folder').value = state.settings.folder; $('autoSave').checked = state.settings.autoSave;
  if (document.hasFocus()) await clipboard(true);
  else notice('点击“读取剪贴板”，或直接粘贴 QQ 音乐链接。');
} catch(e) { notice(e.message,true); }
setInterval(() => refresh().catch(() => {}),1500);
