export function evaluateTypecheckResult({ status, signal = null, error = null, counts }, { update = false, baselineEntries } = {}) {
  const diagnostics = counts instanceof Map ? counts : new Map();
  const total = [...diagnostics.values()].reduce((sum, count) => sum + count, 0);

  if (error) {
    return { ok: false, reason: `failed to start vue-tsc: ${error.message}`, total, added: [], removed: [], baselineUpdate: null };
  }
  if (signal) {
    return { ok: false, reason: `vue-tsc terminated by signal ${signal}`, total, added: [], removed: [], baselineUpdate: null };
  }
  if (status == null) {
    return { ok: false, reason: 'vue-tsc returned no exit status', total, added: [], removed: [], baselineUpdate: null };
  }
  if (status === 0 && total > 0) {
    return { ok: false, reason: `vue-tsc exited successfully but reported ${total} TypeScript diagnostic(s)`, total, added: [], removed: [], baselineUpdate: null };
  }
  if (status !== 0 && total === 0) {
    return { ok: false, reason: `vue-tsc exited ${status} without parseable TypeScript diagnostics`, total, added: [], removed: [], baselineUpdate: null };
  }
  if (status !== 0 && status !== 2) {
    return { ok: false, reason: `vue-tsc exited with unexpected status ${status} (expected 2 for TypeScript diagnostics)`, total, added: [], removed: [], baselineUpdate: null };
  }

  const entries = Object.fromEntries([...diagnostics.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const baselineUpdate = update
    ? { total, entries }
    : null;
  const added = [];
  const removed = [];

  if (!update && baselineEntries) {
    for (const [key, count] of diagnostics) {
      const allowed = baselineEntries[key] || 0;
      if (count > allowed) added.push(`${key} (+${count - allowed})`);
    }
    for (const key of Object.keys(baselineEntries)) {
      if (!diagnostics.has(key)) removed.push(key);
    }
  }

  return { ok: added.length === 0, reason: null, total, added, removed, baselineUpdate };
}
