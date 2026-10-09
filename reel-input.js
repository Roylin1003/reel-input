/* reel-input.js — 不叫鍵盤的英數輸入：拉霸滾筒（wheel）／機場翻牌（flap）
   誕生於 Gem-Drop-Arcade 的高分榜留名。零依賴，一個全域 ReelInput。

   用法：
     const ri = ReelInput.create(el, {
       chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?.-*', // 滾筒上的字元（照順序）
       length: 3,                                  // 幾格
       mode: 'wheel',                              // 'wheel' 拉霸／'flap' 翻牌
       value: 'AAA',                               // 起始值（不在 chars 內的字當第 0 個）
       keyboard: true,                             // 桌機：↑↓/W S 換字、←→/A D/Backspace 換格、Enter/Space 確認、直接打字母
       onChange(value, i) {}, onConfirm(value) {},
       sound: 'auto',                              // 'auto'＝滾筒喀聲／翻牌翻書頁聲（內建合成，免音檔）
                                                   // 也可給函式 (kind, i) => {}，kind＝'tick'（跨格）／'focus'（換格）；null＝無聲
     });
     ri.value            // 目前值（讀「正要停在哪」，不是畫面畫到哪）
     ri.set(i, 'R')      // 程式把第 i 格轉到某字
     ri.focus(i)         // 換格
     ri.destroy()        // 拆掉（會移除 capture 階段的鍵盤監聽）

   設計要點（為什麼這樣寫，改之前先讀）：
   ① 每格一個連續位置 pos（單位＝格），手指拖多少轉多少；放手後慣性用**解析式**
      p(t)=p0+v0/K·(1−e^(−Kt))，位置是牆鐘時間的函式，幀率快慢都算出同一個位置。
      逐幀積分＋dt 截頂在低幀率分頁裡衰減會變慢，滾筒放手後一直飄——實測壞過。
   ② 值一律從 goal（正要停在哪）讀，不從畫面讀：打完最後一個字立刻 Enter，畫面還在吸附。
   ③ 直接打字母走最短邊（A→Z 是退一格，不是繞 25 格），而且從 goal 算起，不從畫面算。
   ④ 鍵盤監聽掛在 capture 階段並 stopImmediatePropagation；但同一目標上 capture／bubble
      的先後各引擎不一致，宿主頁自己的全域 keydown（例如 Space＝開始）**必須自己讓路**
      （見 README）。destroy() 一定要呼叫，不然舊監聽器會搶下一次的鍵。
   ⑤ 翻牌時長跟著當下轉速走（1000／每秒幾格，夾 70~360ms）：撥得快就翻得快。
   ⑥ 翻到一半不重繪、倒平的上片要藏（−90° 在透視下投影成指向觀者的梯形，會溢出框外）。
   ⑦ 聲音內建合成（WebAudio），不帶音檔：滾筒是短促方波「喀」，翻牌是白噪音過帶通掃頻的
      「唰」（翻書頁）。AudioContext 延後到第一次出聲才建（自動播放政策要手勢）。
*/
(function (global) {
  'use strict';
  const K = 4.5, SNAP_MS = 220, V_STOP = 1.2, V_MAX = 40;
  const ease = (u) => 1 - Math.pow(1 - u, 3);

  // ── 內建音效（合成） ──────────────────────────────────────────────
  let actx = null;
  const ctx = () => {
    if (!actx) actx = new (global.AudioContext || global.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  };
  const sounds = {
    volume: 0.4,
    // 滾筒跨格：短促方波，音高隨格數微變，像密碼鎖的齒
    tick(i, k) {
      try {
        const a = ctx(), t = a.currentTime, osc = a.createOscillator(), g = a.createGain();
        osc.type = 'square'; osc.frequency.value = 900 * (1 + ((k || 0) % 5) * 0.03);
        g.gain.setValueAtTime(sounds.volume * 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        osc.connect(g).connect(a.destination); osc.start(t); osc.stop(t + 0.04);
      } catch (_) {}
    },
    // 翻牌：翻書頁——白噪音過帶通，中心頻率 3.2k→900Hz 掃下來（紙從硬到軟的「唰」），120ms 衰減
    paper() {
      try {
        const a = ctx(), t = a.currentTime, dur = 0.12;
        const buf = a.createBuffer(1, Math.ceil(a.sampleRate * 0.12), a.sampleRate);
        const d = buf.getChannelData(0); for (let n = 0; n < d.length; n++) d[n] = Math.random() * 2 - 1;
        const src = a.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.92 + Math.random() * 0.16;
        const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
        bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(900, t + dur);
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(sounds.volume * 0.5, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bp).connect(g).connect(a.destination); src.start(t); src.stop(t + dur + 0.02);
      } catch (_) {}
    },
    focus() {
      try {
        const a = ctx(), t = a.currentTime, osc = a.createOscillator(), g = a.createGain();
        osc.type = 'triangle'; osc.frequency.value = 520;
        g.gain.setValueAtTime(sounds.volume * 0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        osc.connect(g).connect(a.destination); osc.start(t); osc.stop(t + 0.06);
      } catch (_) {}
    },
  };

  function create(root, opts) {
    const o = Object.assign({
      chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?.-*', length: 3, mode: 'wheel', value: '',
      keyboard: true, onChange: null, onConfirm: null, sound: 'auto',
    }, opts || {});
    const CH = o.chars, N = CH.length, L = o.length, flip = o.mode === 'flap';
    const mod = (k) => ((Math.round(k) % N) + N) % N;
    const snd = (kind, i, k) => {
      if (!o.sound) return;
      if (typeof o.sound === 'function') return o.sound(kind, i);
      if (kind === 'tick') (flip ? sounds.paper : sounds.tick)(i, k); else sounds.focus();
    };

    root.classList.add('reelInput'); root.classList.toggle('flap', flip);
    root.innerHTML = Array.from({ length: L }, (_, i) =>
      '<div class="reel" data-i="' + i + '">' + (flip
        ? '<div class="win flip"><b class="half top"><i></i></b><b class="half bot"><i></i></b>' +
          '<b class="half top flapA"><i></i></b><b class="half bot flapB"><i></i></b></div>'
        : '<div class="win"><div class="strip">' + '<b></b>'.repeat(7) + '</div></div>') +
      '</div>').join('');
    const reels = [...root.querySelectorAll('.reel')];

    const pos = [], idx = [], anim = [], timers = [];
    for (let i = 0; i < L; i++) {
      const k = Math.max(0, CH.indexOf((o.value || '')[i] || ''));
      pos.push(k); idx.push(k); timers.push(null);
      anim.push({ i, v0: 0, p0: k, t0: 0, target: null, s0: 0, st0: 0, drag: null, loop: false, lastInt: k, lastT: 0, lastPos: k, vEst: 0 });
    }
    let cur = 0, alive = true;

    // 「正要停在哪」：吸附中＝target；拖著＝手指下的位置；慣性滑行中＝解析式的終點 p0+v0/K
    // ——不用 pos，因為 pos 只在有幀時才前進，幀停了（背景分頁、主執行緒忙）讀到的是舊位置，
    // 幀回來後滾筒還會再走一段，value 就跟畫面對不上。
    const goal = (a) => a.target !== null ? Math.round(a.target) : a.drag ? Math.round(pos[a.i]) : Math.round(a.p0 + a.v0 / K);
    const value = () => anim.map(a => CH[mod(goal(a))]).join('');

    // ── 畫 ──────────────────────────────────────────────────────────
    const renderWheel = (i) => {
      const strip = reels[i].querySelector('.strip');
      const base = Math.floor(pos[i]), frac = pos[i] - base;
      [...strip.children].forEach((b, k) => {
        b.textContent = CH[mod(base + k - 3)];
        // 弧面：離中心 0.83 格以內全亮（鄰居內側三分之一仍滿亮），之後平滑壓到 .12
        const d = Math.abs(k - 3 - frac);
        b.style.opacity = (d <= 0.83 ? 1 : Math.max(0.12, 1 - Math.pow((d - 0.83) / 0.67, 1.3) * 0.88)).toFixed(3);
        b.classList.toggle('sel', d < 0.5);
      });
      const rowH = strip.children[0].offsetHeight;
      strip.style.transform = 'translateY(calc(-50% - ' + (frac * rowH).toFixed(2) + 'px))';
    };
    const paintFlip = (i, dir) => {
      const win = reels[i].querySelector('.win');
      const [top, bot, fa, fb] = [...win.querySelectorAll('.half')].map(h => h.querySelector('i'));
      const nw = CH[idx[i]];
      if (!dir) { if (timers[i] === null) top.textContent = bot.textContent = nw; return; }
      clearTimeout(timers[i]);
      const ms = Math.max(70, Math.min(360, 1000 / Math.max(anim[i].vEst, 0.001)));
      win.style.setProperty('--flipMs', ms + 'ms');
      const old = top.textContent;
      top.textContent = nw; bot.textContent = old;
      fa.textContent = old; fb.textContent = nw;
      const A = fa.parentNode, B = fb.parentNode;
      A.classList.remove('go'); B.classList.remove('go'); void A.offsetWidth;
      A.classList.add('go'); B.classList.add('go');
      timers[i] = setTimeout(() => { bot.textContent = nw; A.classList.remove('go'); timers[i] = null; }, ms / 2);
    };
    const render = (i) => {
      const a = anim[i], k = Math.round(pos[i]);
      const nowT = performance.now();
      if (a.lastT) { const dt = (nowT - a.lastT) / 1000; if (dt > 0) a.vEst = Math.abs(pos[i] - a.lastPos) / dt; }
      a.lastT = nowT; a.lastPos = pos[i];
      const dir = Math.sign(k - a.lastInt);
      if (dir) { a.lastInt = k; snd('tick', i, k); }
      idx[i] = mod(pos[i]);
      if (flip) paintFlip(i, dir); else renderWheel(i);
      if (dir && o.onChange) o.onChange(value(), i);
    };

    // ── 動 ──────────────────────────────────────────────────────────
    const startSnap = (a, now, target) => { a.target = target; a.s0 = pos[a.i]; a.st0 = now; };
    const tick = (i, now) => {
      const a = anim[i];
      if (!alive || a.drag) { a.loop = false; return; }
      if (a.target === null) {
        const t = (now - a.t0) / 1000, decay = Math.exp(-K * t);
        pos[i] = a.p0 + a.v0 / K * (1 - decay);
        if (Math.abs(a.v0 * decay) < V_STOP) startSnap(a, now, Math.round(pos[i]));
      } else {
        const u = Math.min(1, (now - a.st0) / SNAP_MS);
        pos[i] = a.s0 + (a.target - a.s0) * ease(u);
        if (u >= 1) { pos[i] = a.target; render(i); a.loop = false; return; }
      }
      render(i);
      requestAnimationFrame((t) => tick(i, t));
    };
    const kick = (i) => { const a = anim[i]; if (a.loop) return; a.loop = true; requestAnimationFrame((t) => tick(i, t)); };
    const focus = (i) => {
      cur = ((i % L) + L) % L;
      reels.forEach((el, k) => el.classList.toggle('here', k === cur));
    };
    const goTo = (i, target) => { startSnap(anim[i], performance.now(), target); focus(i); kick(i); };
    const nudge = (i, d) => goTo(i, goal(anim[i]) + d);
    const setChar = (i, ch) => {
      const k = CH.indexOf(ch); if (k < 0) return;
      const base = goal(anim[i]);
      let d = k - mod(base); if (d > N / 2) d -= N; if (d < -N / 2) d += N;
      goTo(i, base + d);
    };

    // ── 撥 ──────────────────────────────────────────────────────────
    reels.forEach((el, i) => {
      const win = el.querySelector('.win');
      render(i);
      win.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { win.setPointerCapture(e.pointerId); } catch (_) {}
        const a = anim[i]; a.target = null;
        a.drag = { y: e.clientY, pos: pos[i], moved: false, samples: [[performance.now(), pos[i]]] };
        focus(i); snd('focus', i);
      });
      win.addEventListener('pointermove', (e) => {
        const a = anim[i]; if (!a.drag) return;
        // 螢幕座標可能被外層 transform:scale 縮過，拖移距離要除回比例才是版面 px
        const scale = win.getBoundingClientRect().height / win.offsetHeight || 1;
        const dy = (e.clientY - a.drag.y) / scale;
        const rows = dy / (win.offsetHeight / (flip ? 1 : 3));
        if (Math.abs(dy) > 3) a.drag.moved = true;
        pos[i] = a.drag.pos - rows;
        a.drag.samples.push([performance.now(), pos[i]]);
        if (a.drag.samples.length > 6) a.drag.samples.shift();
        render(i);
      });
      const release = () => {
        const a = anim[i]; if (!a.drag) return;
        const s = a.drag.samples, [t0, p0] = s[0], [t1, p1] = s[s.length - 1];
        const v = t1 > t0 ? (p1 - p0) / ((t1 - t0) / 1000) : 0;
        const moved = a.drag.moved; a.drag = null;
        const now = performance.now();
        a.p0 = pos[i]; a.t0 = now; a.target = null;
        a.v0 = Math.max(-V_MAX, Math.min(V_MAX, v));
        if (!moved) { a.v0 = 0; startSnap(a, now, Math.round(pos[i])); }
        kick(i);
      };
      ['pointerup', 'pointercancel'].forEach(ev => win.addEventListener(ev, release));
      // 滾輪累積滿 100（一格滑鼠滾輪）才走一格：觸控板一次滑動送幾十個小事件，逐個走會亂跳、翻牌疊在半路；deltaY 0（橫滑）不算
      let acc = 0; win.addEventListener('wheel', (e) => { e.preventDefault(); acc += e.deltaMode ? e.deltaY * 40 : e.deltaY;
        while (Math.abs(acc) >= 100) { nudge(i, acc > 0 ? 1 : -1); acc -= Math.sign(acc) * 100; } }, { passive: false });
    });
    focus(0);

    // ── 鍵盤 ────────────────────────────────────────────────────────
    const onKey = (e) => {
      if (!alive) return;
      let handled = true;
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': nudge(cur, 1); break;
        case 'ArrowDown': case 'KeyS': nudge(cur, -1); break;
        case 'ArrowLeft': case 'KeyA': case 'Backspace': focus(cur - 1); snd('focus', cur); break;
        case 'ArrowRight': case 'KeyD': focus(cur + 1); snd('focus', cur); break;
        case 'Enter': case 'Space': if (o.onConfirm) o.onConfirm(value()); break;
        default: {
          const ch = (e.key || '').toUpperCase();
          if (ch.length !== 1 || CH.indexOf(ch) < 0) { handled = false; break; }
          setChar(cur, ch);
          if (cur < L - 1) focus(cur + 1);
        }
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    if (o.keyboard) window.addEventListener('keydown', onKey, true);

    return {
      el: root,
      get value() { return value(); },
      set(i, ch) { setChar(i, ch); },
      focus,
      destroy() {
        alive = false;
        if (o.keyboard) window.removeEventListener('keydown', onKey, true);
        timers.forEach(clearTimeout);
        root.innerHTML = ''; root.classList.remove('reelInput', 'flap');
      },
    };
  }
  global.ReelInput = { create, sounds };
})(typeof window !== 'undefined' ? window : globalThis);
