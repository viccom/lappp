// The dev server for the browser bench: the app's own config, without the
// Vue devtools overlay (the shipped app has none, and it covers the page).
//
//   npx vite --config tests/browser/vite.bench.config.js --port 3590 --strictPort --host 127.0.0.1
import base from '../../vite.config.js';

export default async (env) => {
  const config = await base(env);
  return {
    ...config,
    plugins: config.plugins.flat().filter((plugin) => !plugin?.name?.includes('devtools')),
  };
};
