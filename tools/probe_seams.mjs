// Проверка непрерывности рисунка на сгибах: края панелей должны совпадать.
// Запуск: node tools/probe_seams.mjs <url> <imagePath>
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.argv[2] || "http://127.0.0.1:8899/";
const imgPath = process.argv[3] || "out/test_pan.png";
const PORT = 9351;

const b64 = readFileSync(imgPath).toString("base64");
const dataUrl = `data:image/png;base64,${b64}`;
const profile = mkdtempSync(join(tmpdir(), "diobox-seams-"));
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
for (let i = 0; i < 60; i++) { if (await evaluate("document.readyState === 'complete'")) break; await sleep(200); }

const script = `(async () => {
  const src = ${JSON.stringify(dataUrl)};
  const img = new Image();
  img.src = src;
  await img.decode();
  const net = new Geom.Net({ W: 199, D: 149, H: 98, T: 12, C: true, layout: "cross" });
  const art = new Art(img, 6, { focus: [0.5, 0.5], fill: "box", depthK: 1.8, artMode: "cover" });
  const F = [0, 1, 0, 1];
  const panels = {
    back: art.panel("back", net.W, net.H, net, F, false),
    left: art.panel("left", net.H, net.D, net, F, false),
    right: art.panel("right", net.H, net.D, net, F, false),
    floor: art.panel("floor", net.W, net.D, net, F, false),
    top: art.panel("top", net.W, net.D, net, F, false)
  };
  function edge(cv, side, n) {
    const w = cv.width, h = cv.height;
    const c2 = document.createElement("canvas");
    c2.width = w; c2.height = h;
    const g = c2.getContext("2d", { willReadFrequently: true });
    g.drawImage(cv, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    const out = [];
    for (let i = 0; i < n; i++) {
      let x, y;
      if (side === "L") { x = 2; y = Math.round((i + 0.5) * h / n); }
      if (side === "R") { x = w - 3; y = Math.round((i + 0.5) * h / n); }
      if (side === "T") { x = Math.round((i + 0.5) * w / n); y = 2; }
      if (side === "B") { x = Math.round((i + 0.5) * w / n); y = h - 3; }
      const k = (y * w + x) * 4;
      out.push([d[k], d[k + 1], d[k + 2]]);
    }
    return out;
  }
  const N = 12;
  const E = {};
  for (const k in panels) {
    E[k] = { L: edge(panels[k], "L", N), R: edge(panels[k], "R", N), T: edge(panels[k], "T", N), B: edge(panels[k], "B", N) };
  }
  const dist = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) for (let j = 0; j < 3; j++) s += Math.abs(a[i][j] - b[i][j]);
    return Math.round(s / a.length / 3);
  };
  const report = {};
  for (const refSide of ["L", "R", "T", "B"]) {
    const best = [];
    for (const k of ["left", "right", "floor", "top"]) {
      for (const s of ["L", "R", "T", "B"]) {
        best.push([k + "." + s, dist(E.back[refSide], E[k][s])]);
      }
    }
    best.sort((x, y) => x[1] - y[1]);
    report["back." + refSide] = best.slice(0, 3);
  }
  return JSON.stringify({ report, sizes: Object.fromEntries(Object.entries(panels).map(([k, v]) => [k, [v.width, v.height]])) });
})()`;

const out = await evaluate(script);
console.log(out);
ws.close(); chrome.kill(); process.exit(0);
