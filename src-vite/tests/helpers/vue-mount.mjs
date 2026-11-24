// Mount a real single-file component in Node, without a browser.
//
// The component is compiled with Vue's own compiler and rendered with a
// renderer whose host is a tree of plain objects. What the page draws can
// then be read, and what the user would click can be called.
//
// The modules the page imports are the real ones, except for the ones a test
// hands in as mocks (the transport, the base controls, the translations).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vue = require('vue');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');

// ---- the host: plain objects in a tree ----

function hostNode(kind, tag = null, text = '') {
  return { kind, tag, text, props: {}, children: [], parentNode: null };
}

function detach(node) {
  const parent = node.parentNode;
  if (!parent) return;
  const at = parent.children.indexOf(node);
  if (at >= 0) parent.children.splice(at, 1);
  node.parentNode = null;
}

const renderer = vue.createRenderer({
  createElement: (tag) => hostNode('element', tag),
  createText: (text) => hostNode('text', null, text),
  createComment: (text) => hostNode('comment', null, text),
  setText(node, text) {
    node.text = text;
  },
  setElementText(node, text) {
    node.children = [];
    node.text = text;
  },
  parentNode: (node) => node.parentNode,
  nextSibling(node) {
    const parent = node.parentNode;
    if (!parent) return null;
    return parent.children[parent.children.indexOf(node) + 1] ?? null;
  },
  querySelector: () => null,
  setScopeId() {},
  insert(child, parent, anchor = null) {
    detach(child);
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at === -1) parent.children.push(child);
    else parent.children.splice(at, 0, child);
    child.parentNode = parent;
  },
  remove: detach,
  patchProp(element, key, previous, next) {
    if (key === 'class') {
      const list = Array.isArray(next)
        ? next
        : next && typeof next === 'object'
          ? Object.entries(next).filter(([, on]) => on).map(([name]) => name)
          : [next];
      element.props.class = list.filter(Boolean).join(' ');
    } else {
      element.props[key] = next;
    }
  },
});

// ---- the modules ----

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function compileVue(source, file) {
  const { descriptor, errors } = parse(source, { filename: file });
  if (errors.length) throw new Error(`${file}: ${errors.map((e) => e.message).join('; ')}`);
  return transpile(compileScript(descriptor, { id: 'page', inlineTemplate: true }).content);
}

function createLoader(srcDir, mocks) {
  const loaded = new Map();

  function locate(specifier, fromFile) {
    if (specifier.startsWith('@/')) {
      const base = path.join(srcDir, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.js`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
      throw new Error(`cannot find ${specifier} under ${srcDir}`);
    }
    if (specifier.startsWith('.')) {
      const base = path.resolve(path.dirname(fromFile), specifier);
      for (const candidate of [base, `${base}.ts`, `${base}.js`]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
    }
    return null;
  }

  async function load(specifier, fromFile) {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === 'vue') return vue;
    const file = locate(specifier, fromFile);
    if (!file) throw new Error(`nothing stands in for "${specifier}" (imported by ${fromFile})`);
    return loadFile(file);
  }

  async function loadFile(file) {
    if (loaded.has(file)) return loaded.get(file);
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const code = file.endsWith('.vue') ? compileVue(source, file) : transpile(source);
    const module = { exports: {} };
    loaded.set(file, module.exports);
    // Everything the module needs is loaded before it runs, so its own
    // require can stay synchronous.
    const needed = [...code.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    for (const specifier of needed) await load(specifier, file);
    // A module that was loaded is found by what it was imported as, the same
    // way `load` finds it: a stand-in first, then Vue, then a file.
    const requireSync = (specifier) => {
      const value = Object.hasOwn(mocks, specifier)
        ? mocks[specifier]
        : specifier === 'vue'
          ? vue
          : loaded.get(locate(specifier, file));
      if (value === undefined) throw new Error(`"${specifier}" was not loaded for ${file}`);
      return value;
    };
    new Function('require', 'module', 'exports', code)(requireSync, module, module.exports);
    loaded.set(file, module.exports);
    return module.exports;
  }

  return { loadFile };
}

// ---- translations: the real files, and a missing key is an error ----

function translator(srcDir, locale) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(srcDir, 'locales', `${name}.json`), 'utf8'));
  const own = read(locale);
  const english = read('en');
  const at = (tree, key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), tree);
  return (key, params = {}) => {
    if (typeof at(own, key) !== 'string') throw new Error(`${locale} has no text for "${key}"`);
    if (typeof at(english, key) !== 'string') throw new Error(`en has no text for "${key}"`);
    return at(own, key).replace(/\{(\w+)\}/g, (hole, name) => (name in params ? String(params[name]) : hole));
  };
}

// ---- reading and driving the tree ----

/** Everything a node says, in order. */
export function textOf(node) {
  if (node.kind === 'comment') return '';
  return node.text + node.children.map(textOf).join('');
}

/** Every node below and including this one that the predicate accepts. */
export function findAll(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children) findAll(child, predicate, found);
  return found;
}

/** Let the page finish whatever the last click started. */
export async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await vue.nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** What the user does to a control: a click, or a change of its value. */
export function click(node) {
  if (typeof node.props.onClick !== 'function') throw new Error(`<${node.tag}> has nothing to click`);
  return node.props.onClick({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {} });
}

export function change(node, value) {
  const handler = node.props.onChange ?? node.props.onInput;
  if (typeof handler !== 'function') throw new Error(`<${node.tag}> has nothing to change`);
  return handler({ target: { value, checked: value }, currentTarget: node, preventDefault() {}, stopPropagation() {} });
}

// ---- the base controls, kept to the contract the page relies on ----

const passThrough = (tag, extraProps = () => ({})) =>
  vue.defineComponent({
    inheritAttrs: false,
    setup(props, { slots, attrs }) {
      return () => vue.h(tag, { ...attrs, ...extraProps(props) }, slots.default ? [slots.default()] : []);
    },
  });

/** The real one is a div with a role; what the page relies on is the same. */
export const TButton = vue.defineComponent({
  props: { text: String, disabled: Boolean, buttonSize: String, buttonClasses: String, icon: null, selected: Boolean },
  emits: ['click'],
  setup(props, { emit, slots, attrs }) {
    return () =>
      vue.h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          onClick: (event) => {
            if (!props.disabled) emit('click', event);
          },
        },
        [props.text ?? '', slots.default ? slots.default() : ''],
      );
  },
});

export const ModalDialog = vue.defineComponent({
  props: { title: String, width: Number },
  emits: ['cancel'],
  setup(props, { emit, slots }) {
    return () =>
      vue.h('div', { class: 'modal-dialog', 'data-title': props.title }, [
        vue.h('button', { type: 'button', 'data-close': 'true', onClick: () => emit('cancel') }, '×'),
        vue.h('div', { class: 'modal-body' }, slots.default ? [slots.default()] : []),
      ]);
  },
});

/** The real one offers a search and a list; it hands back the value chosen. */
export const SearchableSelect = vue.defineComponent({
  props: { modelValue: null, options: Array, placeholder: String, searchPlaceholder: String, emptyText: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      vue.h(
        'select',
        {
          class: 'searchable-select',
          onChange: (event) => emit('update:modelValue', event.target.value),
        },
        (props.options ?? []).map((option) =>
          vue.h('option', { value: option.value, key: option.value }, option.label),
        ),
      );
  },
});

export const IconPerson = vue.defineComponent({
  setup: () => () => vue.h('i', { class: 'icon-person' }),
});

/**
 * Mount a page of the app.
 *
 * @param {string} srcDir the `src` directory
 * @param {string} file the component to mount
 * @param {Record<string, unknown>} mocks what stands in for the modules the page imports
 * @param {string} locale
 */
export async function mountPage(srcDir, file, mocks, locale = 'zh-CN') {
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800 };
  const t = translator(srcDir, locale);
  const loader = createLoader(srcDir, { 'vue-i18n': { useI18n: () => ({ t }) }, ...mocks });
  const component = (await loader.loadFile(file)).default;
  const root = hostNode('root');
  const app = renderer.createApp(component);
  const problems = [];
  app.config.warnHandler = (message) => problems.push(`warning: ${message}`);
  app.config.errorHandler = (error) => problems.push(`error: ${error?.stack ?? error}`);
  app.mount(root);
  await settle();
  return {
    root,
    t,
    problems,
    settle,
    unmount: () => app.unmount(),
    /** The component's own text, without the whitespace the template puts around it. */
    text: () => textOf(root).replace(/\s+/g, ' ').trim(),
  };
}
