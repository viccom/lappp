// Opening the graph page: a window of its own in the desktop app, a route in
// the browser. The same shape the montage and the editor use.
import { transportMode } from '@/common/transport';
import { webRouteForWindowLabel, webviewWindow } from '@/common/transport/window';

const LABEL = 'household';

/**
 * Open the graph page, or bring the open one to the front.
 *
 * @param personId the person to select once the page is open
 */
export async function openHouseholdWindow(personId?: number | null, title?: string): Promise<void> {
  const query = personId != null ? `?personId=${personId}` : '';

  // Browser: no second windows; the page is a route carrying the same query.
  if (transportMode === 'http') {
    const route = webRouteForWindowLabel(LABEL);
    if (!route) return;
    const { default: router } = await import('@/common/router');
    await router.push(`${route}${query}`);
    return;
  }

  const openWindow = await webviewWindow().getByLabel(LABEL);
  if (openWindow) {
    await openWindow.unminimize();
    await openWindow.setFocus();
    // Selecting another person in the main window should move the page too.
    if (personId != null && typeof openWindow.emit === 'function') {
      await openWindow.emit('household-select', { personId });
    }
    return;
  }

  const created = webviewWindow().create(LABEL, {
    url: `/household${query}`,
    title: title || 'Family graph',
    width: 1100,
    height: 760,
    minWidth: 820,
    minHeight: 560,
  });
  await new Promise<void>((resolve) => {
    created.once('tauri://created', () => {
      created.show();
      resolve();
    });
    created.once('tauri://error', () => resolve());
  });
}
