// The graph of a library, shared by the page and the two fused views.
//
// A library without the tables of the module answers null: everything that
// shows a graph asks this and renders nothing when it is empty.
import { ref, computed } from 'vue';
import { getHouseholdOverview } from '@/common/householdApi';
import { listFaceNamesForHousehold } from '@/common/householdApi';

/** The overview of the graphs of one library. */
export function useHousehold() {
  const overview = ref<any>(null);
  const faceNames = ref<any[]>([]);
  const loading = ref(false);

  async function reload() {
    loading.value = true;
    try {
      const [next, names] = await Promise.all([
        getHouseholdOverview(),
        listFaceNamesForHousehold(),
      ]);
      overview.value = next ?? null;
      faceNames.value = Array.isArray(names) ? names : [];
    } finally {
      loading.value = false;
    }
  }

  /** Whether this library has any graph at all. */
  const hasGraph = computed(() => Boolean(overview.value?.households?.length));

  /** The people of the graph, by id. */
  const nodeById = computed(() => {
    const map = new Map<number, any>();
    for (const node of overview.value?.nodes ?? []) map.set(node.id, node);
    return map;
  });

  /** The name to show for an object: the user's word for them, or their face name. */
  function nameOf(nodeId: number) {
    const node = nodeById.value.get(nodeId);
    if (!node) return String(nodeId);
    return node.displayName || node.anchors?.[0] || String(nodeId);
  }

  return { overview, faceNames, loading, reload, hasGraph, nodeById, nameOf };
}
