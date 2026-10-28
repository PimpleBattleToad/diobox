// РџСЂРѕРІРµСЂРєР° СЃС‚Р°С‚РёС‡РµСЃРєРѕР№ СЃС‚СЂР°РЅРёС†С‹ (docs/) С‡РµСЂРµР· headless Chrome:
// РєРѕРЅСЃРѕР»СЊРЅС‹Рµ РѕС€РёР±РєРё, РіРµРЅРµСЂР°С†РёСЏ, СЃРєР°С‡РёРІР°РЅРёРµ PNG Рё PDF РІ РїР°РїРєСѓ.
// Р—Р°РїСѓСЃРє: node tools/cdp_static.mjs <url> <outDir> [w] [h] [mode]
//   mode: "" | "tall" | "blank"
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.argv[2] || "http://127.0.0.1:8899/";
const outDir = process.argv[3] || "out/static";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 1500);
const mode = process.argv[6] || "";
const PORT = 9337;

mkdirSync(outDir, { recursive: true });
const dlDir = join(outDir, "files");
mkdirSync(dlDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "diobox-static-"));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, "--hide-scrollbars", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(path, opts) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, opts);
      return await r.json();
    } catch { await sleep(150); }
  }
  throw new Error("Chrome РЅРµ РїРѕРґРЅСЏР»СЃСЏ");
}

const target = await json("/json/new?about:blank", { method: "PUT" });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const a = (msg.params.args || []).map((x) => x.value ?? x.description ?? "?").join(" ");
    logs.push(`[${msg.params.type}] ${a}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    logs.push("[exception] " + (d.exception?.description || d.text));
  } else if (msg.method === "Log.entryAdded") {
    logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(outDir, name), Buffer.from(r.data, "base64"));
  console.log("saved", join(outDir, name));
}
async function waitFor(expr, timeout = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expr)) return true;
    await sleep(300);
  }
  throw new Error("РЅРµ РґРѕР¶РґР°Р»СЃСЏ: " + expr);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
try {
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
} catch (e) { console.log("download behavior:", e.message); }
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await waitFor("document.readyState === 'complete'");
await waitFor("!!document.querySelector('#go')");

// РґРµРјРѕ-РєР°СЂС‚РёРЅРєР° РїРѕРґС…РІР°С‚С‹РІР°РµС‚СЃСЏ СЃР°РјР°; Р¶РґС‘Рј РєР°РґСЂ
await waitFor("!document.querySelector('#stage').hidden");
await sleep(700);
await shot("01-demo.png");

await evaluate("document.querySelector('#adv').open = true; true");
if (mode === "tall") {
  await evaluate(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('w', 80); set('d', 40); set('h', 100); return true; })()`);
}
if (mode === "blank") {
  await evaluate(`(() => { const el = document.getElementById('blank');
    el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
}
if (mode === "fast") {
  await evaluate(`(() => { const el = document.getElementById('dpi'); el.value = '150';
    el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
}
if (mode === "none") {
  await evaluate(`(() => { const el = document.getElementById('paper'); el.value = 'none';
    el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
}
await sleep(500);
await shot("02-form.png");
console.log("info:", await evaluate("document.querySelector('#info').textContent"));

const t0 = Date.now();
await evaluate("document.querySelector('#go').click(); true");
await waitFor(`(!document.querySelector('#result').hidden) || !!window.__lastError`);
const dt = Date.now() - t0;
const err = await evaluate("window.__lastError || ''");
if (err) { console.log("РћРЁРР‘РљРђ:", err); }
await sleep(800);
await shot("03-result.png");
console.log("report:", (await evaluate("document.querySelector('#report').textContent")).replace(/\s+/g, " ").trim());
console.log("generate ms:", dt);

// забираем содержимое ссылок (blob:) и кладём на диск — в headless
// скачивание через download-атрибут не срабатывает без окна загрузок
async function saveBlob(sel, file, attr) {
  attr = attr || "href";
  const b64 = await evaluate(`(async () => {
    const href = document.querySelector('${sel}').${attr};
    const r = await fetch(href);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = "";
    const CH = 8192;
    for (let i = 0; i < buf.length; i += CH) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    }
    return btoa(s);
  })()`);
  const buf = Buffer.from(b64, "base64");
  writeFileSync(join(dlDir, file), buf);
  console.log("file", file, buf.length, "b");
}
await saveBlob("#dlPdf", "diobox.pdf");
await saveBlob("#dlPng", "diobox.png");
await saveBlob("#sheetImg", "sheet-thumb.jpg", "src");
await saveBlob("#assembled", "assembled.jpg", "src");

const files = readdirSync(dlDir).map((f) => `${f} вЂ” ${statSync(join(dlDir, f)).size} b`);
console.log("downloads:", files.join("; ") || "РЅРµС‚");

console.log("console:", logs.length ? logs.join(" | ") : "С‡РёСЃС‚Рѕ");
ws.close();
chrome.kill();
process.exit(0);

