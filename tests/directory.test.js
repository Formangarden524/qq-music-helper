import test from 'node:test';
import assert from 'node:assert/strict';
import {writeUniqueFile} from '../extension/directory.js';
function directory(existing = []) {
  const files = new Map(existing.map(name => [name,'original'])); let aborted = false;
  return {files,get aborted() {return aborted;},async getFileHandle(name,options) {
    if (!files.has(name) && !options?.create) throw Object.assign(new Error(),{name:'NotFoundError'});
    return {createWritable:async () => ({write:async blob => {files.set(name,await blob.text());},close:async () => {},abort:async () => {aborted=true;}})};
  }};
}
test('自定义文件夹实际写入 MP3，已有同名文件保持原样并自动编号',async () => {
  const handle = directory(['测试.mp3','测试 (1).mp3']);
  const name = await writeUniqueFile(handle,'测试.mp3',new Blob(['new audio']));
  assert.equal(name,'测试 (2).mp3'); assert.equal(handle.files.get('测试.mp3'),'original');
  assert.equal(handle.files.get(name),'new audio');
});
test('写入被拒绝时不会报成功，文件名不能含路径跳转',async () => {
  await assert.rejects(writeUniqueFile(directory(),'../test.mp3',new Blob()),/文件名/);
  const error = Object.assign(new Error('权限已失效'),{name:'NotAllowedError'});
  await assert.rejects(writeUniqueFile({getFileHandle:async () => {throw error;}},'test.mp3',new Blob()),/权限已失效/);
});
