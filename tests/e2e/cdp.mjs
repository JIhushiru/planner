// Minimal Chrome DevTools Protocol client (Node 22 built-in WebSocket).
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onclose = () => {
    for (const { reject } of pending.values()) reject(new Error('DevTools connection closed'));
    pending.clear();
  };
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const on = fn => listeners.push(fn);
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('Eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  return { ws, send, on, evaluate, close: () => ws.close() };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function waitForJson(port, tries = 60, match = t => t.type === 'page') {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json`);
      const j = await r.json();
      if (Array.isArray(j) && j.some(match)) return j;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('DevTools endpoint did not come up on port ' + port);
}

export async function screenshot(c, file, fs) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}
