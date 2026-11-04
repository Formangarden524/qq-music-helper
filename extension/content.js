(() => {
  let active = false, clicked = false, interval, targetTitle = '';
  const send = message => chrome.runtime.sendMessage(message).then(r => r?.ok ? r.result : undefined).catch(() => {});
  function report() {
    const meta = readQQMetadata(document);
    const media = Array.from(document.querySelectorAll('audio')).map(a => ({url:a.currentSrc || a.src,seconds:Number.isFinite(a.duration) ? a.duration : 0})).filter(a => a.url);
    const isPlayer = /\/player\/?$/.test(location.pathname);
    send({type:'META',meta,media,isPlayer});
    if (clicked || !meta.title || document.readyState !== 'complete') return;
    if (isPlayer) {
      // Only start the expected song; never blindly play a pre-existing queue item.
      if (!targetTitle || meta.title !== targetTitle) return;
      const play = document.querySelector('.btn_big_play');
      if (play && /播放/.test(play.textContent || '')) { clicked = true; play.click(); }
      return;
    }
    // Only the song detail's actual play button, never "download client" or VIP controls.
    const button = document.querySelector('.data__actions .mod_btn_green') || document.querySelector('.js_all_play');
    if (button && /播放|play/i.test(button.textContent || button.getAttribute('title') || '')) {
      clicked = true;
      button.click();
      send({type:'PLAY_ATTEMPTED'});
    }
  }
  async function begin() {
    if (active) return;
    const result = await send({type:'REGISTER'});
    if (!result?.active) return;
    targetTitle = result.title || '';
    active = true;
    report();
    interval = setInterval(report, 2000);
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'ACTIVATE') begin();
    if (message.type === 'STOP') { clearInterval(interval); active = false; }
  });
  begin();
})();
