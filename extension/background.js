import {extractLinks, isPageURL, desktopSongURL, audioCandidate, durationStatus, outputName, publicState, folderName} from './core.js';

const KEY = 'qqHelperState';
const fresh = () => ({jobs:[], settings:{folder:'QQ音乐',autoSave:true}, notice:''});
let serial = Promise.resolve();
const enqueue = fn => { const result = serial.then(fn); serial = result.catch(() => {}); return result; };
async function load() {
  const stored = (await chrome.storage.session.get(KEY))[KEY];
  if (stored) return stored;
  const state = fresh();
  state.settings = (await chrome.storage.local.get('settings')).settings || state.settings;
  return state;
}
async function save(state) {
  await chrome.storage.session.set({[KEY]:state});
  const busy = state.jobs.some(j => ['capturing','converting','downloading','queued'].includes(j.status));
  await chrome.action.setBadgeText({text:busy ? '…' : ''});
}
function jobForTab(state,id) { return state.jobs.find(j => j.tabIds?.includes(id) && j.status === 'capturing'); }
function finish(job,status,note) { job.status = status; job.note = note; job.updatedAt = Date.now(); }
async function stop(job) {
  await chrome.alarms.clear('timeout-'+job.id);
  await chrome.alarms.clear('settle-'+job.id);
  await chrome.alarms.clear('player-'+job.id);
  await Promise.allSettled((job.tabIds || []).map(id => chrome.tabs.sendMessage(id,{type:'STOP'})));
}
async function advance(state) {
  if (state.jobs.some(j => ['capturing','converting','downloading'].includes(j.status))) return;
  const job = state.jobs.find(j => j.status === 'queued');
  if (!job) return;
  try {
    // Record ownership before navigating so content scripts cannot outrun registration.
    const tab = await chrome.tabs.create({url:'about:blank',active:true});
    job.tabIds = [tab.id]; job.candidates = []; job.media = []; job.settleAttempts = 0;
    delete job.playerTabId; delete job.playerTitle; delete job.converterTabId; delete job.directoryWriteApproved;
    finish(job,'capturing','正在打开歌曲页；需要登录时，请在歌曲页完成登录。');
    await save(state);
    await chrome.alarms.create('timeout-'+job.id,{when:Date.now()+90_000});
    // Resolve public share redirects without opening the client's deep link in a tab.
    // A failed resolver falls back to the original user-supplied page.
    let target = desktopSongURL(job.link);
    if (!target) {
      try {
        const response = await fetch(job.link,{credentials:'omit',signal:AbortSignal.timeout(12000)});
        target = desktopSongURL(response.url);
      } catch { /* Navigation still works when the public short-link request is blocked. */ }
    }
    job.pageURL = target || job.link;
    await chrome.tabs.update(tab.id,{url:job.pageURL});
  } catch (e) { finish(job,'failed','无法打开歌曲页：'+e.message); await advance(state); }
}
async function startDownload(state,job,index,manual = false) {
  const candidate = job.candidates[index];
  if (!candidate || !['capturing','review'].includes(job.status)) throw new Error('候选已失效，请重新捕获。');
  if (!job.meta?.title) throw new Error('尚未读到歌名，请在歌曲详情页重试。');
  job.integrity = durationStatus(job.meta.expectedSeconds,candidate.seconds);
  if (!manual && job.integrity === 'preview') {
    finish(job,'review',`疑似试听片段：音频 ${Math.round(candidate.seconds)} 秒，歌曲标注 ${job.meta.expectedSeconds} 秒。已暂停自动保存。`);
    await stop(job); await advance(state); return;
  }
  const filename = outputName(job,candidate,state.settings.folder);
  await stop(job);
  if (candidate.format !== 'mp3' || state.settings.destination === 'directory') {
    finish(job,'converting',candidate.format === 'mp3' ? '正在保存到指定文件夹；请保留保存页面。' : '正在本机转换为 MP3；请保留转换页面直到保存完成。');
    job.conversionIndex = index; job.conversionManual = manual;
    job.saveDestination = state.settings.destination === 'directory' ? 'directory' : 'downloads';
    job.directoryName = state.settings.directoryName || '';
    job.directoryId = state.settings.directoryId;
    try {
      const tab = await chrome.tabs.create({url:'about:blank',active:true});
      job.converterTabId = tab.id;
      await save(state);
      await chrome.alarms.create('conversion-timeout-'+job.id,{when:Date.now()+300_000});
      await chrome.tabs.update(tab.id,{url:chrome.runtime.getURL('converter.html?id='+job.id)});
    } catch(e) { finish(job,'failed','无法启动 MP3 转换：'+e.message); await advance(state); }
    return;
  }
  finish(job,'downloading','正在下载：'+filename);
  try {
    job.downloadId = await chrome.downloads.download({url:candidate.url,filename,saveAs:false,conflictAction:'uniquify'});
    job.output = filename;
  } catch(e) { finish(job,'failed','下载未启动：'+e.message+'。请重新捕获，音频地址可能已过期。'); await advance(state); }
}
async function settle(state,job) {
  if (job.status !== 'capturing' || !job.candidates.length) return;
  if (job.playerTabId && !job.playerTitle && job.settleAttempts < 10) {
    job.settleAttempts++;
    await chrome.alarms.create('settle-'+job.id,{when:Date.now()+2500}); return;
  }
  if (job.playerTabId && job.playerTitle !== job.meta?.title) {
    finish(job,'review','播放器显示的歌曲与提交歌曲不一致，已暂停保存；请重新捕获。');
    await stop(job); await advance(state); return;
  }
  if (!job.meta?.title || (!job.candidates.some(c => c.seconds > 0) && job.settleAttempts < 3)) {
    job.settleAttempts++;
    if (job.settleAttempts < 10) {
      await chrome.alarms.create('settle-'+job.id,{when:Date.now()+2500}); return;
    }
    finish(job,'review','已捕获音频，但未能识别歌名；请打开歌曲详情页后重新捕获。');
    await stop(job); await advance(state); return;
  }
  const ranked = job.candidates.map((c,i) => ({i,c})).sort((a,b) => {
    const ap = durationStatus(job.meta.expectedSeconds,a.c.seconds) === 'preview';
    const bp = durationStatus(job.meta.expectedSeconds,b.c.seconds) === 'preview';
    return Number(ap)-Number(bp) || b.c.size-a.c.size;
  });
  if (state.settings.autoSave) await startDownload(state,job,ranked[0].i);
  else { finish(job,'review','已捕获音频，请选择保存。'); await stop(job); await advance(state); }
}
async function register(state,sender) {
  if (!sender.tab || !isPageURL(sender.url || sender.tab.url)) return null;
  let job = jobForTab(state,sender.tab.id);
  if (!job && sender.tab.openerTabId && /player|playsong/i.test(sender.url || sender.tab.url)) {
    job = jobForTab(state,sender.tab.openerTabId);
    if (job) job.tabIds.push(sender.tab.id);
  }
  if (job && /\/player\/?$/.test(new URL(sender.url || sender.tab.url).pathname)) job.playerTabId = sender.tab.id;
  return job;
}
async function messageHandler(message,sender) {
  const state = await load();
  const fromExtension = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
  if (['REGISTER','META','PLAY_ATTEMPTED'].includes(message.type)) {
    const job = await register(state,sender);
    if (!job) return {active:false};
    if (message.type === 'META') {
      const meta = message.meta || {};
      const isPlayer = /\/player\/?$/.test(new URL(sender.url || sender.tab.url).pathname);
      if (isPlayer) job.playerTitle = String(meta.title || '').slice(0,200);
      if (!isPlayer && typeof meta.title === 'string' && meta.title.trim()) {
        job.meta = {title:meta.title.slice(0,200),artist:String(meta.artist || job.meta?.artist || '').slice(0,200),expectedSeconds:Number(meta.expectedSeconds) || job.meta?.expectedSeconds || 0};
      }
      for (const media of (Array.isArray(message.media) ? message.media : []).slice(0,8)) {
        if (typeof media.url !== 'string' || !(media.seconds > 0 && media.seconds < 86400)) continue;
        job.media = [...(job.media || []).filter(m => m.url !== media.url),{url:media.url,seconds:media.seconds}].slice(-8);
        const c = job.candidates.find(c => c.url === media.url);
        if (c) c.seconds = media.seconds;
      }
    }
    if (message.type === 'PLAY_ATTEMPTED') {
      job.note = '已尝试播放；如果网页要求登录或点击播放，请在歌曲页操作一次。';
      await chrome.alarms.create('player-'+job.id,{when:Date.now()+2000});
    }
    await save(state); return {active:true,title:job.meta?.title || ''};
  }
  if (!fromExtension) throw new Error('请求来源无效。');
  if (['GET_CONVERSION','CONVERSION_PROGRESS','CONVERSION_READY','CONVERSION_FAILED','DIRECT_SAVE_COMPLETE'].includes(message.type)) {
    const source = new URL(sender.url);
    const job = state.jobs.find(j => j.id === message.id && j.status === 'converting');
    if (source.pathname !== '/converter.html' || source.searchParams.get('id') !== message.id || !job || (sender.tab && sender.tab.id !== job.converterTabId)) throw new Error('转换任务已结束或来源不匹配。');
    if (message.type === 'GET_CONVERSION') return {url:job.candidates[job.conversionIndex].url,title:job.meta.title,expectedSeconds:job.meta.expectedSeconds,format:job.candidates[job.conversionIndex].format,destination:job.saveDestination,directoryId:job.directoryId,filename:outputName(job,{format:'mp3'},'QQ音乐').split('/').at(-1)};
    if (message.type === 'CONVERSION_PROGRESS') job.note = String(message.note || '正在转换为 MP3').slice(0,150);
    if (message.type === 'CONVERSION_FAILED') {
      finish(job,'failed','MP3 转换失败：'+String(message.error || '请重新捕获').slice(0,180));
      await chrome.alarms.clear('conversion-timeout-'+job.id); await advance(state);
    }
    if (message.type === 'CONVERSION_READY') {
      if (!(message.seconds > 0 && message.seconds <= 1800) || (job.saveDestination !== 'directory' && !String(message.blobURL).startsWith('blob:'+chrome.runtime.getURL('')))) throw new Error('转换输出无效。');
      const candidate = job.candidates[job.conversionIndex];
      candidate.seconds = message.seconds;
      job.integrity = durationStatus(job.meta.expectedSeconds,message.seconds);
      await chrome.alarms.clear('conversion-timeout-'+job.id);
      if (job.integrity === 'preview' && !job.conversionManual) {
        finish(job,'review',`解码确认音频只有 ${Math.round(message.seconds)} 秒，歌曲标注 ${job.meta.expectedSeconds} 秒；已暂停自动保存。`);
        await advance(state);
      } else if (job.saveDestination === 'directory') {
        job.directoryWriteApproved = true;
        job.note = 'MP3 已准备好，正在写入指定文件夹。';
        await chrome.alarms.create('conversion-timeout-'+job.id,{when:Date.now()+300_000});
      } else {
        try {
          job.output = outputName(job,{format:'mp3'},state.settings.folder);
          finish(job,'downloading','MP3 转换完成，正在保存。');
          job.downloadId = await chrome.downloads.download({url:message.blobURL,filename:job.output,saveAs:false,conflictAction:'uniquify'});
        } catch(e) { finish(job,'failed','MP3 保存失败：'+e.message); await advance(state); }
      }
    }
    if (message.type === 'DIRECT_SAVE_COMPLETE') {
      const name = String(message.filename || '');
      if (job.saveDestination !== 'directory' || !job.directoryWriteApproved || !name.endsWith('.mp3') || /[/\\\x00-\x1f]/.test(name)) throw new Error('保存结果无效。');
      job.actualFile = job.directoryName+'/'+name;
      job.output = job.actualFile; job.candidates = []; job.media = [];
      finish(job,'complete',job.integrity === 'matched' ? '已保存到指定文件夹；播放时长与页面标注相符。' : job.integrity === 'preview' ? '已按你的选择保存片段到指定文件夹。' : '已保存到指定文件夹；完整性未验证。');
      await chrome.alarms.clear('conversion-timeout-'+job.id);
      await advance(state); await save(state);
      await chrome.tabs.remove(job.converterTabId).catch(() => {});
      return {status:job.status};
    }
    await save(state); return {status:job.status,writeAllowed:message.type === 'CONVERSION_READY' && job.status === 'converting' && job.saveDestination === 'directory'};
  }
  if (message.type === 'GET') return publicState(state);
  if (message.type === 'ADD') {
    const links = extractLinks(String(message.text || ''));
    if (!links.length) throw new Error('没有识别到 HTTPS QQ 音乐链接。');
    const pending = state.jobs.filter(j => ['queued','capturing','converting','downloading'].includes(j.status));
    if (pending.length+links.length > 10) throw new Error('一次最多处理 10 首，请等当前队列完成。');
    let count = 0;
    for (const link of links) {
      if (state.jobs.some(j => j.link === link && ['queued','capturing','converting','downloading','complete'].includes(j.status))) continue;
      state.jobs.push({id:crypto.randomUUID(),link,status:'queued',note:'等待处理',createdAt:Date.now(),tabIds:[],candidates:[]}); count++;
    }
    state.jobs = state.jobs.slice(-40);
    state.notice = count ? `已加入 ${count} 首。` : '该链接已在队列中或本次浏览器会话中已保存；如需再存，可先清除已结束记录。';
    await advance(state);
  } else if (message.type === 'SETTINGS') {
    state.settings = {...state.settings,folder:folderName(message.folder),autoSave:message.autoSave !== false};
    await chrome.storage.local.set({settings:state.settings});
  } else if (message.type === 'SET_DESTINATION') {
    if (!['directory','downloads'].includes(message.destination)) throw new Error('保存位置类型无效。');
    if (state.jobs.some(j => ['converting','downloading'].includes(j.status))) throw new Error('请等当前保存任务完成后再更改文件夹。');
    state.settings = {...state.settings,destination:message.destination};
    if (message.destination === 'directory') {
      if (!/^[a-f0-9-]{36}$/i.test(String(message.directoryId || ''))) throw new Error('请选择有效的保存文件夹。');
      state.settings.directoryName = String(message.directoryName || '音乐文件夹').slice(0,200);
      state.settings.directoryId = message.directoryId;
    }
    else state.settings.folder = folderName(message.folder);
    await chrome.storage.local.set({settings:state.settings});
  } else if (message.type === 'CANCEL') {
    const job = state.jobs.find(j => j.id === message.id);
    if (job && ['queued','capturing','converting','downloading','review'].includes(job.status)) {
      if (job.status === 'downloading' && job.downloadId !== undefined) await chrome.downloads.cancel(job.downloadId).catch(() => {});
      finish(job,'cancelled','已取消'); job.candidates = []; job.media = []; await stop(job); await advance(state);
      await chrome.alarms.clear('conversion-timeout-'+job.id);
      if (job.converterTabId !== undefined) await chrome.tabs.remove(job.converterTabId).catch(() => {});
    }
  } else if (message.type === 'RETRY') {
    const job = state.jobs.find(j => j.id === message.id);
    if (job && ['failed','review','cancelled','needs-action'].includes(job.status)) {
      await stop(job); delete job.downloadId; delete job.output; job.candidates = []; job.media = []; job.tabIds = [];
      finish(job,'queued','重新捕获'); await advance(state);
    }
  } else if (message.type === 'SAVE') {
    const job = state.jobs.find(j => j.id === message.id);
    if (!job || job.status !== 'review') throw new Error('任务不可保存，请重新捕获。');
    await startDownload(state,job,Number(message.index),true);
  } else if (message.type === 'CLEAR') {
    state.jobs = state.jobs.filter(j => ['queued','capturing','converting','downloading'].includes(j.status));
  } else if (message.type !== 'GET') throw new Error('未知操作');
  await save(state); return publicState(state);
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  enqueue(() => messageHandler(message,sender)).then(result => respond({ok:true,result}),e => respond({ok:false,error:e.message}));
  return true;
});
chrome.webRequest.onHeadersReceived.addListener(details => {
  enqueue(async () => {
    const state = await load(); const job = jobForTab(state,details.tabId);
    if (!job) return;
    const candidate = audioCandidate(details);
    if (!candidate) return;
    const existing = job.candidates.find(c => c.url === candidate.url);
    if (existing) { existing.size = Math.max(existing.size,candidate.size); await save(state); return; }
    if (job.candidates.length >= 8) return;
    candidate.seconds = job.media?.find(m => m.url === candidate.url)?.seconds || 0;
    job.candidates.push(candidate); job.note = '已捕获音频，正在核对歌名与时长。';
    await chrome.alarms.create('settle-'+job.id,{when:Date.now()+2500});
    await save(state);
  });
},{urls:['https://y.qq.com/*','https://*.y.qq.com/*','https://*.qqmusic.qq.com/*','https://*.qqmusic.tc.qq.com/*']},['responseHeaders']);
chrome.alarms.onAlarm.addListener(alarm => enqueue(async () => {
  const state = await load();
  const job = state.jobs.find(j => alarm.name.endsWith(j.id));
  if (job?.status === 'converting' && alarm.name === 'conversion-timeout-'+job.id) {
    finish(job,'failed','MP3 转换超时，请重新捕获。');
    if (job.converterTabId !== undefined) await chrome.tabs.remove(job.converterTabId).catch(() => {});
    await advance(state); await save(state); return;
  }
  if (!job || job.status !== 'capturing') return;
  if (alarm.name === 'player-'+job.id && !job.playerTabId) {
    // Content-script clicks lack a trusted user gesture, so Chrome may block window.open.
    // Open the official player through the tabs API after the song page updates its queue.
    const tab = await chrome.tabs.create({url:'about:blank',active:true});
    job.tabIds.push(tab.id); job.playerTabId = tab.id;
    await save(state);
    await chrome.tabs.update(tab.id,{url:'https://y.qq.com/n/ryqq_v2/player'});
  }
  if (alarm.name === 'settle-'+job.id) await settle(state,job);
  if (alarm.name === 'timeout-'+job.id && job.status === 'capturing') {
    finish(job,'needs-action','90 秒内未完成捕获。请在歌曲页登录并确认能播放，再点“重新捕获”。');
    await stop(job); await advance(state);
  }
  await save(state);
}));
chrome.downloads.onChanged.addListener(delta => enqueue(async () => {
  const state = await load(); const job = state.jobs.find(j => j.downloadId === delta.id && j.status === 'downloading');
  if (!job) return;
  if (delta.state?.current === 'complete') {
    const items = await chrome.downloads.search({id:delta.id});
    const item = items[0];
    if ((item?.mime && /html|json|xml|^text\//i.test(item.mime)) || item?.fileSize === 0) {
      finish(job,'failed','下载返回了网页或空文件，请重新登录后捕获。');
    } else {
      job.actualFile = item?.filename || job.output;
      finish(job,'complete',job.integrity === 'matched' ? '已保存；播放时长与页面标注相符。' : job.integrity === 'preview' ? '已按你的选择保存疑似试听片段。' : '已保存；完整性未验证，请试听核对。');
    }
  } else if (delta.state?.current === 'interrupted' || delta.error) {
    finish(job,'failed','下载中断：'+(delta.error?.current || '请查看 Chrome 下载记录')+'。可重新捕获。');
  } else return;
  job.candidates = []; job.media = [];
  if (job.converterTabId !== undefined) await chrome.tabs.remove(job.converterTabId).catch(() => {});
  await advance(state); await save(state);
}));
chrome.tabs.onRemoved.addListener(tabId => enqueue(async () => {
  const state = await load();
  const conversion = state.jobs.find(j => j.converterTabId === tabId && ['converting','downloading'].includes(j.status));
  if (conversion) {
    if (conversion.downloadId !== undefined) await chrome.downloads.cancel(conversion.downloadId).catch(() => {});
    finish(conversion,'failed','转换页面提前关闭，请重新捕获。');
    await chrome.alarms.clear('conversion-timeout-'+conversion.id);
    await advance(state); await save(state); return;
  }
  const job = jobForTab(state,tabId);
  if (!job) return;
  job.tabIds = job.tabIds.filter(id => id !== tabId);
  if (!job.tabIds.length) { finish(job,'needs-action','歌曲页已关闭，请重新捕获。'); await stop(job); await advance(state); }
  await save(state);
}));
chrome.commands.onCommand.addListener(command => {
  if (command === 'capture-clipboard') chrome.action.openPopup().catch(async () => {
    // Some platforms cannot open a popup while Chrome is unfocused. A normal extension page is the fallback.
    await chrome.tabs.create({url:chrome.runtime.getURL('popup.html?clipboard=1'),active:true});
  });
});
