import test from 'node:test';
import assert from 'node:assert/strict';
let generation = 0;
const LINK = 'https://c6.y.qq.com/base/fcgi-bin/u?__=example-test-link';
const AUDIO = 'https://dl.stream.qqmusic.qq.com/M800sample.mp3?vkey=private';
async function setup() {
  const events = {};
  const event = name => ({addListener:fn => {events[name] = fn;}});
  let memory = {}, nextTab = 10, nextDownload = 100;
  const calls = {downloads:[],tabs:[],alarms:new Map(),cancelled:[]};
  globalThis.fetch = async () => ({url:'https://i.y.qq.com/v8/playsong.html?songid=318289349'});
  globalThis.chrome = {
    runtime:{id:'test',getURL:path => 'chrome-extension://test/'+path,onMessage:event('message')},
    storage:{session:{get:async key => structuredClone({[key]:memory[key]}),set:async data => {memory = {...memory,...structuredClone(data)};}},local:{get:async () => ({}),set:async () => {}}},
    action:{setBadgeText:async () => {},openPopup:async () => {}},
    alarms:{create:async (name,info) => calls.alarms.set(name,info),clear:async name => calls.alarms.delete(name),onAlarm:event('alarm')},
    tabs:{create:async options => { const tab = {id:nextTab++,...options}; calls.tabs.push(tab); return tab; },update:async () => {},remove:async () => {},sendMessage:async () => {},onRemoved:event('removed')},
    webRequest:{onHeadersReceived:event('response')},
    downloads:{download:async options => {calls.downloads.push(options); return nextDownload++;},search:async () => [{mime:'audio/mpeg',fileSize:4321000,filename:'/Downloads/QQ音乐/女将－蒋雪儿Snow.J.mp3'}],cancel:async id => calls.cancelled.push(id),onChanged:event('download')},
    commands:{onCommand:event('command')}
  };
  await import('../extension/background.js?test='+generation++);
  const popup = {id:'test',url:'chrome-extension://test/popup.html'};
  const msg = (type,data={},sender=popup) => new Promise((resolve,reject) => events.message({type,...data},sender,r => r.ok ? resolve(r.result) : reject(new Error(r.error))));
  const state = () => msg('GET');
  const emit = async (name,value) => {events[name](value); return state();};
  async function add() { return msg('ADD',{text:LINK}); }
  async function capture(seconds=180) {
    let s = await add(); const j = s.jobs.at(-1), tabId = j.tabIds[0];
    await msg('META',{meta:{title:'女将',artist:'蒋雪儿Snow.J',expectedSeconds:180},media:[{url:AUDIO,seconds}]},{tab:{id:tabId},url:'https://y.qq.com/n/ryqq_v2/songDetail/318289349'});
    await emit('response',{tabId,url:AUDIO,statusCode:200,responseHeaders:[{name:'Content-Type',value:'audio/mpeg'},{name:'Content-Length',value:'4321000'}]});
    s = await emit('alarm',{name:'settle-'+j.id}); return s;
  }
  return {msg,state,emit,add,capture,calls};
}
test('只有显式提交任务的标签可捕获，下载完成后才标为已保存',async () => {
  const t = await setup();
  await t.add();
  await t.emit('response',{tabId:999,url:AUDIO,statusCode:200,responseHeaders:[{name:'Content-Type',value:'audio/mpeg'}]});
  assert.equal(t.calls.downloads.length,0);
  let s = await t.capture();
  assert.equal(s.jobs.length,1,'重复提交活动链接被去重');
  assert.equal(s.jobs[0].status,'downloading');
  assert.equal(t.calls.downloads[0].filename,'QQ音乐/女将－蒋雪儿Snow.J.mp3');
  assert.equal(t.calls.downloads[0].saveAs,false);
  s = await t.emit('download',{id:s.jobs[0].downloadId,state:{current:'complete'}});
  assert.equal(s.jobs[0].status,'complete');
  assert.match(s.jobs[0].note,/时长/);
  assert.equal(s.jobs[0].candidates.length,0);
});
test('已知 30 秒试听不能自动当成 180 秒歌曲保存',async () => {
  const t = await setup(); const s = await t.capture(30);
  assert.equal(s.jobs[0].status,'review');
  assert.match(s.jobs[0].note,/疑似试听/);
  assert.equal(t.calls.downloads.length,0);
  await t.msg('SAVE',{id:s.jobs[0].id,index:0});
  assert.equal(t.calls.downloads.length,1,'用户手动选择后才允许保存片段');
});
test('下载中断显示失败，不伪报保存成功',async () => {
  const t = await setup(); let s = await t.capture();
  s = await t.emit('download',{id:s.jobs[0].downloadId,state:{current:'interrupted'},error:{current:'NETWORK_FAILED'}});
  assert.equal(s.jobs[0].status,'failed');
  assert.match(s.jobs[0].note,/NETWORK_FAILED/);
});
test('捕获超时后下一首才打开，取消能停止实际下载',async () => {
  const t = await setup(); let s = await t.msg('ADD',{text:LINK+'\nhttps://y.qq.com/n/ryqq_v2/songDetail/123'});
  assert.deepEqual(s.jobs.map(j=>j.status),['capturing','queued']);
  assert.equal(t.calls.tabs.length,1);
  s = await t.emit('alarm',{name:'timeout-'+s.jobs[0].id});
  assert.deepEqual(s.jobs.map(j=>j.status),['needs-action','capturing']);
  assert.equal(t.calls.tabs.length,2);
  const u = await setup(); s = await u.capture();
  await u.msg('CANCEL',{id:s.jobs[0].id});
  assert.deepEqual(u.calls.cancelled,[s.jobs[0].downloadId]);
  assert.equal((await u.state()).jobs[0].status,'cancelled');
});
test('页面内容脚本不能代替 popup 添加新下载任务',async () => {
  const t = await setup();
  await assert.rejects(t.msg('ADD',{text:LINK},{id:'test',tab:{id:10},url:'https://y.qq.com/'}),/来源/);
});
test('同时响应的音频事件不会丢失候选；分段请求不会重复保存',async () => {
  const t = await setup(); let s = await t.add(); const id = s.jobs[0].tabIds[0];
  const details = {tabId:id,url:AUDIO,statusCode:206,responseHeaders:[{name:'Content-Type',value:'audio/mpeg'},{name:'Content-Range',value:'bytes 0-1024/4321000'}]};
  await Promise.all([t.emit('response',details),t.emit('response',details)]);
  s = await t.state(); assert.equal(s.jobs[0].candidates.length,1);
});
test('播放器子标签继承任务，任意广告或外站不会继承',async () => {
  const t = await setup(); const s = await t.add(), id = s.jobs[0].tabIds[0];
  assert.deepEqual(await t.msg('REGISTER',{}, {tab:{id:20,openerTabId:id},url:'https://evil.test/player.html'}),{active:false});
  assert.equal((await t.msg('REGISTER',{}, {tab:{id:21,openerTabId:id},url:'https://y.qq.com/n/ryqq_v2/player'})).active,true);
  assert.ok((await t.state()).jobs[0].tabIds.includes(21));
});
test('同一浏览器会话已保存的链接不会因重新打开 popup 再下载',async () => {
  const t = await setup(); let s = await t.capture();
  s = await t.emit('download',{id:s.jobs[0].downloadId,state:{current:'complete'}});
  s = await t.add();
  assert.equal(s.jobs.length,1);
  assert.equal(t.calls.downloads.length,1);
});
test('播放器补开分支通过 tabs API 打开，播放器曲目不符时暂停保存',async () => {
  const t = await setup(); let s = await t.add(); const j = s.jobs[0];
  const detailSender = {tab:{id:j.tabIds[0]},url:'https://y.qq.com/n/ryqq_v2/songDetail/318289349'};
  await t.msg('META',{meta:{title:'女将',artist:'蒋雪儿Snow.J',expectedSeconds:180}},detailSender);
  await t.msg('PLAY_ATTEMPTED',{},detailSender);
  s = await t.emit('alarm',{name:'player-'+j.id});
  assert.equal(t.calls.tabs.length,2);
  const playerSender = {tab:{id:s.jobs[0].playerTabId},url:'https://y.qq.com/n/ryqq_v2/player'};
  await t.msg('META',{meta:{title:'其他歌曲',artist:'其他歌手'},media:[{url:AUDIO,seconds:180}]},playerSender);
  await t.emit('response',{tabId:playerSender.tab.id,url:AUDIO,statusCode:200,responseHeaders:[{name:'Content-Type',value:'audio/mpeg'}]});
  s = await t.emit('alarm',{name:'settle-'+j.id});
  assert.equal(s.jobs[0].status,'review');
  assert.equal(s.jobs[0].meta.title,'女将','播放器不能覆盖原任务歌曲');
  assert.equal(t.calls.downloads.length,0);
});
test('自动保存关闭时仅生成候选，下载返回网页时标失败',async () => {
  const t = await setup();
  await t.msg('SETTINGS',{folder:'QQ音乐',autoSave:false});
  let s = await t.capture();
  assert.equal(s.jobs[0].status,'review'); assert.equal(t.calls.downloads.length,0);
  await t.msg('SAVE',{id:s.jobs[0].id,index:0});
  s = await t.state();
  chrome.downloads.search = async () => [{mime:'text/html',fileSize:800}];
  s = await t.emit('download',{id:s.jobs[0].downloadId,state:{current:'complete'}});
  assert.equal(s.jobs[0].status,'failed');
});
test('全局快捷键的扩展页面兜底入口可以提交任务',async () => {
  const t = await setup();
  const s = await t.msg('ADD',{text:LINK},{id:'test',tab:{id:300},url:'chrome-extension://test/popup.html?clipboard=1'});
  assert.equal(s.jobs[0].status,'capturing');
});
async function captureAAC(t) {
  const s = await t.add(), job = s.jobs[0];
  await t.msg('META',{meta:{title:'女将',artist:'蒋雪儿Snow.J',expectedSeconds:180},media:[]},{tab:{id:job.tabIds[0]},url:'https://y.qq.com/n/ryqq_v2/songDetail/318289349'});
  await t.emit('response',{tabId:job.tabIds[0],url:AUDIO.replace('.mp3','.m4a'),statusCode:200,responseHeaders:[{name:'Content-Type',value:'audio/mp4'}]});
  let result;
  for (let i=0;i<4;i++) result = await t.emit('alarm',{name:'settle-'+job.id});
  const j = result.jobs[0];
  const sender = {id:'test',tab:{id:j.converterTabId},url:'chrome-extension://test/converter.html?id='+job.id};
  return {job:j,sender};
}
test('AAC 必须经过真正的本地转换再保存为 MP3，不能只改后缀',async () => {
  const t = await setup(); const {job,sender} = await captureAAC(t);
  assert.equal(job.status,'converting'); assert.equal(t.calls.downloads.length,0);
  const source = await t.msg('GET_CONVERSION',{id:job.id},sender);
  assert.match(source.url,/\.m4a/);
  const s = await t.msg('CONVERSION_READY',{id:job.id,blobURL:'blob:chrome-extension://test/test-output',seconds:180.07},sender);
  assert.equal(s.status,'downloading');
  assert.match(t.calls.downloads[0].url,/^blob:/);
  assert.match(t.calls.downloads[0].filename,/\.mp3$/);
  assert.equal((await t.state()).jobs[0].integrity,'matched');
});
test('解码发现实际仅 30 秒时，即使编码完毕也不会自动保存',async () => {
  const t = await setup(); const {job,sender} = await captureAAC(t);
  await t.msg('CONVERSION_READY',{id:job.id,blobURL:'blob:chrome-extension://test/test-output',seconds:30},sender);
  assert.equal(t.calls.downloads.length,0);
  assert.equal((await t.state()).jobs[0].status,'review');
});
test('不接受外站 blob，取消转换或关闭转换页不会堵塞任务队列',async () => {
  const t = await setup(); const {job,sender} = await captureAAC(t);
  await assert.rejects(t.msg('CONVERSION_READY',{id:job.id,blobURL:'blob:https://evil.test/x',seconds:180},sender),/输出无效/);
  await t.emit('removed',job.converterTabId);
  assert.equal((await t.state()).jobs[0].status,'failed');
});
test('指定文件夹模式等待真正写入完成，不调用 Chrome 下载目录也不提前报成功',async () => {
  const t = await setup();
  await t.msg('SET_DESTINATION',{destination:'directory',directoryName:'我的音乐',directoryId:'11111111-1111-1111-1111-111111111111'});
  const {job,sender} = await captureAAC(t);
  await assert.rejects(t.msg('DIRECT_SAVE_COMPLETE',{id:job.id,filename:'女将.mp3'},sender),/结果无效/);
  const result = await t.msg('CONVERSION_READY',{id:job.id,seconds:180},sender);
  assert.equal(result.writeAllowed,true); assert.equal(t.calls.downloads.length,0);
  assert.equal((await t.state()).jobs[0].status,'converting');
  await t.msg('DIRECT_SAVE_COMPLETE',{id:job.id,filename:'女将.mp3'},sender);
  const saved = (await t.state()).jobs[0];
  assert.equal(saved.status,'complete'); assert.equal(saved.actualFile,'我的音乐/女将.mp3');
});
test('更改自动保存偏好不会丢失已选目录，正在保存时不能切换目录',async () => {
  const t = await setup();
  await t.msg('SET_DESTINATION',{destination:'directory',directoryName:'我的音乐',directoryId:'11111111-1111-1111-1111-111111111111'});
  let state = await t.msg('SETTINGS',{folder:'QQ音乐',autoSave:true});
  assert.equal(state.settings.destination,'directory');
  await captureAAC(t);
  await assert.rejects(t.msg('SET_DESTINATION',{destination:'downloads',folder:'测试'}),/保存任务完成/);
});
