import { writeFileSync } from 'node:fs';

const target = (await (await fetch('http://127.0.0.1:9222/json')).json())
  .find((entry) => entry.type === 'page');
if (!target) throw new Error('Chrome remote debugging page is unavailable');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message);
  pending.delete(message.id);
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, (message) => {
      if (message.error) reject(new Error(message.error.message));
      else resolve(message);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function capture(name, { portrait = false, print = false } = {}) {
  const size = portrait ? 512 : 800;
  await send('Emulation.setDeviceMetricsOverride', {
    width: size,
    height: size,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const params = new URLSearchParams({
    name,
    angle: '40',
    portrait: portrait ? '1' : '0',
    print: print ? '1' : '0',
  });
  await send('Page.navigate', {
    url: `http://127.0.0.1:4301/tools/assets/rider-preview.html?${params}`,
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const response = await send('Runtime.evaluate', {
      expression: `({
        ready: document.body.dataset.ready === 'true',
        print: document.body.dataset.print === 'true',
        error: document.body.dataset.error || null
      })`,
      returnByValue: true,
    });
    const state = response.result.result.value;
    if (state.error) throw new Error(`${name}: ${state.error}`);
    if (state.ready && (!print || state.print)) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error(`${name} preview did not finish loading`);

  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const path = portrait
    ? `public/assets/${name}.png`
    : `/home/ubuntu/downhill-shots/${name}-turntable.png`;
  writeFileSync(path, Buffer.from(screenshot.result.data, 'base64'));
  console.log(path);
}

await send('Page.enable');
await send('Runtime.enable');
await capture('rider-red', { print: true });
await capture('rider-black');
await capture('rider-red', { portrait: true, print: true });
await capture('rider-black', { portrait: true });
socket.close();
