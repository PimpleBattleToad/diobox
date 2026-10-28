// проверяем выбор раскладки листа: высокая коробка 80×40×100
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

async function setBox(w, d, h, layout) {
  const set = (id, v) => {
    const el = $(id);
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  set("w", w); set("d", d); set("h", h);
  $("layout").value = layout;
  $("layout").dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(700);          // ждём /api/geometry
  return $("info").textContent.replace(/\s+/g, " ").trim();
}

out.auto = await setBox(80, 40, 100, "auto");
out.cross = await setBox(80, 40, 100, "cross");
out.back = await setBox(80, 40, 100, "back");

// генерируем в авто-раскладке и смотрим, что вышло
out.auto = await setBox(80, 40, 100, "auto");
$("demoBtn").click();
await sleep(400);
$("go").click();
for (let i = 0; i < 300; i++) {
  if (!$("result").hidden) break;
  await sleep(150);
}
await sleep(400);
out.result = {
  cap: $("sheetCap").textContent.replace(/\s+/g, " ").trim(),
  pdfMeta: $("pdfMeta").textContent.replace(/\s+/g, " ").trim(),
  report: $("report").textContent.replace(/\s+/g, " ").trim(),
  sheetSrc: ($("sheetImg").getAttribute("src") || "").slice(0, 40),
};
out.storedLayout = JSON.parse(localStorage.getItem("diobox.v1") || "{}").layout;
// возвращаем дефолт, чтобы не мешать другим прогонам
await setBox(200, 150, 100, "auto");
return out;
