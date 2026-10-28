// Скриншоты локальной страницы через headless Chrome + CDP.
// Запуск: node tools/cdp_shot.mjs <url> <outDir> [ширина] [высота] [режим]
//   режим: "" — обычный сценарий, "blank" — пустая развёртка,
//          "tall" — высокая коробка 80×40×100 (компактная раскладка)
// Сценарий зашит под ui.html: пустое состояние, демо-картинка, результат.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.argv[2] || "http://127.0.0.1:8765/";
const outDir = process.argv[3] || "out/shots";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 1400);
const PORT = 9333;

mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "diobox-cdp-"));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, "--hide-scrollbars", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(path, opts) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, opts);
      return await r.json();
    } catch {
      await sleep(150);
    }
  }
  throw new Error("Chrome не поднялся на порту " + PORT);
}

const target = await json("/json/new?about:blank", { method: "PUT" });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method) {
    events.push(msg.method);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

async function shot(name) {
  const r = await send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true,
  });
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("saved", file);
}

async function waitFor(expr, timeout = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expr)) return true;
    await sleep(250);
  }
  throw new Error("не дождался: " + expr);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width, height, deviceScaleFactor: 1, mobile: false,
});
await send("Page.navigate", { url });
await waitFor("document.readyState === 'complete'");
await waitFor("!!document.querySelector('#go')");
await sleep(600);

await shot("01-empty.png");

// демо-пейзаж
await evaluate("document.querySelector('#demoBtn').click()");
await waitFor("!document.querySelector('#stageWrap').hidden");
await sleep(1200);
await shot("02-demo.png");

// открыть тонкую настройку, чтобы она попала в кадр
await evaluate("document.querySelector('#advBox').open = true");
await sleep(300);

const mode = process.argv[6] || "";
if (mode === "tall") {
  // высокая коробка: боковины логичнее вешать на задник
  await evaluate(`(() => {
    const set = (id, v) => { const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('w', 80); set('d', 40); set('h', 100); return true;
  })()`);
  await sleep(900);
}
await shot("03-advanced.png");

// генерация
await evaluate("document.querySelector('#advBox').open = false");
if (mode === "blank") {
  await evaluate("document.querySelector('#blank').checked = true;"
    + "document.querySelector('#blank').dispatchEvent(new Event('change',{bubbles:true})); true");
  await sleep(300);
}
await evaluate("document.querySelector('#go').click(); true");
await waitFor("!!document.querySelector('#result') && !document.querySelector('#result').hidden", 180000);
await sleep(1200);
const shotName = mode === "blank" ? "06-result-blank.png"
  : mode === "tall" ? "07-result-tall.png" : "04-result.png";
await shot(shotName);

// прокрутить к результату
await evaluate("document.querySelector('#result').scrollIntoView({block:'start'}); true");
await sleep(600);
await shot("05-result-top.png");

const report = await evaluate("document.querySelector('#report')?.textContent || ''");
console.log("report:", report.replace(/\s+/g, " ").trim());

ws.close();
chrome.kill();
process.exit(0);
