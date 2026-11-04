import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeMP3} from '../extension/mp3-encode.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('实际编码器输出可被 ffprobe 识别的 MP3，单声道和双声道都保留时长',() => {
  const dir = mkdtempSync(join(tmpdir(),'qq-mp3-test-'));
  try {
    for (const count of [1,2]) {
      const data = Array.from({length:count},() => Float32Array.from({length:44100},(_,i) => 0.2*Math.sin(i/44100*440*Math.PI*2)));
      const parts = encodeMP3(data,44100);
      const path = join(dir,count+'.mp3'); writeFileSync(path,Buffer.concat(parts.map(p=>Buffer.from(p))));
      const result = JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,channels:format=duration','-of','json',path],{encoding:'utf8'}));
      assert.equal(result.streams[0].codec_name,'mp3'); assert.equal(result.streams[0].channels,count);
      assert.ok(Math.abs(Number(result.format.duration)-1)<0.1);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('编码器拒绝损坏的声道与不支持的采样率',() => {
  assert.throws(()=>encodeMP3([],44100),/声道/);
  assert.throws(()=>encodeMP3([new Float32Array(10)],12345),/采样率/);
  assert.throws(()=>encodeMP3([new Float32Array(10),new Float32Array(9)],44100),/长度/);
});
