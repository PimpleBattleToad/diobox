// Рендер листа статической страницей без UI: прямо через Geom/Art/Sheet.
// Запуск: node tools/render_js_sheet.mjs <url> <imagePath> <outPng> [dpi] [paper]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.argv[2] || "http://127.0.0.1:8899/";
const imgPath = process.argv[3] || "out/test_pan.png";
const outPng = process.argv[4] || "out/js_sheet.png";
const dpi = Number(process.argv[5] || 150);
const PORT = 9353;

const b64 = readFileSync(imgPath).toString("base64");
const ext = imgPath.toLowerCase().endsWith(".jpg") || imgPath.toLowerCase().endsWith(".jpeg") ? "jpeg" : "png";
const dataUrl = `data:image/${ext};base64,${b64}`;
const profile = mkdtempSync(join(tmpdir(), "diobox-renderjs-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1200,900", "--hide-scrollbars", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path, opts) {
  for (let i = 0; i < 120; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, opts)).json(); }
    catch { await sleep(150); }
  }
  throw new Error("chrome not ready");
}
const target = await json("/json/new?about:blank", { method: "PUT" });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
function send(method, params = {}) {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
for (let i = 0; i < 80; i++) { if (await evaluate("document.readyState === 'complete'")) break; await sleep(200); }

const script = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const net = new Geom.Net({ W: 199, D: 149, H: 98, T: 12, C: true, layout: "cross" });
  const art = new Art(img, ${dpi} / 25.4, { focus: [0.5, 0.5], fill: "box", depthK: 1.8, artMode: "cover" });
  const sh = Sheet.render(net, art, { dpi: ${dpi}, margin: 12, bleed: 3, marks: true, labels: false,
                                      title: "", subtitle: "", box: [200, 150, 100] });
  return sh.canvas.toDataURL("image/png");
})()`;

const data = await evaluate(script);
writeFileSync(outPng, Buffer.from(data.split(",")[1], "base64"));
console.log("saved", outPng, (data.length * 0.75 / 1024).toFixed(0), "kb");
ws.close(); chrome.kill(); process.exit(0);
