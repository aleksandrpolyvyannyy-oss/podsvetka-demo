/* podsvetkadoma.ru - новогодняя подсветка. Чистый JS, без библиотек.
   Слушатель scroll один, пассивный: он только будит цикл сцены. */
(function () {
  'use strict';

  // Цены и объёмы для примера расчёта на первом экране.
  // wipe: ось ('x' слева направо, 'y' снизу вверх) и ход края маски в долях кадра 4:3
  var STEPS = [
    { title: 'Контур кровли', garland: 'Нить по скатам и карнизам', price: 'от 1 000 руб./м', qty: '70 м', sum: 70000, wipe: ['x', 0.19, 0.80] },
    { title: 'Бахрома по карнизам', garland: 'Свисающие нити разной длины', price: 'от 1 800 руб./м', qty: '38 м', sum: 68400, wipe: ['x', 0.19, 0.86] },
    { title: 'Терраса и балкон', garland: 'Белт-лайт по краю кровли, обмотка столбов и перил', price: 'от 1 500 руб./м', qty: '46 м', sum: 69000, wipe: ['x', 0.50, 0.86] },
    { title: 'Ёлка на участке', garland: 'Нить по всей высоте', price: 'от 25 000 руб. за дерево', qty: 'ель 4,5 м', sum: 25000, wipe: ['y', 0.84, 0.38] },
    { title: 'Деревья', garland: 'Обмотка стволов и толстых веток', price: 'от 9 000 руб. за дерево', qty: '2 берёзы', sum: 18000, wipe: ['y', 0.80, 0.22] }
  ];

  /* --- Цели уходят в Метрику. На демо-странице счётчика нет, там вызов просто ничего не делает --- */
  var METRIKA_ID = 113599324;
  function goal(name) {
    if (typeof window.ym === 'function') window.ym(METRIKA_ID, 'reachGoal', name);
  }
  var fired = {};
  function goalOnce(name) {
    if (!fired[name]) { fired[name] = 1; goal(name); }
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+$)/g, ' '); }
  function idle(fn) {
    if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 200);
  }
  function onLoad(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn, { once: true });
  }

  // Камера, ролик и мерцание работают всегда, системная настройка «меньше движения» на них не влияет.
  // Выключатель для отладки: ?motion=off в адресе
  var reduce = /[?&]motion=off/.test(location.search);
  if (reduce) document.documentElement.classList.add('rm');
  var saveData = !!(navigator.connection && navigator.connection.saveData);

  /* === Сцена === */
  var scene = $('#scene');
  if (scene && 'IntersectionObserver' in window) initScene();

  function initScene() {
    var N = STEPS.length;
    // Камера по состояниям, см. .scene[data-cam]
    var CAM = { hero: 'full', 4: 'tree', 5: 'birch', final: 'full' };   // остальные - 'house'
    var REVEAL = 0.72;    // доля шага на проявление, дальше кадр стоит открытым
    var FEATHER = 0.09;   // растушёвка, доля ширины кадра
    var FADE = 750;       // мс, чуть дольше opacity у .frame
    // Сглаживание: доля пути до цели за кадр 60 Гц, на таче быстрее
    var EASE = matchMedia('(pointer: coarse)').matches ? 0.18 : 0.14;

    var frames = $$('.frame', scene);
    var marks = $$('.scene__track i', scene);
    var view = $('.scene__view', scene);
    var video = $('.scene__video', scene);
    // Общий фон .backdrop: тот же кадр f5 с той же геометрией. В финале сцена становится прозрачной (.is-thru),
    // и при уходе сцены вверх дом остаётся на месте
    var back = $('#backdrop'), backImg = back && $('img', back), backOk = false, isThru = false, overlay = false;
    var bulbs = $$('.scene__bulbs li', scene);
    var state = 'hero';
    var introDone = reduce;      // пока false, в hero дом тёмный
    var ready = [];              // кадр декодирован
    var asked = [];
    var stopVideo = null;

    // Кадры 1..N: cur - открытая доля, seg - отрезок прокрутки, geo - ход края
    var cur = [], seg = [], geo = [], isOn = [], isWipe = [], edge = [], offAt = [], shown = [], sums = [0];
    var inView = true, dirty = true, snapNext = true, stale = true, raf = 0, last = 0, lastY = 0, holdUntil = 0;

    // Карточки шагов из массива
    $('#scards').innerHTML = STEPS.map(function (s, i) {
      sums[i + 1] = sums[i] + s.sum;
      cur[i + 1] = 0;
      frames[i + 1].dataset.wipe = s.wipe[0];
      return '<article class="scard" data-step="' + (i + 1) + '">' +
        '<p class="scard__n">Шаг ' + (i + 1) + ' из ' + N + '</p>' +
        '<p class="scard__sum"><span>Этот дом</span><b></b> <i>руб.</i></p>' +
        '<h3 class="scard__t">' + s.title + '</h3>' +
        '<p class="scard__d">' + s.garland + '</p>' +
        '<dl class="scard__dl">' +
        '<div><dt>Цена</dt><dd>' + s.price.replace('/', '\u2060/\u2060') + '</dd></div>' +
        '<div><dt>На этом доме</dt><dd>' + s.qty + '</dd></div>' +
        '<div><dt>Этот шаг</dt><dd>+ ' + money(s.sum) + ' руб.</dd></div>' +
        '</dl>' +
        '</article>';
    }).join('');
    var cards = $$('#scards .scard');
    var sumEl = [0].concat($$('#scards .scard__sum b'));
    $$('[data-total]', scene).forEach(function (el) { el.textContent = money(sums[N]); });

    // Итог растёт с проявлением. Текст меняем, когда изменилось число
    function setCur(k, c) {
      cur[k] = c;
      var v = c === 1 ? sums[k] : Math.round((sums[k - 1] + STEPS[k - 1].sum * c) / 100) * 100;
      if (v !== shown[k]) { shown[k] = v; sumEl[k].textContent = money(v); }
    }
    for (var i = 1; i <= N; i++) setCur(i, i === N ? 1 : 0);

    // Геометрия: при старте и после resize. В цикле layout не читаем
    function measure() {
      stale = false;
      overlay = matchMedia('(orientation: landscape) and (min-width: 640px) and (min-height: 521px)').matches;
      var vh = window.innerHeight;
      var top = scene.getBoundingClientRect().top + window.scrollY;
      var W = view.clientWidth, H = view.clientHeight;
      // как у .frame: object-fit: cover; object-position: 50% 56%
      var dw = Math.max(W, H * 4 / 3), dh = dw * 3 / 4;
      var ox = (W - dw) / 2, oy = (H - dh) * 0.56;
      var f = FEATHER * dw;
      STEPS.forEach(function (s, i) {
        var k = i + 1, el = marks[k + 1], x = s.wipe[0] === 'x';
        var size = x ? W : H;
        var a = x ? ox + s.wipe[1] * dw : H - oy - s.wipe[1] * dh;
        var b = x ? ox + s.wipe[2] * dw : H - oy - s.wipe[2] * dh;
        seg[k] = { y0: top + el.offsetTop - vh / 2, len: el.offsetHeight * REVEAL };
        geo[k] = { a: a / size * 100, b: (b + f) / size * 100, end: 100 + f / size * 100 };
        frames[k].style.setProperty('--f', (f / size * 100).toFixed(2) + '%');
        edge[k] = '';
      });
    }

    // Край маски, %. 84% хода - зона света, остаток кадра край проходит быстро
    function edgeAt(g, c) {
      if (c < 0.08) return g.a * c / 0.08;
      if (c < 0.92) return g.a + (g.b - g.a) * (c - 0.08) / 0.84;
      return g.b + (g.end - g.b) * (c - 0.92) / 0.08;
    }

    // Цели из прокрутки, сглаживание, запись в DOM. true - движение не кончилось
    function render(now, dt) {
      var snap = snapNext || !inView;
      var hero = state === 'hero';
      var lit = +state || (state === 'dark' ? 0 : N);
      var k, t, c, on, wipe, e, busy = false;
      var gain = snap ? 1 : 1 - Math.pow(1 - EASE, dt / 16.67);
      snapNext = false;
      if (snap) holdUntil = 0;
      if (holdUntil && now >= holdUntil) { holdUntil = 0; setCur(N, 0); }
      var held = holdUntil > 0;   // f5 гаснет после hero прозрачностью

      for (k = 1; k <= N; k++) {
        if (held && k === N) { busy = true; continue; }
        if (hero) t = k === N ? 1 : 0;
        else { t = (lastY - seg[k].y0) / seg[k].len; t = t < 0 ? 0 : t > 1 ? 1 : t; }
        if (t > 0 && !asked[k]) load(k);
        c = cur[k];
        if (c !== t) {
          c += (t - c) * gain;
          if (Math.abs(t - c) < 0.002) c = t; else busy = true;
          setCur(k, c);
        }
      }

      // Видны проявляемые кадры и открытый под ними, в покое ещё один ниже
      var full = 0, top = 0;
      for (k = N; k > 0; k--) {
        if (!ready[k] || (held && k === N)) continue;
        if (!top && cur[k] > 0) top = k;
        if (cur[k] === 1) { full = k; break; }
      }
      var low = Math.min(full, top - 1);
      for (k = 1; k <= N; k++) {
        c = cur[k];
        on = !!ready[k] && c > 0 && k >= low;
        if (k === N && held) on = false;
        else if (k === N && hero && !reduce) on = introDone && !!ready[k];
        if (on !== !!isOn[k]) {
          isOn[k] = on;
          if (!on) offAt[k] = now;
          frames[k].classList.toggle('is-on', on);
        }
        // Маска держится и пока кадр гаснет
        wipe = c < 1 && (on || now - offAt[k] < FADE);
        if (wipe) {
          if (!on) busy = true;
          e = edgeAt(geo[k], c).toFixed(2);
          if (e !== edge[k]) { edge[k] = e; frames[k].style.setProperty('--e', e + '%'); }
        }
        if (wipe !== !!isWipe[k]) { isWipe[k] = wipe; frames[k].classList.toggle('is-wipe', wipe); }
      }
      // Финал: последний кадр открыт целиком, под сценой лежит такой же - показываем его
      on = state === 'final' && backOk && overlay && cur[N] === 1;
      if (on !== isThru) { isThru = on; scene.classList.toggle('is-thru', on); }
      return busy;
    }

    function tick(now) {
      raf = 0;
      var dt = last ? Math.min(now - last, 100) : 16.67;
      last = now;
      if (stale) measure();
      if (dirty) { dirty = false; lastY = window.scrollY; }
      if (render(now, dt) || dirty) raf = requestAnimationFrame(tick);
      else last = 0;
    }
    function kick() {
      if (inView && !raf) raf = requestAnimationFrame(tick);
    }
    function paint() {
      if (stale) measure();
      lastY = window.scrollY;
      render(performance.now(), 0);
      kick();
    }

    // Слушатель scroll только будит цикл
    window.addEventListener('scroll', function () { dirty = true; kick(); }, { passive: true });
    window.addEventListener('resize', function () { stale = dirty = true; kick(); });
    // Цикл идёт, пока сцена на экране
    new IntersectionObserver(function (entries) {
      inView = entries[entries.length - 1].isIntersecting;
      if (inView) { snapNext = dirty = true; kick(); }
    }).observe(scene);

    // Кадр: srcset, затем decode()
    function load(k, done) {
      if (asked[k]) return;
      asked[k] = 1;
      var img = frames[k];
      $$('source', img.parentNode).forEach(function (s) {
        if (s.dataset.srcset) s.srcset = s.dataset.srcset;
      });
      if (img.dataset.srcset) img.srcset = img.dataset.srcset;
      var ok = function () { ready[k] = true; paint(); if (done) done(); };
      img.decode().then(ok, function () { if (img.naturalWidth) ok(); else if (done) done(); });
    }

    function setState(name) {
      if (name === state) return;
      var was = state;
      var step = +name || (name === 'final' ? N : 0);
      state = name;
      scene.dataset.state = name;
      scene.dataset.cam = CAM[name] || 'house';
      if (back) back.dataset.cam = scene.dataset.cam;   // фон повторяет камеру, чтобы подмена в финале была незаметной
      scene.style.removeProperty('--fade');
      if (name !== 'hero') {
        introDone = true;
        if (stopVideo) stopVideo();
      }
      {
        // hero и dark меняются прозрачностью, без маски
        if (name === 'hero') { holdUntil = 0; if (!isOn[N]) setCur(N, 1); }
        else if (was === 'hero') { if (isOn[N]) holdUntil = performance.now() + FADE; else setCur(N, 0); }
      }
      cards.forEach(function (c, i) { c.classList.toggle('is-on', i + 1 === +name); });
      bulbs.forEach(function (b, i) { b.classList.toggle('is-on', i < step); });
      if (name === 'final') goalOnce('scene_final');
      else if (step) goalOnce('scene_step_' + step);
      paint();
    }

    // Сторожа: активен тот, кто на середине экрана
    var onLine = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        onLine[e.target.dataset.state] = e.isIntersecting;
        if (e.isIntersecting) setState(e.target.dataset.state);
      });
      // Перепрыгнули сцену по якорю: дом уже собран
      var any = Object.keys(onLine).some(function (k) { return onLine[k]; });
      if (!any && scene.getBoundingClientRect().bottom < window.innerHeight / 2) setState('final');
    }, { rootMargin: '-50% 0px -50% 0px' });
    marks.forEach(function (el) { io.observe(el); });

    // Первый экран: дом загорается сам
    function reveal() {
      if (introDone) return;
      setTimeout(function () {
        if (introDone) return;
        scene.style.setProperty('--fade', '2.3s');
        introDone = true;
        paint();
        setTimeout(function () { scene.style.removeProperty('--fade'); }, 2500);
      }, 400);
    }

    function playVideo() {
      var settled = false;
      var timer = setTimeout(fail, 3000);
      function kill() {
        video.classList.remove('is-on');
        try { video.pause(); } catch (e) {}
        video.removeAttribute('src');
        video.load();
      }
      function fail() {
        if (settled) return;
        settled = true; clearTimeout(timer); stopVideo = null;
        kill(); reveal();
      }
      stopVideo = function () {
        settled = true; clearTimeout(timer); stopVideo = null;
        kill();
      };
      video.addEventListener('error', fail);
      video.addEventListener('playing', function () {
        if (settled) return;
        settled = true; clearTimeout(timer);
        video.classList.add('is-on');
      });
      video.addEventListener('ended', function () {
        if (!stopVideo) return;
        stopVideo = null;
        // Под роликом включаем f5, затем убираем ролик
        scene.style.setProperty('--fade', '0s');
        introDone = true;
        paint();
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            scene.style.removeProperty('--fade');
            video.classList.remove('is-on');
            setTimeout(function () { video.removeAttribute('src'); video.load(); }, 700);
          });
        });
      });
      video.muted = true;
      video.src = video.dataset.src;
      var p = video.play();
      if (p && p.catch) p.catch(fail);
    }

    var wantVideo = video && !reduce && !saveData &&
      matchMedia('(orientation: landscape) and (min-width: 1024px) and (min-height: 521px)').matches;

    var pending = 2;
    function firstReady() {
      if (--pending || introDone) return;
      if (wantVideo) onLoad(function () { if (!introDone && state === 'hero') playVideo(); });
      else reveal();
    }
    load(0, firstReady);
    load(N, firstReady);

    // f1-f4: после load, в простое, по одному
    onLoad(function () {
      if (backImg && backImg.decode) backImg.decode().then(function () { backOk = true; paint(); }, function () {});
      var queue = [1, 2, 3, 4];
      function next() {
        var k = queue.shift();
        if (k === undefined) return;
        if (asked[k]) return next();
        idle(function () { load(k, next); });
      }
      setTimeout(next, 1200);
    });
  }

  /* === Появление блоков при прокрутке: только opacity и transform === */
  var rv = $$('.rv');
  if (rv.length && 'IntersectionObserver' in window && !reduce) {
    document.documentElement.classList.add('rv-on');
    var rvIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        rvIo.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    rv.forEach(function (el) { rvIo.observe(el); });
  } else {
    rv.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* === До и после: шторка. Тач, мышь и клавиатуру даёт сам input[type=range], здесь только его значение в --pos === */
  $$('.ba__range').forEach(function (range) {
    var view = range.parentNode;
    function sync() {
      var v = +range.value;
      view.style.setProperty('--pos', v + '%');
      range.setAttribute('aria-valuetext', 'Вечерний кадр открыт на ' + Math.round(100 - v) + '%');
    }
    range.addEventListener('input', sync);
    sync();
  });

  /* === Общий фон: мерцание лампочек === */
  var backdrop = $('#backdrop');
  if (backdrop && scene && !reduce && 'IntersectionObserver' in window) {
    // Слои мерцания грузим один раз. На телефоне слоёв два, файлы меньше
    var twAsked = false;
    var loadTw = function () {
      if (twAsked) return;
      twAsked = true;
      var big = matchMedia('(min-width: 900px)').matches;
      $$('.tw', backdrop).forEach(function (img) {
        var src = big ? img.dataset.wide : img.dataset.src;
        if (src) img.src = src;
      });
    };
    // Заранее: когда до блоков под сценой остаётся полтора экрана
    var twIo = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      twIo.disconnect();
      loadTw();
    }, { rootMargin: '0px 0px 150% 0px' });
    twIo.observe($('.scene__track i:last-child', scene));
    // Мерцание идёт, только пока блоки под сценой на экране: низ сцены выше низа экрана.
    // Здесь же грузим слои, если сцену перепрыгнули по якорю
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      var live = !e.isIntersecting && e.boundingClientRect.top < 0;
      if (live) loadTw();
      backdrop.classList.toggle('is-live', live);
    }, { rootMargin: '-99% 0px 0px 0px' }).observe(scene);
  }

  /* === Шапка и нижняя панель === */
  var head = $('#head');
  if (head && scene && 'IntersectionObserver' in window) {
    // Шапка прозрачная, пока сцена во весь экран
    new IntersectionObserver(function (entries) {
      head.classList.toggle('is-solid', !entries[0].isIntersecting);
    }, { rootMargin: '-98% 0px 0px 0px' }).observe(scene);
  } else if (head) {
    head.classList.add('is-solid');
  }

  var bar = $('#bar');
  if (bar && 'IntersectionObserver' in window) {
    // Панель уезжает, пока на экране квиз или форма
    var inView = {};
    var barIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { inView[e.target.id] = e.isIntersecting; });
      bar.classList.toggle('is-away', Object.keys(inView).some(function (id) { return inView[id]; }));
    }, { threshold: 0.15 });
    $$('#quiz-form, #lead-form').forEach(function (el) { barIo.observe(el); });
  }

  /* === Клики: цели, окно обратного звонка === */
  var dlg = $('#callback');
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a, button');
    if (!a) return;
    if (a.dataset.goal) goal(a.dataset.goal);
    if (a.tagName === 'A') {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('tel:') === 0) goal('click_phone');
      if (href === '#') e.preventDefault();
    }
    if (a.hasAttribute('data-callback') && dlg) {
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      goal('callback_open');
    }
    if (a.hasAttribute('data-close') && dlg) dlg.close();
  });
  if (dlg) {
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  }

  /* === Телефон: маска и проверка === */
  function phoneDigits(v) {
    var d = v.replace(/\D/g, '');
    if (d.charAt(0) === '8') d = '7' + d.slice(1);
    if (d && d.charAt(0) !== '7') d = '7' + d;
    return d.slice(0, 11);
  }
  function phoneMask(d) {
    if (!d) return '';
    var out = '+7';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 4) out += ')';
    if (d.length > 4) out += ' ' + d.slice(4, 7);
    if (d.length > 7) out += '-' + d.slice(7, 9);
    if (d.length > 9) out += '-' + d.slice(9, 11);
    return out;
  }
  function setErr(form, name, msg) {
    var box = $('[data-err="' + name + '"]', form);
    var input = form.elements[name];
    if (box) box.textContent = msg;
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    return !msg;
  }

  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'yclid'];
  var query = new URLSearchParams(location.search);

  // Заявки принимает lead.php на своём сервере. На демо-странице сервера нет: там форма только показывает результат.
  var LEAD_URL = /github\.io$/.test(location.hostname) ? '' : 'lead.php';

  $$('form[data-lead]').forEach(function (form) {
    // Метки рекламы
    UTM.forEach(function (key) {
      var h = document.createElement('input');
      h.type = 'hidden'; h.name = key; h.value = query.get(key) || '';
      form.appendChild(h);
    });
    // Поле-ловушка для роботов: человек его не видит и не заполняет
    var trap = document.createElement('input');
    trap.type = 'text'; trap.name = 'website'; trap.tabIndex = -1; trap.autocomplete = 'off';
    trap.setAttribute('aria-hidden', 'true');
    trap.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    form.appendChild(trap);

    var tel = form.elements.phone;
    tel.addEventListener('input', function (e) {
      if (e.inputType && e.inputType.indexOf('delete') === 0) return;
      tel.value = phoneMask(phoneDigits(tel.value));
    });
    tel.addEventListener('focus', function () { if (!tel.value) tel.value = '+7 ('; });
    tel.addEventListener('blur', function () { if (phoneDigits(tel.value).length < 2) tel.value = ''; });
    form.addEventListener('input', function (e) {
      if (e.target.name === 'phone') setErr(form, 'phone', '');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.notReady && form.notReady()) return;
      var okPhone = setErr(form, 'phone', phoneDigits(tel.value).length === 11 ? '' : 'Введите номер полностью: 10 цифр после +7');
      if (!okPhone) { tel.focus(); return; }
      if (form.busy) return;

      function sent() {
        form.classList.add('is-sent');
        var done = $('.done', form);
        done.hidden = false;
        done.focus({ preventScroll: true });
        goal(form.dataset.goal);
      }
      if (!LEAD_URL) { sent(); return; }

      var data = new FormData(form);
      data.append('form', form.dataset.lead);
      // Несколько отмеченных зон - одной строкой
      var zones = data.getAll('zones');
      if (zones.length) data.set('zones', zones.join(', '));
      var btn = $('[type="submit"]', form);
      form.busy = true;
      if (btn) btn.disabled = true;
      fetch(LEAD_URL, { method: 'POST', body: data, headers: { 'X-Lead': '1' } })
        .then(function (r) { return r.json(); })
        .then(function (res) { if (!res || !res.ok) throw new Error('lead'); sent(); })
        .catch(function () {
          setErr(form, 'phone', 'Не получилось отправить. Позвоните нам: +7 (967) 164-97-97');
        })
        .then(function () { form.busy = false; if (btn) btn.disabled = false; });
    });
  });

  /* === Квиз === */
  var quiz = $('#quiz-form');
  if (quiz) {
    var qSteps = $$('.quiz__step', quiz);
    var qCount = $('.quiz__count', quiz);
    var qBulbs = $$('.quiz__bulbs li', quiz);
    var qPrev = $('[data-prev]', quiz);
    var qNext = $('[data-next]', quiz);
    var total = qBulbs.length;   // вопросов с номером
    var at = 0;
    var pointerAt = 0;

    var filled = function (i) {
      return qSteps[i].hasAttribute('data-optional') || !!$('.opts input:checked', qSteps[i]);
    };
    var show = function (i, focus) {
      at = i;
      var last = i === qSteps.length - 1;
      qSteps.forEach(function (s, j) { s.classList.toggle('is-on', j === i); });
      qBulbs.forEach(function (b, j) { b.classList.toggle('is-on', j < i); });
      qCount.textContent = i < total ? 'Шаг ' + (i + 1) + ' из ' + total : qSteps[i].dataset.label;
      qPrev.hidden = i === 0;
      qNext.hidden = last;
      qNext.disabled = !filled(i);
      if (focus) $('legend', qSteps[i]).focus({ preventScroll: true });
    };
    var move = function (d) {
      if (d > 0) {
        if (at >= qSteps.length - 1 || !filled(at)) return;
        if (at < total) goalOnce('quiz_step_' + (at + 1));
      } else if (at === 0) return;
      show(at + d, true);
    };

    quiz.notReady = function () {
      if (at < qSteps.length - 1) { move(1); return true; }
      return false;
    };
    qPrev.addEventListener('click', function () { move(-1); });
    qNext.addEventListener('click', function () { move(1); });
    quiz.addEventListener('pointerdown', function () { pointerAt = Date.now(); });
    quiz.addEventListener('change', function (e) {
      goalOnce('quiz_start');
      qNext.disabled = !filled(at);
      // Выбор мышью или пальцем ведёт дальше сам, с клавиатуры - по кнопке
      var step = e.target.closest('.quiz__step');
      if (e.target.type === 'radio' && step && step.hasAttribute('data-auto') && Date.now() - pointerAt < 800) {
        var from = at;
        setTimeout(function () { if (at === from) move(1); }, 260);
      }
    });
    show(0, false);
  }
})();
