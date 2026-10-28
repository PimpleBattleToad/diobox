// рамка кадрирования должна совпадать с пропорцией задника
const out = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

function measure() {
  const img = $("artImg").getBoundingClientRect();
  const crop = $("crop").getBoundingClientRect();
  return {
    img: [Math.round(img.width), Math.round(img.height)],
    crop: [Math.round(crop.width), Math.round(crop.height)],
    cropAspect: +(crop.width / crop.height).toFixed(3),
    imgAspect: +(img.width / img.height).toFixed(3),
  };
}

await sleep(400);
$("demoBtn").click();
for (let i = 0; i < 60; i++) {
  if ($("artImg").naturalWidth) break;
  await sleep(100);
}
await sleep(400);
out.default = measure();   // 200×150×100 → задник 199×98 → 2.03

const set = (id, v) => {
  const el = $(id);
  el.value = String(v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
set("w", 80); set("d", 40); set("h", 100);
await sleep(700);
out.tall = measure();      // задник 79×98 → 0.806

set("h", 60);
await sleep(700);
out.wide = measure();      // задник 79×58 → 1.36

set("w", 200); set("d", 150); set("h", 100);
await sleep(700);
return out;
