// Складывает текстуры панелей (как их видит art.panel) в отдельные PNG.
// Запуск: node tools/dump_panels.mjs <url> <imagePath> <outDir>
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.argv[2] || "http://127.0.0.1:8899/";
const imgPath = process.argv[3] || "out/test_pan.png";
const outDir = process.argv[4] || "out/panels";
const PORT = 9355;

mkdirSync(outDir, { recursive: true });
const b64 = readFileSync(imgPath).toString("base64");
const ext = /\.jpe?g$/i.test(imgPath) ? "jpeg" : "png";
const dataUrl = `data:image/${ext};base64,${b64}`;
const profile = mkdtempSync(join(tmpdir(), "diobox-panels-"));
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

const spec = JSON.parse(process.argv[5] || "null") || { W: 199, D: 149, H: 98, T: 12, C: true, layout: "cross", dpi: 150 };

const script = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(dataUrl)};
  await img.decode();
  const spec = ${JSON.stringify(spec)};
  const net = new Geom.Net(spec);
  const ppm = (spec.dpi || 150) / 25.4;
  const art = new Art(img, ppm, { focus: [0.5, 0.5], fill: "box", depthK: 1.8, artMode: "cover" });
  const panels = net.panels();
  const out = {};
  const sizes = {};
  ["back", "left", "right", "floor", "top"].forEach(function (name) {
    if (!panels[name]) return;
    var p = panels[name];
    var rot = net.layout === "back" && (name === "left" || name === "right");
    var cv = art.panel(name, p[2] - p[0], p[3] - p[1], net, [0, 1, 0, 1], rot);
    out[name] = cv.toDataURL("image/png");
    sizes[name] = [cv.width, cv.height];
  });
  return JSON.stringify({ out: out, sizes: sizes, quad: {
    left: art.panelQuad("left", net.W, net.H, net.D, false),
    right: art.panelQuad("right", net.W, net.H, net.D, false),
    back: art.panelQuad("back", net.W, net.H, net.D, false),
    top: art.panelQuad("top", net.W, net.H, net.D, false),
    floor: art.panelQuad("floor", net.W, net.H, net.D, false)
  } });
})()`;

const raw = await evaluate(script);
const res = JSON.parse(raw);
console.log("sizes", JSON.stringify(res.sizes));
console.log("quads", JSON.stringify(res.quad, null, 1));
for (const k of Object.keys(res.out)) {
  writeFileSync(join(outDir, k + ".png"), Buffer.from(res.out[k].split(",")[1], "base64"));
  console.log("saved", join(outDir, k + ".png"));
}
ws.close(); chrome.kill(); process.exit(0);
