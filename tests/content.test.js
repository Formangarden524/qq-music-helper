import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const metadataCode = fs.readFileSync(new URL('../extension/metadata.js',import.meta.url),'utf8');
const contentCode = fs.readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
function doc({player=false,title='女将',artist='蒋雪儿Snow.J',audio=[],readyState='complete'}={}) {
  let clicks = 0;
  const node = text => ({textContent:text,getAttribute:() => ''});
  const button = {...node('播放'),click:() => clicks++};
  return {
    readyState,title:title+' - '+artist+' - QQ音乐',clicks:() => clicks,
    querySelector:s => ({'.data__name_txt':player?null:node(title),'.song_info__name a':player?node(title):null,'.data__actions .mod_btn_green':player?null:button,'.btn_big_play':player?button:null}[s] || null),
    querySelectorAll:s => ({'.data__singer_txt':player?[]:[node(artist)],'.song_info__singer a':player?[node(artist)]:[],'script:not([src])':player?[]:[node('window.__INITIAL_DATA__ = {"detail":{"title":"女将","interval":180}};')],audio}[s] || [])
  };
}
test('读取真实页面采用的详情页/播放器选择器和 SSR 标注时长',() => {
  const context = vm.createContext({}); vm.runInContext(metadataCode,context);
  const detail = context.readQQMetadata(doc());
  assert.equal(detail.title,'女将'); assert.equal(detail.artist,'蒋雪儿Snow.J'); assert.equal(detail.expectedSeconds,180);
  const player = context.readQQMetadata(doc({player:true}));
  assert.equal(player.title,'女将'); assert.equal(player.artist,'蒋雪儿Snow.J');
});
async function run(document,targetTitle='女将',player=false) {
  const messages = []; let timer;
  const context = vm.createContext({document,location:{pathname:player?'/n/ryqq_v2/player':'/n/ryqq_v2/songDetail/318289349'},setInterval:fn => {timer=fn;return 1;},clearInterval:() => {},chrome:{runtime:{sendMessage:async m => {messages.push(m);return {ok:true,result:{active:true,title:targetTitle}};},onMessage:{addListener:() => {}}}}});
  vm.runInContext(metadataCode,context); vm.runInContext(contentCode,context);
  await new Promise(resolve => setImmediate(resolve));
  return {messages,tick:() => timer?.()};
}
test('内容脚本正确解析后台响应，只点击一次详情页播放',async () => {
  const document = doc(); const t = await run(document);
  assert.equal(document.clicks(),1);
  t.tick(); t.tick(); assert.equal(document.clicks(),1);
  assert.ok(t.messages.some(m => m.type === 'PLAY_ATTEMPTED'));
});
test('播放器当前歌曲不匹配时绝不自动播放旧队列',async () => {
  const document = doc({player:true,title:'其他歌曲'}); await run(document,'女将',true);
  assert.equal(document.clicks(),0);
});
test('页面未加载完成时保留重试机会，加载完成后才尝试播放',async () => {
  const document = doc({readyState:'loading'}); const t = await run(document);
  assert.equal(document.clicks(),0);
  document.readyState = 'complete'; t.tick(); assert.equal(document.clicks(),1);
});
