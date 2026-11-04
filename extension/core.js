export const SAMPLE = 'https://y.qq.com/n/ryqq_v2/songDetail/318289349';
export function isPageURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'y.qq.com' || u.hostname.endsWith('.y.qq.com')); } catch { return false; }
}
export function extractLinks(text) {
  const links = (String(text).match(/https:\/\/[^\s<>"）)\]】]+/g) || []).map(s => s.replace(/[，。；,;]+$/, ''));
  return [...new Set(links.filter(isPageURL))];
}
export function desktopSongURL(value) {
  if (!isPageURL(value)) return null;
  const u = new URL(value);
  const id = u.searchParams.get('songid');
  if (id && /^\d+$/.test(id)) return 'https://y.qq.com/n/ryqq_v2/songDetail/'+id;
  if (/^\/n\/ryqq(?:_v2)?\/songDetail\/[a-z0-9]+\/?$/i.test(u.pathname)) return 'https://y.qq.com'+u.pathname;
  return null;
}
export function isAudioHost(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ['y.qq.com', 'qqmusic.qq.com', 'qqmusic.tc.qq.com'].some(h => u.hostname === h || u.hostname.endsWith('.' + h)); } catch { return false; }
}
export function cleanName(value, fallback = '未知') {
  const s = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  return Array.from(s || fallback).slice(0, 80).join('');
}
export function folderName(value) { return cleanName(value, 'QQ音乐').replace(/\.{2,}/g, ' '); }
export function audioCandidate(details) {
  if (!isAudioHost(details.url) || details.statusCode < 200 || details.statusCode >= 300) return null;
  const u = new URL(details.url);
  const headers = Object.fromEntries((details.responseHeaders || []).map(h => [h.name.toLowerCase(), h.value || '']));
  const mime = (headers['content-type'] || '').split(';')[0].toLowerCase();
  const ext = u.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const mimeExt = {'audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/ogg':'ogg','application/ogg':'ogg','audio/flac':'flac','audio/x-flac':'flac','audio/wav':'wav','audio/x-wav':'wav'};
  if (['m3u8','mpd','mgg','mflac','qmc0','qmc3','qmcflac','ts','mp4'].includes(ext)) return null;
  if (/html|json|video|mpegurl|dash/.test(mime)) return null;
  const format = mimeExt[mime] || (['mp3','m4a','aac','ogg','flac','wav'].includes(ext) && ['','application/octet-stream','binary/octet-stream'].includes(mime) ? ext : null);
  if (!format) return null;
  const range = headers['content-range']?.match(/\/(\d+)$/);
  const size = Number(range?.[1] || headers['content-length'] || 0);
  if (size > 0 && size < 4096) return null;
  return {url:details.url, format, mime, size, seconds:0};
}
export function durationStatus(expected, actual) {
  if (!(actual > 0) || !(expected > 0)) return 'unknown';
  return actual < expected - Math.max(5, expected * 0.1) ? 'preview' : 'matched';
}
export function outputName(job, candidate, folder) {
  const base = `${cleanName(job.meta?.title, 'QQ音乐-'+job.id)}－${cleanName(job.meta?.artist, '未知歌手')}`;
  let fitted = '', bytes = 0;
  for (const char of base) {
    const length = new TextEncoder().encode(char).length;
    if (bytes+length > 230) break;
    fitted += char; bytes += length;
  }
  return `${folderName(folder)}/${fitted}.${candidate.format}`;
}
export function publicState(state) {
  return {...state, jobs:state.jobs.map(j => {
    const {candidates, media, ...job} = j;
    return {...job, candidates:(candidates || []).map(({url,...c},index) => ({...c,index}))};
  })};
}
