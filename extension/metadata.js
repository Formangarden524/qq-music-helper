/* Pure DOM metadata reader, shared by the content script and fixture tests. */
(function (root) {
  root.readQQMetadata = function (doc) {
    const txt = selector => doc.querySelector(selector)?.textContent?.trim() || '';
    let title = txt('.data__name_txt') || txt('.song_info__name a');
    const singers = doc.querySelectorAll('.data__singer_txt').length ? doc.querySelectorAll('.data__singer_txt') : doc.querySelectorAll('.song_info__singer a');
    let artist = Array.from(singers).map(n => n.textContent.trim()).filter(Boolean).join('、');
    const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || '';
    const parts = og.replace(/\s*-\s*QQ音乐[\s\S]*$/, '').split(' - ');
    if (!title && parts.length > 1) title = parts[0].trim();
    if (!artist && parts.length > 1) artist = parts.slice(1).join(' - ').trim();
    let expectedSeconds = 0;
    for (const script of doc.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (text.length < 2_000_000 && text.includes('window.__INITIAL_DATA__')) {
        expectedSeconds = Number(text.match(/"interval"\s*:\s*(\d+)/)?.[1] || 0);
        break;
      }
    }
    return {title:title.slice(0,200), artist:artist.slice(0,200), expectedSeconds};
  };
})(globalThis);
