// A bench for looking at the graph page in a real browser.
//
//   http://localhost:<vite>/tests/browser/household.html[?seed=family|none&personId=3&faces=1&theme=dark&lang=en]
//
// The page component, its controls, the translations and the styles are the
// real files. What stands in is the library behind the commands: the in-memory
// one of tests/helpers/household-library.mjs, hung where the Tauri bridge would
// be. scripts/shoot-page.mjs drives this page and takes the screenshots.
//
// The faces go the way the real library sends them: the bare JPEG as base64,
// with nothing in front of it. With `faces=1` the pictures of
// tests/browser/qa-faces/*.jpg are cropped into them (pictures that are not
// for the repository); otherwise a head and shoulders on a coloured ground.
import { createFamilyLibrary, createLibrary } from '../helpers/household-library.mjs';

const params = new URLSearchParams(window.location.search);
const useFaces = params.get('faces') === '1';
const seeded = params.get('seed') !== 'none';

const GROUNDS = ['#c7d2fe', '#fbcfe8', '#bbf7d0', '#fde68a', '#bae6fd', '#fdba74', '#ddd6fe', '#f9a8d4', '#a7f3d0', '#fde2e4', '#e9d5ff', '#fef3c7'];

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** A face as the library keeps it: the bare JPEG and nothing in front of it. */
async function faceAt(index) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  const context = canvas.getContext('2d');
  context.fillStyle = GROUNDS[index % GROUNDS.length];
  context.fillRect(0, 0, 160, 160);
  const picture = useFaces ? await loadImage(`qa-faces/${index + 1}.jpg`) : null;
  if (picture) {
    // The whole picture, cut to the square.
    const scale = Math.max(160 / picture.width, 160 / picture.height);
    const width = picture.width * scale;
    const height = picture.height * scale;
    context.drawImage(picture, (160 - width) / 2, (160 - height) / 2, width, height);
  } else {
    context.fillStyle = 'rgba(255,255,255,.9)';
    context.beginPath();
    context.arc(80, 62, 30, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(80, 166, 56, 60, 0, 0, Math.PI * 2);
    context.fill();
  }
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

const faces = await Promise.all(Array.from({ length: 12 }, (_, index) => faceAt(index)));

const library = seeded
  ? createFamilyLibrary({ faces })
  : createLibrary({
      albums: [{ id: 1, name: '家庭' }, { id: 2, name: '旅行' }],
      persons: [
        { name: '张伟', count: 431 }, { name: '李静', count: 428 }, { name: '张小满', count: 1204 },
        { name: '王秀兰', count: 86 }, { name: '陈小雨', count: 32 },
      ].map((person, index) => ({ ...person, thumbnail: faces[index] })),
    });

// ---- the bridge the desktop shell would provide ----

const callbacks = new Map();
const listeners = new Map();
let nextCallback = 1;

window.__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: 'household' },
    currentWebview: { label: 'household', windowLabel: 'household' },
  },
  transformCallback(callback) {
    const id = nextCallback;
    nextCallback += 1;
    callbacks.set(id, callback);
    return id;
  },
  async invoke(command, args) {
    if (command === 'plugin:event|listen') {
      listeners.set(args.event, callbacks.get(args.handler));
      return `${args.event}-1`;
    }
    if (command === 'plugin:event|unlisten') return null;
    return library.invoke(command, args);
  },
  convertFileSrc: (path) => path,
};

document.documentElement.dataset.theme = params.get('theme') || 'light';

// ---- the page, with what it needs around it ----

const { i18n, initializeLanguage } = await import('@/common/i18n');
await initializeLanguage(params.get('lang') || 'zh');
const { createApp } = await import('vue');
const { default: Household } = await import('@/views/Household.vue');
await import('@/assets/app.css');

const app = createApp(Household);
const problems = [];
app.config.warnHandler = (message) => problems.push(`warning: ${message}`);
app.config.errorHandler = (error) => problems.push(`error: ${error?.stack ?? error}`);
app.use(i18n);
app.mount('#app');

// What a script driving the bench may do.
window.__harness = {
  library,
  problems,
  /** The event the main window sends when another person is picked there. */
  emit(event, payload) {
    listeners.get(event)?.({ event, payload });
  },
};
