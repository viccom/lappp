// Look at a page of the app in a real browser: headless Chrome, driven over
// its debugging protocol, with a screenshot for every step of a scenario.
//
//   node scripts/shoot-page.mjs --scenario tests/browser/household-shots.mjs --out <dir> [--base http://127.0.0.1:3590]
//
// The scenario module exports `run(page, { out, base })`. What the page drew
// is judged on the PNGs by eye, and by the numbers the scenario asserts (is
// anything off the viewport, does the document scroll). The bench pages under
// tests/browser/ stand in for the desktop shell's bridge.
//
// CHROME        the browser to start (default: the usual places on Windows)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/** One browser, started headless with a profile of its own. */
export async function openBrowser() {
  const chrome = CANDIDATES.find((file) => existsSync(file));
  if (!chrome) throw new Error('No Chrome or Edge found; set CHROME to the browser to start');
  const port = await freePort();
  const profile = join(tmpdir(), `lap-shoot-${process.pid}`);
  const child = spawn(
    chrome,
    [
      '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--force-device-scale-factor=1', '--force-color-profile=srgb', 'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((entry) => entry.type === 'page');
    } catch {
      await sleep(100);
    }
  }
  if (!target) {
    child.kill();
    throw new Error('The browser did not come up');
  }
  return {
    target,
    close() {
      child.kill();
    },
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const watchers = [];
    let nextId = 1;
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          return new Promise((done, fail) => {
            pending.set(id, { done, fail });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        onEvent(watch) {
          watchers.push(watch);
        },
        close() {
          socket.close();
        },
      });
    socket.onerror = () => reject(new Error(`cannot reach ${url}`));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error) waiter.fail(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? '')})`));
        else waiter.done(message.result);
        return;
      }
      for (const watch of watchers) watch(message);
    };
  });
}

/**
 * A tab of the browser, sized like a window of the desktop app.
 *
 * Every console error, every uncaught exception and every failed request is
 * kept in `problems`: a page that looks right and logs errors is not right.
 */
export async function openPage(browser, { width, height }) {
  const link = await connect(browser.target.webSocketDebuggerUrl);
  const problems = [];
  const console_ = [];
  link.onEvent((message) => {
    const { method, params } = message;
    if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails;
      problems.push(`exception: ${detail.exception?.description ?? detail.text}`);
    }
    if (method === 'Runtime.consoleAPICalled') {
      const text = params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
      console_.push(`${params.type}: ${text}`);
      if (params.type === 'error' || params.type === 'warning') problems.push(`console.${params.type}: ${text}`);
    }
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) {
      problems.push(`${params.entry.level}: ${params.entry.text} ${params.entry.url ?? ''}`);
    }
    if (method === 'Network.loadingFailed') problems.push(`request failed: ${params.errorText} (${params.type})`);
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      problems.push(`http ${params.response.status}: ${params.response.url}`);
    }
  });
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await link.send(`${domain}.enable`);

  const page = {
    problems,
    console: console_,
    async setViewport(nextWidth, nextHeight) {
      await link.send('Emulation.setDeviceMetricsOverride', {
        width: nextWidth, height: nextHeight, deviceScaleFactor: 1, mobile: false,
      });
    },
    async goto(url) {
      const loaded = new Promise((done) => {
        const watch = (message) => {
          if (message.method === 'Page.loadEventFired') done();
        };
        link.onEvent(watch);
      });
      await link.send('Page.navigate', { url });
      await loaded;
      // The bench says when the page is up.
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (await page.evaluate(() => Boolean(window.__harness))) break;
        await sleep(50);
      }
      await page.settle();
    },
    /** Let the page finish what the last action started. */
    async settle() {
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await sleep(120);
    },
    async evaluate(source, ...args) {
      const expression = `(${source.toString()})(...${JSON.stringify(args)})`;
      const { result, exceptionDetails } = await link.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      }
      return result.value;
    },
    /** The centre of an element, in pixels of the viewport, once it is scrolled into view. */
    async centre(selector) {
      return page.evaluate((query) => {
        const element = document.querySelector(query);
        if (!element) return null;
        // A person would not click what a scrolling list keeps out of sight.
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const box = element.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
      }, selector);
    },
    /** A real click of the mouse, where a person would put it. */
    async click(selector) {
      const at = await page.centre(selector);
      if (!at) throw new Error(`nothing answers "${selector}"`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await link.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
      }
      await page.settle();
    },
    /** What a person gets when they type into a field. */
    async type(selector, text) {
      await page.click(selector);
      await link.send('Input.insertText', { text });
      await page.settle();
    },
    /** A click on a place of the window, where no element in particular is. */
    async clickAt(x, y) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await link.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
      await page.settle();
    },
    /** A press, a move and a release: what dragging feels like to the page. */
    async drag(from, to) {
      await link.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
      await link.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      for (let step = 1; step <= 5; step += 1) {
        await link.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 5, y: from.y + (to.y - from.y) * step / 5, button: 'left', buttons: 1,
        });
      }
      await link.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      await page.settle();
    },
    /** A turn of the wheel over a place of the window. */
    async wheel(at, deltaY) {
      await link.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY });
      await page.settle();
    },
    /** The window as a picture; a `clip` takes one part of it, blown up by `scale`. */
    async shot(file, clip = null) {
      const { data } = await link.send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { ...clip, scale: clip.scale ?? 2 } } : {}),
      });
      mkdirSync(resolve(file, '..'), { recursive: true });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
    close() {
      link.close();
    },
  };
  await page.setViewport(width, height);
  return page;
}

// ---- the command ----

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : fallback;
  };

  const scenario = await import(pathToFileURL(resolve(option('scenario'))).href);
  const out = resolve(option('out', 'build/shots'));
  const base = option('base', 'http://127.0.0.1:3590');
  mkdirSync(out, { recursive: true });

  const browser = await openBrowser();
  const page = await openPage(browser, { width: 1100, height: 721 });
  let failed = false;
  try {
    await scenario.run(page, { out, base });
  } catch (error) {
    failed = true;
    console.error(error.stack ?? error);
  } finally {
    page.close();
    browser.close();
  }
  const own = page.problems.filter((line) => !scenario.ignored?.(line));
  for (const line of own) console.error(`[page] ${line}`);
  if (own.length) failed = true;
  console.log(failed ? 'shots: FAILED' : `shots: ok -> ${out}`);
  process.exit(failed ? 1 : 0);
}
