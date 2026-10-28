// Быстрый прогон JS на локальной странице: node tools/cdp_eval.mjs <url> <file.js>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.argv[2];
const file = process.argv[3];
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), "diobox-eval-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1440,1400", "--hide-scrollbars", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opts) {
  for (let i = 0; i < 100; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, opts)).json(); }
    catch { await sleep(150); }
  }
  throw new Error("Chrome не поднялся");
}
const target = await api("/json/new?about:blank", { method: "PUT" });
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
for (let i = 0; i < 200; i++) {
  if (await evaluate("document.readyState === 'complete' && !!document.querySelector('#go')")) break;
  await sleep(150);
}
await sleep(400);
const code = readFileSync(file, "utf8");
const out = await evaluate(`(async () => { ${code} })()`);
console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
ws.close();
chrome.kill();
process.exit(0);
