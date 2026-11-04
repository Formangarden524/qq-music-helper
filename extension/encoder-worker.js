import {encodeMP3} from './mp3-encode.js';
self.onmessage = ({data}) => {
  try {
    const parts = encodeMP3(data.channels,data.sampleRate,percent => self.postMessage({type:'progress',percent}));
    self.postMessage({type:'complete',parts},parts.map(p => p.buffer));
  } catch(e) { self.postMessage({type:'error',error:e.message}); }
};
