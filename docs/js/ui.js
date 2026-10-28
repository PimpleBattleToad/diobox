/* Логика страницы: картинка, размеры, генерация выкройки и файлов. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    w: $("w"), d: $("d"), h: $("h"),
    fit: $("fit"), tab: $("tab"), bleed: $("bleed"), margin: $("margin"),
    dpi: $("dpi"), paper: $("paper"), layout: $("layout"), fill: $("fill"),
    ceiling: $("ceiling"), labels: $("labels"), marks: $("marks"), blank: $("blank"),
    info: $("info"), go: $("go"), drop: $("drop"), stage: $("stage"), shot: $("shot"),
    prev: $("prev"), crop: $("crop"), file: $("file"),
    result: $("result"), assembled: $("assembled"), prevFig: $("prevFig"),
    sheetImg: $("sheetImg"), sheetCap: $("sheetCap"),
    dlPng: $("dlPng"), dlPdf: $("dlPdf"), pngMeta: $("pngMeta"),
    pdfMeta: $("pdfMeta"), report: $("report"), stale: $("stale"),
    busy: $("busy"), busyText: $("busyText")
  };

  var state = { img: null, name: "", focus: [0.5, 0.5], sig: null, urls: [] };
  var FIELDS = ["w", "d", "h", "fit", "tab", "bleed", "margin", "dpi",
                "paper", "layout", "fill"];

  function num(id) { var v = parseFloat(els[id].value); return isFinite(v) ? v : 0; }

  function params() {
    return {
      w: Math.max(20, num("w")), d: Math.max(20, num("d")), h: Math.max(20, num("h")),
      fit: Math.max(0, num("fit")), tab: Math.max(0, num("tab")),
      bleed: Math.max(0, num("bleed")), margin: Math.max(4, num("margin")),
      dpi: parseInt(els.dpi.value, 10) || 300,
      paper: els.paper.value, layout: els.layout.value, fill: els.fill.value,
      ceiling: els.ceiling.checked, labels: els.labels.checked,
      marks: els.marks.checked, blank: els.blank.checked
    };
  }

  /* Сетка вкладыша и итоговая раскладка листа. */
  function build(p) {
    var nw = Math.max(10, p.w - 2 * p.fit);
    var nd = Math.max(10, p.d - 2 * p.fit);
    var nh = Math.max(20, p.h - 2);
    var layout = p.layout === "auto"
      ? Geom.pickLayout(nw, nd, nh, p.tab, p.ceiling) : p.layout;
    var net = new Geom.Net({ W: nw, D: nd, H: nh, T: p.tab, C: p.ceiling, layout: layout });
    return net;
  }

  function sheetSize(net, p) {
    var b = net.bbox();
    return [(b[2] - b[0]) + 2 * p.margin,
            (b[3] - b[1]) + 2 * p.margin + (p.marks ? 18 : 0)];
  }

  function fmt(n) { return (Math.round(n * 10) / 10).toString().replace(".0", ""); }

  function updateInfo() {
    var p = params();
    var net = build(p);
    var s = sheetSize(net, p);
    var ch = PDFOut.choosePaper(s[0], s[1], 10, p.paper === "none" ? "none" : p.paper);
    var px = Math.round(s[0] * p.dpi / 25.4) + " × " + Math.round(s[1] * p.dpi / 25.4);
    var html = "вкладыш <b>" + fmt(net.W) + " × " + fmt(net.D) + "</b> мм, стенки " +
      fmt(net.H) + " мм · лист <b>" + fmt(s[0]) + " × " + fmt(s[1]) + "</b> мм";
    var extra = "";
    if (p.paper === "none") {
      extra = "без полей · " + px + " px";
    } else {
      var paperName = ch[0].toUpperCase();
      html += " · " + paperName + " " + fmt(ch[1]) + " × " + fmt(ch[2]);
      if (!ch[3] && p.paper === "auto") {
        html += " — на несколько листов";
        var alt = altPaper(s[0], s[1]);
        if (alt) {
          extra += 'взять <a class="alt" data-paper="' + alt + '">' +
            alt.toUpperCase() + " — влезет одним листом</a> · ";
        }
      } else {
        html += " — 1 лист";
      }
      extra += px + " px";
    }
    if (p.layout === "auto") {
      extra += " · " + (net.layout === "back" ? "боковины на заднике" : "боковины на полу");
    }
    els.info.innerHTML = html + (extra ? "<span class=\"info2\">" + extra + "</span>" : "");
    var link = els.info.querySelector("a.alt");
    if (link) {
      link.addEventListener("click", function () {
        els.paper.value = link.getAttribute("data-paper");
        saveState(); updateInfo(); markStale();
      });
    }
  }

  /* Самый маленький формат, в который лист влезает без запаса на поля. */
  function altPaper(w, h) {
    var order = ["a3", "a2", "a1"];
    for (var i = 0; i < order.length; i++) {
      var p = PDFOut.PAPERS[order[i]];
      if ((w <= p[0] && h <= p[1]) || (w <= p[1] && h <= p[0])) return order[i];
    }
    return null;
  }

  function markStale() {
    if (!els.result.hidden && state.sig) els.stale.hidden = false;
  }

  function saveState() {
    var o = {};
    FIELDS.forEach(function (k) { o[k] = els[k].value; });
    o.ceiling = els.ceiling.checked;
    o.labels = els.labels.checked;
    o.marks = els.marks.checked;
    o.blank = els.blank.checked;
    o.focus = state.focus;
    try { localStorage.setItem("diobox.v2", JSON.stringify(o)); } catch (e) {}
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem("diobox.v2"); } catch (e) {}
    if (!raw) return;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return; }
    FIELDS.forEach(function (k) { if (o[k] != null) els[k].value = o[k]; });
    if (o.ceiling != null) els.ceiling.checked = !!o.ceiling;
    if (o.labels != null) els.labels.checked = !!o.labels;
    if (o.marks != null) els.marks.checked = !!o.marks;
    if (o.blank != null) els.blank.checked = !!o.blank;
    if (o.focus && o.focus.length === 2) state.focus = o.focus;
  }

  /* --- картинка и рамка кадрирования ------------------------------------ */

  function setImage(img, name) {
    state.img = img;
    state.name = name || "картинка";
    els.prev.src = img.src;
    els.drop.hidden = true;
    els.stage.hidden = false;
    layoutCrop();
    markStale();
  }

  function layoutCrop() {
    if (!state.img) return;
    var p = params();
    var net = build(p);
    var art = new Art(state.img, 1, { focus: state.focus });
    var r = art.windowRect(net.W, net.H);
    var q = r[2] / art.iw, rh = r[3] / art.ih;
    // рамка не должна вылезать за картинку
    var fx = Math.min(Math.max(state.focus[0], 0), 1);
    var fy = Math.min(Math.max(state.focus[1], 0), 1);
    els.crop.style.left = (fx * (1 - q) * 100) + "%";
    els.crop.style.top = (fy * (1 - rh) * 100) + "%";
    els.crop.style.width = (q * 100) + "%";
    els.crop.style.height = (rh * 100) + "%";
  }

  function dragCrop() {
    var started = false, sx = 0, sy = 0, fx0 = 0, fy0 = 0, boxW = 1, boxH = 1;
    var q = 1, rh = 1;
    els.crop.addEventListener("pointerdown", function (e) {
      var p = params();
      var net = build(p);
      var art = new Art(state.img, 1, { focus: state.focus });
      var r = art.windowRect(net.W, net.H);
      q = r[2] / art.iw; rh = r[3] / art.ih;
      var rect = els.shot.getBoundingClientRect();
      boxW = Math.max(1, rect.width * (1 - q));
      boxH = Math.max(1, rect.height * (1 - rh));
      started = true;
      sx = e.clientX; sy = e.clientY;
      fx0 = state.focus[0]; fy0 = state.focus[1];
      els.crop.setPointerCapture(e.pointerId);
      els.crop.style.cursor = "grabbing";
      e.preventDefault();
    });
    els.crop.addEventListener("pointermove", function (e) {
      if (!started) return;
      state.focus = [
        Math.min(1, Math.max(0, fx0 + (e.clientX - sx) / boxW)),
        Math.min(1, Math.max(0, fy0 + (e.clientY - sy) / boxH))
      ];
      layoutCrop();
    });
    els.crop.addEventListener("pointerup", function (e) {
      started = false;
      els.crop.style.cursor = "grab";
      try { els.crop.releasePointerCapture(e.pointerId); } catch (err) {}
      saveState();
      markStale();
    });
  }

  function loadFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () { setImage(img, file.name); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function loadDemo() {
    var img = new Image();
    img.onload = function () {
      state.focus = [0.5, 0.5];
      setImage(img, "демо-пейзаж");
    };
    img.src = (window.DEMO_SRC || "demo.jpg");
  }

  /* --- генерация --------------------------------------------------------- */

  function busy(on, text) {
    els.busy.hidden = !on;
    if (text) els.busyText.textContent = text;
  }

  /* Ошибку показываем на странице: alert() в headless-браузере блокирует
     страницу навсегда и ломает автопроверки. */
  function fail(msg) {
    console.error(msg);
    window.__lastError = msg;
    var box = document.getElementById("errBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "errBox";
      box.className = "info";
      box.style.borderColor = "#d9b8a6";
      box.style.background = "#fbeee7";
      els.info.parentNode.insertBefore(box, els.info);
    }
    box.textContent = msg;
  }

  function tick() { return new Promise(function (r) { setTimeout(r, 30); }); }

  function blobUrl(blob) {
    var u = URL.createObjectURL(blob);
    state.urls.push(u);
    return u;
  }

  function dropUrls() {
    state.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.urls = [];
  }

  function canvasThumb(src, maxW) {
    var k = Math.min(1, maxW / src.width);
    var c = document.createElement("canvas");
    c.width = Math.round(src.width * k);
    c.height = Math.round(src.height * k);
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function toBlob(cv, type, q) {
    return new Promise(function (res) { cv.toBlob(res, type, q); });
  }

  async function generate() {
    if (!state.img) { fail("Сначала выберите картинку."); return; }
    var p = params();
    var net = build(p);
    var size = sheetSize(net, p);
    els.go.disabled = true;
    busy(true, "собираю выкройку…");
    await tick();
    var t0 = performance.now();
    var stage = "лист";
    try {
      var art = new Art(state.img, p.dpi / 25.4, {
        focus: state.focus, fill: p.fill, artMode: "cover"
      });
      var sheet = Sheet.render(net, art, {
        dpi: p.dpi, marginMm: p.margin, bleedMm: p.bleed,
        marks: p.marks, labels: p.labels, blank: p.blank,
        title: "Вкладыш-диорама",
        subtitle: p.blank ? "пустая развёртка — только линии реза и сгиба"
          : "задник + 2 боковины + пол" + (net.C ? " + потолок" : "") +
            " · стенки " + fmt(net.H) + " мм" +
            (net.layout === "back" ? " · боковины на заднике" : ""),
        boxMm: [p.w, p.d, p.h]
      });
      console.log("лист:", Math.round(performance.now() - t0), "мс",
                  sheet.canvas.width + "x" + sheet.canvas.height);

      stage = "pdf";
      busy(true, "готовлю PDF…");
      await tick();
      var pdf = await PDFOut.build(sheet, {
        paper: p.paper, marginMm: 10, overlapMm: 10
      });
      console.log("pdf:", Math.round(performance.now() - t0), "мс", pdf.pages);

      var previewCv = null;
      if (!p.blank) {
        stage = "превью";
        busy(true, "рисую превью…");
        await tick();
        var art2 = new Art(state.img, 6, { focus: state.focus, fill: p.fill });
        previewCv = Preview.render(net, art2, { w: 1200, h: 900 });
        console.log("превью:", Math.round(performance.now() - t0), "мс");
      }

      stage = "png";
      dropUrls();
      var pngBlob = await toBlob(sheet.canvas, "image/png");
      var base = "diorama_" + Math.round(p.w) + "x" + Math.round(p.d) + "x" + Math.round(p.h);
      els.dlPng.href = blobUrl(pngBlob);
      els.dlPng.download = base + ".png";
      els.pngMeta.textContent = sheet.canvas.width + "×" + sheet.canvas.height +
        " px · " + Math.round(sheet.dpi) + " dpi";
      els.dlPdf.href = blobUrl(pdf.blob);
      els.dlPdf.download = base + ".pdf";
      els.pdfMeta.textContent = pdf.pages + " " + plural(pdf.pages, "лист", "листа", "листов") +
        (pdf.paper && pdf.paper !== "none" ? " · " + pdf.paper.toUpperCase() : "");

      els.sheetImg.src = blobUrl(await toBlob(canvasThumb(sheet.canvas, 1400), "image/jpeg", 0.9));
      els.sheetCap.textContent = "Лист " + fmt(size[0]) + " × " + fmt(size[1]) +
        " мм — печатать 1:1" + (pdf.pages > 1 ? ", файл разложен на " + pdf.pages + " листа" : "") + ".";
      if (previewCv) {
        els.prevFig.hidden = false;
        els.assembled.src = blobUrl(await toBlob(canvasThumb(previewCv, 1400), "image/jpeg", 0.9));
      } else {
        els.prevFig.hidden = true;
      }

      var sec = ((performance.now() - t0) / 1000).toFixed(1);
      var lines = [
        "коробка: " + Math.round(p.w) + " × " + Math.round(p.d) + " × " + Math.round(p.h) + " мм (внутри)",
        "вкладыш: " + fmt(net.W) + " × " + fmt(net.D) + " мм, стенки " + fmt(net.H) + " мм",
        "лист: " + fmt(size[0]) + " × " + fmt(size[1]) + " мм @ " + Math.round(sheet.dpi) + " dpi",
        "раскладка: " + (net.layout === "back" ? "боковины на заднике (компактнее)" : "боковины на полу")
      ];
      if (p.blank) lines.push("пустая развёртка — только контур, сгибы и клапаны");
      lines.push("PDF: " + pdf.pages + " " + plural(pdf.pages, "стр.", "стр.", "стр.") +
        (pdf.paper && pdf.paper !== "none" ? " · " + pdf.paper.toUpperCase() : "") +
        (pdf.pages > 1 ? " · наложение 10 мм" : ""));
      if (sheet.capped) {
        lines.push("⚠ разрешение снижено до " + Math.round(sheet.dpi) +
          " dpi — браузер не тянет лист целиком; для печати откройте на компьютере");
      }
      lines.push("готово за " + sec + " с");
      els.report.textContent = lines.join("\n");

      els.result.hidden = false;
      els.stale.hidden = true;
      state.sig = JSON.stringify(p) + "|" + state.focus.join(",");
      els.result.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error(err);
      fail("Не получилось собрать выкройку (" + stage + "): " +
           (err && err.message ? err.message : err));
    } finally {
      els.go.disabled = false;
      busy(false);
    }
  }

  function plural(n, one, few, many) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  /* --- события ----------------------------------------------------------- */

  ["w", "d", "h", "fit", "tab", "bleed", "margin"].forEach(function (k) {
    els[k].addEventListener("input", function () {
      layoutCrop(); updateInfo(); saveState(); markStale();
    });
  });
  FIELDS.forEach(function (k) {
    if (["w", "d", "h", "fit", "tab", "bleed", "margin"].indexOf(k) >= 0) return;
    els[k].addEventListener("change", function () {
      layoutCrop(); updateInfo(); saveState(); markStale();
    });
  });
  [els.ceiling, els.labels, els.marks, els.blank].forEach(function (el) {
    el.addEventListener("change", function () {
      layoutCrop(); updateInfo(); saveState(); markStale();
    });
  });

  els.go.addEventListener("click", generate);

  els.drop.addEventListener("click", function () { els.file.click(); });
  $("pickBtn").addEventListener("click", function (e) { e.stopPropagation(); els.file.click(); });
  $("demoBtn").addEventListener("click", function (e) { e.stopPropagation(); loadDemo(); });
  els.file.addEventListener("change", function () { loadFile(els.file.files[0]); });
  $("pickLink").addEventListener("click", function (e) { e.preventDefault(); els.file.click(); });
  $("demoLink").addEventListener("click", function (e) { e.preventDefault(); loadDemo(); });

  ["dragenter", "dragover"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); });
  });
  els.drop.addEventListener("dragenter", function () { els.drop.classList.add("over"); });
  els.drop.addEventListener("dragleave", function () { els.drop.classList.remove("over"); });
  els.drop.addEventListener("drop", function (e) {
    e.preventDefault();
    els.drop.classList.remove("over");
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(f);
  });
  window.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image") === 0) {
        loadFile(items[i].getAsFile());
        break;
      }
    }
  });

  loadState();
  dragCrop();
  updateInfo();
  loadDemo();
  setupPwa();
})();

/* --- установка приложения и офлайн-кэш --- */
function setupPwa() {
  var btn = document.getElementById("installBtn");
  var hint = document.getElementById("pwaHint");
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  var isTelegram = /Telegram/i.test(ua);
  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
                   navigator.standalone === true;

  function showHint() {
    if (!hint) return;
    var text = "";
    if (isIOS) text = "На iPhone: кнопка «Поделиться» → «На экран Домой» — откроется как приложение.";
    else if (isTelegram) text = "В Telegram откройте страницу в браузере (⋮ → «Открыть в браузере»), там появится установка.";
    else text = "В Chrome: меню ⋮ → «Установить приложение». Если пункта нет — приложение уже установлено, ищите иконку на рабочем столе.";
    hint.textContent = text;
    hint.hidden = false;
  }

  if (btn && !standalone) {
    if (window.__installPrompt) btn.hidden = false;
    btn.addEventListener("click", function () {
      var p = window.__installPrompt;
      if (p) {
        p.prompt();
        Promise.resolve(p.userChoice).then(function () { window.__installPrompt = null; btn.hidden = true; });
      } else {
        showHint();
      }
    });
    window.addEventListener("beforeinstallprompt", function () { btn.hidden = false; });
    window.addEventListener("appinstalled", function () { btn.hidden = true; if (hint) hint.hidden = true; });
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* офлайн-кэш не критичен */ });
    });
  }
}
