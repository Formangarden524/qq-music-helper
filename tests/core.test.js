import test from 'node:test';
import assert from 'node:assert/strict';
import {extractLinks,isPageURL,desktopSongURL,cleanName,folderName,audioCandidate,durationStatus,outputName,publicState,SAMPLE} from '../extension/core.js';
test('从带中文说明的分享中提取 QQ 短链接，去重并拒绝伪造域名',() => {
  assert.deepEqual(extractLinks(`分享《女将》：${SAMPLE}，\n${SAMPLE}\nhttps://y.qq.com.evil.test/x\nhttps://evil.test/y.qq.com`),[SAMPLE]);
  assert.equal(isPageURL('https://y.qq.com/n/ryqq_v2/songDetail/318289349'),true);
  for (const s of ['http://y.qq.com/x','https://evil@y.qq.com/x','javascript:alert(1)','https://qq.com/x']) assert.equal(isPageURL(s),false);
});
test('文件名不会越出下载目录，保留中文和实际格式',() => {
  assert.equal(cleanName('../女将:现场/版\u0000'),'女将 现场 版');
  assert.ok(!folderName('../../tmp').includes('..'));
  assert.equal(outputName({id:'1',meta:{title:'女将',artist:'蒋雪儿Snow.J'}},{format:'m4a'},'QQ音乐'),'QQ音乐/女将－蒋雪儿Snow.J.m4a');
  assert.equal(Array.from(cleanName('😀'.repeat(100))).length,80);
});
const response = (url,mime,size='3456789',statusCode=200) => ({url,statusCode,responseHeaders:[{name:'Content-Type',value:mime},{name:'Content-Length',value:size}]});
test('允许 QQ 普通音频并从 Content-Range 取整文件大小',() => {
  const r = response('https://dl.stream.qqmusic.qq.com/M800test.mp3?vkey=x','audio/mpeg');
  r.statusCode = 206; r.responseHeaders.push({name:'Content-Range',value:'bytes 0-100/5678900'});
  assert.equal(audioCandidate(r).size,5678900);
  assert.equal(audioCandidate(r).format,'mp3');
});
test('拒绝 HTML、视频、加密文件、分片、小文件和第三方域名',() => {
  for (const [url,mime,size,status] of [
    ['https://evil.test/test.mp3','audio/mpeg','9000',200],
    ['https://dl.stream.qqmusic.qq.com/test.mp3','text/html','9000',200],
    ['https://dl.stream.qqmusic.qq.com/test.mgg','audio/mpeg','9000',200],
    ['https://dl.stream.qqmusic.qq.com/test.mp4','video/mp4','9000',200],
    ['https://dl.stream.qqmusic.qq.com/test.m3u8','application/vnd.apple.mpegurl','9000',200],
    ['https://dl.stream.qqmusic.qq.com/test.mp3','audio/mpeg','100',200],
    ['https://dl.stream.qqmusic.qq.com/test.mp3','audio/mpeg','9000',403]
  ]) assert.equal(audioCandidate(response(url,mime,size,status)),null,url);
});
test('完整性判断分开表示时长相符、疑似试听与无法验证',() => {
  assert.equal(durationStatus(180,30),'preview');
  assert.equal(durationStatus(180,179),'matched');
  assert.equal(durationStatus(180,0),'unknown');
});
test('发送给 popup 的数据不包含签名音频地址',() => {
  const result = publicState({jobs:[{id:'1',media:[{url:'https://dl.stream.qqmusic.qq.com/b?vkey=SECRET'}],candidates:[{url:'https://dl.stream.qqmusic.qq.com/a?vkey=SECRET',format:'mp3'}]}]});
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('长中文歌名保留格式且不会超过常见文件名的字节上限',() => {
  const filename = outputName({meta:{title:'长'.repeat(80),artist:'歌手'.repeat(80)}},{format:'mp3'},'音乐').split('/').at(-1);
  assert.ok(new TextEncoder().encode(filename).length < 255);
  assert.ok(filename.endsWith('.mp3'));
});
test('QQ 移动分享落地页转为桌面歌曲页，避免再次唤起 QQ 客户端',() => {
  assert.equal(desktopSongURL('https://i.y.qq.com/v8/playsong.html?songid=318289349&openinqqmusic=1'),'https://y.qq.com/n/ryqq_v2/songDetail/318289349');
  assert.equal(desktopSongURL('https://evil.test/?songid=318289349'),null);
  assert.equal(desktopSongURL('https://c6.y.qq.com/base/fcgi-bin/u?__=example-test-link'),null);
  assert.equal(desktopSongURL(SAMPLE),SAMPLE);
});
