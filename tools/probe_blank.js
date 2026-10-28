// проверяем пустую развёртку: галочка → генерация без картинки → превью скрыто
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

// без картинки вообще: пустой развёртке она не нужна
$("blank").checked = true;
$("blank").dispatchEvent(new Event("change", { bubbles: true }));
out.before = {
  blank: $("blank").checked,
  resultHidden: $("result").hidden,
};

$("go").click();
for (let i = 0; i < 200; i++) {
  if (!$("result").hidden) break;
  await sleep(150);
}
await sleep(300);

out.after = {
  prevHidden: $("prevBlock").hidden,
  sheetSrc: ($("sheetImg").getAttribute("src") || "").slice(0, 40),
  cap: $("sheetCap").textContent,
  pdfMeta: $("pdfMeta").textContent,
  report: $("report").textContent.split("\n"),
};
out.stored = JSON.parse(localStorage.getItem("diobox.v1") || "{}").blank;
// возвращаем как было, чтобы не влиять на другие прогоны
$("blank").checked = false;
return out;
