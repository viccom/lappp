<template>
  <div class="flex flex-col h-screen bg-base-100 text-base-content">
    <!-- top bar: which graph, its root, whether it feeds the model -->
    <div class="shrink-0 border-b border-base-content/10">
      <div class="flex items-center gap-3 px-3 h-11 min-w-0">
        <span class="text-sm font-medium shrink-0">{{ t('household.title') }}</span>
        <select
          v-if="households.length > 1"
          class="select select-xs select-ghost max-w-48 font-medium shrink-0"
          :value="currentIndex"
          @change="switchGraph(valueOf($event))"
        >
          <option v-for="(household, index) in households" :key="household.id" :value="index">
            {{ household.name }}
          </option>
        </select>
        <span v-else-if="current" class="text-sm truncate min-w-0">{{ current.name }}</span>
        <span v-if="rootName" class="text-xs text-base-content/50 truncate min-w-0">
          {{ t('household.root') }}: {{ rootName }}
        </span>

        <div class="ml-auto flex items-center gap-3 shrink-0">
          <label
            v-if="current"
            class="flex items-center gap-1.5 text-xs text-base-content/60 cursor-pointer whitespace-nowrap"
          >
            <input
              type="checkbox"
              class="toggle toggle-xs"
              :checked="current.enabled"
              @change="toggleEnabled(($event.target as HTMLInputElement).checked)"
            />
            {{ t('household.used_for_vision') }}
          </label>
          <TButton
            :text="t('household.create_title')"
            :buttonSize="'small'"
            @click="openCreate"
          />
        </div>
      </div>
    </div>

    <!-- no graph yet: say what a graph is, and who is there to build one from -->
    <div v-if="!households.length" class="flex-1 overflow-y-auto p-6">
      <div class="mx-auto max-w-xl rounded-box border border-base-content/10 bg-base-200/40 p-5 flex flex-col gap-3">
        <div class="text-base font-medium">{{ t('household.no_graph_yet') }}</div>
        <div class="text-sm text-base-content/60 leading-6">{{ t('household.no_graph_hint') }}</div>

        <div v-if="namedFaces.length" class="flex flex-col gap-1.5">
          <div class="text-xs text-base-content/40">
            {{ t('household.people_available', { count: namedFaces.length }) }}
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="entry in namedFaces"
              :key="entry.name"
              class="inline-flex items-center gap-1.5 text-sm px-2 py-0.5 rounded-box bg-base-300/60"
            >
              {{ entry.name }}
              <span class="text-[11px] text-base-content/40">{{ entry.count ?? '' }}</span>
            </span>
          </div>
        </div>
        <div v-else class="text-sm text-error">{{ t('household.no_named_faces') }}</div>

        <div>
          <TButton
            :text="t('household.create_title')"
            buttonClasses="btn-primary"
            :disabled="!namedFaces.length"
            @click="openCreate"
          />
        </div>
      </div>
    </div>

    <!-- the graph: the people on the left, the rows in the middle -->
    <div v-else class="flex flex-1 min-h-0">
      <div class="w-60 shrink-0 border-r border-base-content/10 overflow-y-auto px-1 py-2 flex flex-col gap-0.5">
        <div class="px-2 py-1 text-[11px] uppercase tracking-wider text-base-content/40">
          {{ t('household.members') }} ({{ memberNodes.length }})
        </div>
        <button
          v-for="node in memberNodes"
          :key="node.id"
          type="button"
          class="sidebar-item gap-2 text-sm"
          :class="selectedNode?.id === node.id ? 'sidebar-item-selected' : 'sidebar-item-hover'"
          @click="selectNode(node.id)"
        >
          <span class="w-6 h-6 rounded-full bg-base-300/70 shrink-0 flex items-center justify-center">
            <IconPerson class="w-3.5 h-3.5 text-base-content/40" />
          </span>
          <span class="truncate">{{ nameOf(node.id) }}</span>
          <span
            v-if="node.id === current?.rootNodeId"
            class="ml-auto shrink-0 text-[10px] px-1 rounded-box bg-primary/15 text-primary"
          >{{ t('household.root') }}</span>
          <span v-else-if="node.term" class="ml-auto shrink-0 text-[11px] text-base-content/40">
            {{ node.term }}
          </span>
        </button>

        <template v-if="unjoined.length">
          <div class="divider my-1"></div>
          <div class="px-2 py-1 text-[11px] uppercase tracking-wider text-base-content/40">
            {{ t('household.not_joined') }} ({{ unjoined.length }})
          </div>
          <button
            v-for="entry in unjoined"
            :key="entry.name"
            type="button"
            class="sidebar-item gap-2 text-sm text-base-content/60"
            @click="join(entry.name)"
          >
            <span class="w-6 shrink-0 text-center text-base-content/40">+</span>
            <span class="truncate">{{ entry.name }}</span>
            <span class="ml-auto shrink-0 text-[11px] text-base-content/30">{{ entry.count ?? '' }}</span>
          </button>
        </template>
      </div>

      <div
        class="flex-1 min-w-0 overflow-hidden relative cursor-grab active:cursor-grabbing"
        @wheel.prevent="onWheel"
        @mousedown="onPanStart"
      >
        <svg
          :viewBox="viewBox"
          class="w-full h-full select-none"
          preserveAspectRatio="xMidYMid meet"
          @mousedown.self="clearSelection"
        >
          <g :transform="`translate(${offset.x} ${offset.y}) scale(${zoom})`">
            <!-- the links first, so the people are drawn over their ends -->
            <line
              v-for="drawn in drawnEdges"
              :key="drawn.key"
              :x1="drawn.x1" :y1="drawn.y1" :x2="drawn.x2" :y2="drawn.y2"
              :stroke-width="drawn.edge.kind === 'spouse' ? 2.5 : 1.5"
              :stroke-dasharray="drawn.edge.kind === 'social' ? '5 4' : undefined"
              :class="[
                drawn.edge.kind === 'spouse' ? 'stroke-primary/50' : 'stroke-base-content/30',
                touchesSelected(drawn.edge) ? '!stroke-primary' : '',
              ]"
            />
            <text
              v-for="drawn in drawnEdges.filter((entry) => entry.edge.kind === 'social')"
              :key="`label-${drawn.key}`"
              :x="(drawn.x1 + drawn.x2) / 2" :y="(drawn.y1 + drawn.y2) / 2 - 5"
              text-anchor="middle"
              class="fill-base-content/50 text-[11px]"
            >{{ t(`household.social_label.${drawn.edge.label}`) }}</text>

            <g
              v-for="node in memberNodes"
              :key="node.id"
              class="cursor-pointer"
              @click.stop="selectNode(node.id)"
              @mousedown.stop
            >
              <circle
                :cx="xOf(node.id)" :cy="yOf(node.id)" :r="NODE_R"
                :class="selectedNode?.id === node.id
                  ? 'fill-primary/20 stroke-primary'
                  : 'fill-base-200 stroke-base-content/30'"
                stroke-width="2"
              />
              <text
                :x="xOf(node.id)" :y="yOf(node.id) + NODE_R + 16"
                text-anchor="middle"
                class="fill-base-content text-[12px]"
              >{{ nameOf(node.id) }}</text>
              <text
                v-if="node.id === current?.rootNodeId"
                :x="xOf(node.id)" :y="yOf(node.id) - NODE_R - 7"
                text-anchor="middle"
                class="fill-primary text-[10px]"
              >{{ t('household.root') }}</text>
            </g>
          </g>
        </svg>

        <div class="absolute right-3 bottom-2 text-[11px] text-base-content/30 pointer-events-none">
          {{ t('household.canvas_hint') }}
        </div>
      </div>
    </div>

    <!-- the person that is selected: who they are, and the links to the others -->
    <div v-if="selectedNode" class="shrink-0 border-t border-base-content/10 px-3 py-2 flex flex-col gap-1.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm font-medium">{{ nameOf(selectedNode.id) }}</span>
        <span v-if="selectedNode.term" class="text-xs text-base-content/40">{{ selectedNode.term }}</span>

        <div class="ml-auto flex items-center gap-2 flex-wrap">
          <span class="text-xs text-base-content/50">{{ t('household.gender') }}</span>
          <select
            class="select select-xs"
            :value="editGender"
            @change="editGender = valueOf($event)"
          >
            <option value="unknown">{{ t('household.gender_unknown') }}</option>
            <option value="male">{{ t('household.gender_male') }}</option>
            <option value="female">{{ t('household.gender_female') }}</option>
          </select>
          <span class="text-xs text-base-content/50">{{ t('household.birth_year') }}</span>
          <input
            type="text"
            class="input input-xs w-20"
            :class="yearValid ? '' : 'input-error'"
            :value="editBirthYear"
            @input="editBirthYear = valueOf($event)"
          />
          <TButton
            :text="t('household.save_details')"
            :buttonSize="'small'"
            :disabled="!detailsDirty || !yearValid"
            @click="saveDetails"
          />
          <TButton
            v-if="selectedNode.id !== current?.rootNodeId"
            :text="t('household.make_root')"
            :buttonSize="'small'"
            @click="makeRoot"
          />
        </div>
      </div>

      <div class="flex items-center gap-x-5 gap-y-1.5 flex-wrap">
        <div v-for="group in linkGroups" :key="group.kind" class="flex items-center gap-1.5 flex-wrap">
          <span class="text-[11px] text-base-content/40">{{ t(group.labelKey) }}</span>
          <span
            v-for="link in group.links"
            :key="link.key"
            class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-box bg-base-300/60"
          >
            {{ nameOf(link.otherId) }}<template v-if="link.word">（{{ t(`household.social_label.${link.word}`) }}）</template>
            <button type="button" class="text-base-content/40 hover:text-error" @click="removeLink(link)">×</button>
          </span>
          <template v-if="candidatesFor(group.kind).length">
            <select
              v-if="group.kind === 'social'"
              class="select select-xs"
              :value="socialLabel"
              @change="socialLabel = valueOf($event)"
            >
              <option v-for="label in SOCIAL_LABELS" :key="label" :value="label">
                {{ t(`household.social_label.${label}`) }}
              </option>
            </select>
            <SearchableSelect
              :options="candidatesFor(group.kind).map((candidate) => ({ value: candidate, label: nameOf(candidate) }))"
              :placeholder="t('household.add')"
              :searchPlaceholder="t('household.search_names')"
              :emptyText="t('household.no_candidates')"
              @update:modelValue="(id) => addLink(group.kind, Number(id))"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- create a graph. A child of the page itself: it must open whether or
         not anybody is selected, and whether or not a graph exists. -->
    <ModalDialog
      v-if="showCreate"
      :title="t('household.create_title')"
      :width="460"
      @cancel="showCreate = false"
    >
      <div class="flex flex-col gap-1">
        <div class="text-xs text-base-content/50">{{ t('household.name') }}</div>
        <input
          type="text"
          class="input input-sm w-full"
          :value="draftName"
          :placeholder="t('household.name_hint')"
          @input="draftName = valueOf($event)"
        />

        <div class="text-xs text-base-content/50 mt-2">{{ t('household.root_choice') }}</div>
        <select class="select select-sm w-full" :value="draftRoot" @change="draftRoot = valueOf($event)">
          <option value="">{{ t('household.choose_one') }}</option>
          <option v-for="entry in namedFaces" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
        </select>

        <div class="text-xs text-base-content/50 mt-2">{{ t('household.members_choice') }}</div>
        <div class="max-h-36 overflow-y-auto rounded-box border border-base-content/10 p-1 flex flex-col gap-0.5">
          <label
            v-for="entry in namedFaces"
            :key="entry.name"
            class="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              :checked="draftMembers.includes(entry.name)"
              @change="toggleDraftMember(entry.name, ($event.target as HTMLInputElement).checked)"
            />
            <span class="truncate">{{ entry.name }}</span>
          </label>
        </div>

        <div class="text-xs text-base-content/50 mt-2">{{ t('household.albums') }}</div>
        <div class="max-h-28 overflow-y-auto rounded-box border border-base-content/10 p-1 flex flex-col gap-0.5">
          <label
            v-for="album in albumChoices"
            :key="album.id"
            class="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer"
          >
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              :checked="draftAlbums.includes(album.id)"
              @change="toggleDraftAlbum(album.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="truncate">{{ album.name }}</span>
          </label>
        </div>
        <div class="text-[11px] text-base-content/40 leading-4">{{ t('household.albums_hint') }}</div>

        <div class="flex justify-end gap-2 mt-3">
          <TButton :text="t('msgbox.cancel')" @click="showCreate = false" />
          <TButton
            :text="t('household.create_confirm')"
            buttonClasses="btn-primary"
            :disabled="!canCreate"
            @click="submitCreate"
          />
        </div>
      </div>
    </ModalDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPerson } from '@/common/icons';
import ModalDialog from '@/components/ModalDialog.vue';
import SearchableSelect from '@/components/SearchableSelect.vue';
import TButton from '@/components/TButton.vue';
import { useHousehold } from '@/composables/useHousehold';
import {
  createHousehold,
  importHouseholdNodes,
  listAlbumChoices,
  setHouseholdEdges,
  setHouseholdMembers,
  updateHousehold,
  upsertHouseholdNode,
} from '@/common/householdApi';
import {
  LAYOUT_GAP,
  LAYOUT_MARGIN,
  SOCIAL_LABELS,
  birthYearOf,
  edgePayload,
  facesOutsideGraph,
  groupLinks,
  layoutPositions,
  linkKey,
  makeLink,
  nodeWithDetails,
} from '@/common/householdGraph';

const { t } = useI18n();
const { overview, faceNames, reload, nameOf } = useHousehold();

const NODE_R = 28;

const currentIndex = ref(0);
const selectedNodeId = ref<number | null>(null);
const socialLabel = ref('classmate');
const zoom = ref(1);
const offset = ref({ x: 0, y: 0 });

/** The value of whatever the user just changed. */
function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

// ---- what the page shows ----

const households = computed<any[]>(() => overview.value?.households ?? []);
const current = computed<any>(() => households.value[currentIndex.value] ?? null);

const memberNodes = computed<any[]>(() => {
  const members = new Set<number>(current.value?.memberIds ?? []);
  return (overview.value?.nodes ?? []).filter((node: any) => members.has(node.id));
});

const rootName = computed(() =>
  current.value?.rootNodeId != null ? nameOf(current.value.rootNodeId) : '',
);

/** Every link that touches a member: the set the library replaces as a whole. */
const graphEdges = computed<any[]>(() => {
  const members = new Set<number>(current.value?.memberIds ?? []);
  return (overview.value?.edges ?? []).filter(
    (edge: any) => members.has(edge.fromNode) || members.has(edge.toNode),
  );
});

const selectedNode = computed(
  () => memberNodes.value.find((node: any) => node.id === selectedNodeId.value) ?? null,
);

/** The names a graph can be built from: the ones the user gave the faces. */
const namedFaces = computed<any[]>(() => faceNames.value);

/** The faces that could still join: new people, and people in another graph. */
const unjoined = computed(() =>
  facesOutsideGraph(
    faceNames.value,
    overview.value?.nodes ?? [],
    current.value?.memberIds ?? [],
  ),
);

// ---- the canvas ----

const layout = computed(() => layoutPositions(memberNodes.value, graphEdges.value));

function xOf(id: number): number {
  return layout.value.pos.get(id)?.x ?? LAYOUT_MARGIN;
}

function yOf(id: number): number {
  return (layout.value.pos.get(id)?.row ?? 0) * LAYOUT_GAP + LAYOUT_MARGIN;
}

/** The links between two people of the graph, as lines on the canvas. */
const drawnEdges = computed(() => {
  const members = new Set(memberNodes.value.map((node: any) => node.id));
  return graphEdges.value
    .filter((edge: any) => members.has(edge.fromNode) && members.has(edge.toNode))
    .map((edge: any) => ({
      key: linkKey(edge),
      edge,
      x1: xOf(edge.fromNode),
      y1: yOf(edge.fromNode),
      x2: xOf(edge.toNode),
      y2: yOf(edge.toNode),
    }));
});

const viewBox = computed(() => {
  const xs = memberNodes.value.map((node: any) => xOf(node.id));
  const minX = Math.min(...xs, LAYOUT_MARGIN) - LAYOUT_MARGIN;
  const maxX = Math.max(...xs, LAYOUT_MARGIN) + LAYOUT_MARGIN;
  // A small graph is not blown up to fill the window.
  const width = Math.max(760, maxX - minX);
  const rows = Math.max(2, layout.value.rows.length);
  const left = minX - (width - (maxX - minX)) / 2;
  return `${left} 0 ${width} ${rows * LAYOUT_GAP + LAYOUT_MARGIN}`;
});

function touchesSelected(edge: any): boolean {
  return selectedNodeId.value != null
    && (edge.fromNode === selectedNodeId.value || edge.toNode === selectedNodeId.value);
}

function selectNode(id: number) {
  selectedNodeId.value = id;
}

function clearSelection() {
  selectedNodeId.value = null;
}

function onWheel(event: WheelEvent) {
  const next = zoom.value * (event.deltaY > 0 ? 0.9 : 1.1);
  zoom.value = Math.min(2.5, Math.max(0.4, next));
}

let panning: { x: number; y: number; startX: number; startY: number } | null = null;

function onPanStart(event: MouseEvent) {
  // A click on a person must not start a drag of the canvas.
  if (event.target !== event.currentTarget) return;
  panning = { x: offset.value.x, y: offset.value.y, startX: event.clientX, startY: event.clientY };
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanEnd);
}

function onPanMove(event: MouseEvent) {
  if (!panning) return;
  offset.value = {
    x: panning.x + (event.clientX - panning.startX),
    y: panning.y + (event.clientY - panning.startY),
  };
}

function onPanEnd() {
  panning = null;
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanEnd);
}

onBeforeUnmount(onPanEnd);

// ---- the links of the selected person ----

const linkGroups = computed(() =>
  selectedNode.value ? groupLinks(graphEdges.value, selectedNode.value.id) : [],
);

/** The people a new link of this group could point at. */
function candidatesFor(kind: string): number[] {
  if (!selectedNode.value) return [];
  const group = linkGroups.value.find((entry) => entry.kind === kind);
  const linked = new Set<number>(group?.links.map((link: any) => link.otherId) ?? []);
  return memberNodes.value
    .map((node: any) => node.id)
    .filter((id: number) => id !== selectedNode.value?.id && !linked.has(id));
}

async function addLink(kind: string, otherId: number) {
  if (!selectedNode.value) return;
  const draft = makeLink(kind, selectedNode.value.id, otherId, socialLabel.value);
  if (!draft) return;
  await writeEdges([...graphEdges.value.map(edgePayload), draft]);
}

async function removeLink(link: any) {
  await writeEdges(graphEdges.value.filter((edge: any) => linkKey(edge) !== link.key).map(edgePayload));
}

/**
 * Write the links of the graph as one batch, then read it back: the library
 * normalises them, and the page shows what it actually holds.
 *
 * The command returns nothing either way, so the wrapper says true when the
 * library took the batch; anything else leaves the page as it was.
 */
async function writeEdges(edges: any[]) {
  const household = current.value;
  if (!household) return;
  const written = await setHouseholdEdges(household.id, edges);
  if (written !== true) return;
  await reload();
}

// ---- who the person is ----

const editGender = ref('unknown');
const editBirthYear = ref('');

watch(
  selectedNode,
  (node) => {
    editGender.value = node?.gender || 'unknown';
    editBirthYear.value = node?.birthDate ? String(birthYearOf(node.birthDate) ?? '') : '';
  },
  { immediate: true },
);

/** A year is four digits, or nothing. */
const yearValid = computed(
  () => editBirthYear.value.trim() === ''
    || String(birthYearOf(editBirthYear.value)) === editBirthYear.value.trim(),
);

const detailsDirty = computed(() => {
  const node = selectedNode.value;
  if (!node) return false;
  const year = editBirthYear.value.trim();
  return editGender.value !== (node.gender || 'unknown')
    || year !== String(birthYearOf(node.birthDate) ?? '');
});

async function saveDetails() {
  const node = selectedNode.value;
  if (!node || !detailsDirty.value || !yearValid.value) return;
  const written = await upsertHouseholdNode(
    nodeWithDetails(node, {
      gender: editGender.value,
      birthYear: editBirthYear.value.trim() === '' ? null : birthYearOf(editBirthYear.value),
    }),
  );
  if (written === null) return;
  await reload();
}

async function makeRoot() {
  const household = current.value;
  if (!household || !selectedNode.value) return;
  const written = await updateHousehold(household.id, { rootNodeId: selectedNode.value.id });
  if (written !== true) return;
  await reload();
}

// ---- the graph itself ----

function switchGraph(index: string) {
  currentIndex.value = Number(index);
  selectedNodeId.value = null;
}

async function toggleEnabled(enabled: boolean) {
  const household = current.value;
  if (!household) return;
  const written = await updateHousehold(household.id, { enabled });
  if (written !== true) return;
  await reload();
}

/** Bring a name in as a person, and into this graph. */
async function join(name: string) {
  const household = current.value;
  if (!household) return;
  const ids = await importHouseholdNodes([name]);
  if (!Array.isArray(ids) || !ids.length) return;
  const members = new Set<number>(household.memberIds ?? []);
  for (const id of ids) members.add(Number(id));
  const written = await setHouseholdMembers(household.id, [...members]);
  if (written !== true) return;
  await reload();
}

// ---- creating a graph ----

const showCreate = ref(false);
const draftName = ref('');
const draftRoot = ref('');
const draftMembers = ref<string[]>([]);
const draftAlbums = ref<number[]>([]);
const albumChoices = ref<Array<{ id: number; name: string }>>([]);

const canCreate = computed(() => Boolean(draftRoot.value) && draftName.value.trim().length > 0);

function toggleDraftMember(name: string, checked: boolean) {
  draftMembers.value = checked
    ? [...new Set([...draftMembers.value, name])]
    : draftMembers.value.filter((entry) => entry !== name);
}

function toggleDraftAlbum(id: number, checked: boolean) {
  draftAlbums.value = checked
    ? [...new Set([...draftAlbums.value, id])]
    : draftAlbums.value.filter((entry) => entry !== id);
}

async function openCreate() {
  draftRoot.value = '';
  draftName.value = '';
  draftMembers.value = namedFaces.value.map((entry: any) => entry.name);
  showCreate.value = true;
  if (!albumChoices.value.length) {
    albumChoices.value = await listAlbumChoices();
  }
  draftAlbums.value = albumChoices.value.map((album) => album.id);
}

// The name follows the root, until the user types one of their own.
watch(draftRoot, (root) => {
  const typed = draftName.value;
  if (root && (typed === '' || /^[^\s家]+家$/.test(typed))) {
    draftName.value = `${root}${t('household.name_suffix')}`;
  }
});

async function submitCreate() {
  if (!canCreate.value) return;
  // The root belongs to the graph whether or not it was ticked.
  const members = [...new Set([...draftMembers.value, draftRoot.value])];
  const created = await createHousehold(
    draftName.value.trim(),
    draftAlbums.value,
    draftRoot.value,
    members,
  );
  if (created === null) return;
  showCreate.value = false;
  await reload();
  const index = households.value.findIndex((household: any) => household.id === created);
  currentIndex.value = index >= 0 ? index : 0;
  selectedNodeId.value = null;
}

watch(households, () => {
  if (currentIndex.value >= households.value.length) currentIndex.value = 0;
});

onMounted(reload);
</script>
