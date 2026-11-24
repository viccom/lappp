<template>
  <div
    ref="host"
    class="relative h-full w-full overflow-hidden bg-base-100"
    data-role="canvas"
    @wheel.prevent="onWheel"
    @pointerdown="panStart"
    @pointermove="panMove"
    @pointerup="panEnd"
    @pointercancel="panEnd"
  >
    <svg
      class="block h-full w-full touch-none select-none"
      :viewBox="`0 0 ${size.width || 1} ${size.height || 1}`"
      preserveAspectRatio="none"
    >
      <g :transform="`translate(${view.offset.x} ${view.offset.y}) scale(${view.zoom})`">
        <!-- the lines first, so the people are drawn over their ends -->
        <path
          v-for="family in lines.families"
          :key="`family-${family.key}`"
          class="hh-line"
          :class="{ 'hh-line-on': touches(family.parents) || touches(family.children) }"
          :d="familyPath(family)"
          data-line="family"
          :data-parents="family.parents.join(',')"
          :data-children="family.children.join(',')"
        />
        <line
          v-for="line in lines.couples"
          :key="`couple-${line.key}`"
          class="hh-line hh-line-couple"
          :class="{ 'hh-line-on': touches([line.a, line.b]) }"
          :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2"
          :stroke-dasharray="line.ended ? '4 4' : undefined"
          data-line="couple"
          :data-a="line.a"
          :data-b="line.b"
        />
        <line
          v-for="line in lines.others"
          :key="`other-${line.key}`"
          class="hh-line hh-line-other"
          :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2"
          data-line="other"
        />
        <g
          v-for="line in lines.socials"
          :key="`social-${line.key}`"
          class="hh-social"
          :class="{ 'hh-line-on': touches([line.a, line.b]) }"
          data-line="social"
          :data-a="line.a"
          :data-b="line.b"
          :data-label="line.label ?? ''"
        >
          <path class="hh-line hh-line-social" :d="line.d" :marker-end="line.directed ? 'url(#hh-arrow)' : undefined" />
          <rect class="hh-word-bg" :x="line.lx - labelWidth(line) / 2 - 6" :y="line.ly - 9" :width="labelWidth(line) + 12" height="18" rx="9" />
          <text class="hh-word" :x="line.lx" :y="line.ly + 4" text-anchor="middle">{{ labelOf(line) }}</text>
        </g>

        <g
          v-for="person in people"
          :key="person.id"
          class="hh-person"
          :class="{ 'is-selected': person.id === selectedId }"
          :transform="`translate(${person.x} ${person.y})`"
          role="button"
          tabindex="0"
          :aria-label="person.name"
          data-person
          :data-node-id="person.id"
          :data-name="person.name"
          :data-row="person.row"
          :data-x="person.x"
          @click.stop="emit('select', person.id)"
          @keydown.enter.prevent="emit('select', person.id)"
        >
          <circle class="hh-halo" :cy="AVATAR_DY" :r="AVATAR_R + 7" />
          <clipPath :id="`hh-face-${person.id}`"><circle :cy="AVATAR_DY" :r="AVATAR_R - 2.5" /></clipPath>
          <circle class="hh-ring" :class="`hh-ring-${person.gender}`" :cy="AVATAR_DY" :r="AVATAR_R" />
          <image
            v-if="person.thumbnail && !failed.has(person.id)"
            :href="person.thumbnail"
            :x="2 - AVATAR_R" :y="AVATAR_DY + 2 - AVATAR_R"
            :width="2 * AVATAR_R - 4" :height="2 * AVATAR_R - 4"
            preserveAspectRatio="xMidYMid slice"
            :clip-path="`url(#hh-face-${person.id})`"
            @error="failed.add(person.id)"
          />
          <path v-else class="hh-silhouette" data-role="silhouette" :d="SILHOUETTE" />
          <text class="hh-name" y="33">{{ person.name }}</text>
          <text v-if="person.term" class="hh-term" y="48">{{ person.term }}</text>
          <g v-if="person.isRoot" class="hh-root" data-role="root-badge" transform="translate(0 -62)">
            <rect x="-11" y="-9" width="22" height="17" rx="8.5" />
            <text y="4">{{ root }}</text>
          </g>
        </g>
      </g>
      <defs>
        <marker id="hh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0.5L9 5L0 9.5z" class="hh-arrow" />
        </marker>
      </defs>
    </svg>

    <!-- how to start, when there is nothing drawn yet -->
    <div v-if="bare && people.length" class="hh-hint">{{ t('household.no_links_hint') }}</div>

    <div class="hh-zoom">
      <button type="button" class="hh-tool" data-role="zoom-out" :title="t('household.zoom_out')" :aria-label="t('household.zoom_out')" @click="zoomBy(1 / 1.2)">
        <IconZoomOut class="w-4 h-4" />
      </button>
      <button type="button" class="hh-tool hh-tool-wide" data-role="zoom-fit" :title="t('household.zoom_fit')" @click="fit()">{{ Math.round(view.zoom * 100) }}%</button>
      <button type="button" class="hh-tool" data-role="zoom-in" :title="t('household.zoom_in')" :aria-label="t('household.zoom_in')" @click="zoomBy(1.2)">
        <IconZoomIn class="w-4 h-4" />
      </button>
    </div>
    <div class="hh-canvas-note pointer-events-none">{{ t('household.canvas_hint') }}</div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconZoomIn, IconZoomOut } from '@/common/icons';
import { AVATAR_DY, AVATAR_R, fitView } from '@/common/householdGraph';

/**
 * The graph as a family tree: a face and a name for everybody, the lines
 * between them, moved and sized to show all of it.
 *
 * The places and the lines are worked out before this gets them; all it does
 * is draw them, and keep them in view.
 */
const props = defineProps({
  /** `{ id, name, term, gender, thumbnail, isRoot, x, y, row }` */
  people: { type: Array as () => Array<Record<string, any>>, default: () => [] },
  /** What `drawLines` made of the links. */
  lines: { type: Object as () => Record<string, any[]>, default: () => ({ couples: [], families: [], socials: [], others: [] }) },
  /** How far the picture reaches, with a little air round it. */
  bounds: { type: Object as () => { left: number; top: number; right: number; bottom: number } | null, default: null },
  selectedId: { type: Number as () => number | null, default: null },
  /** No links at all yet: say how to make the first one. */
  bare: { type: Boolean, default: false },
});
const emit = defineEmits(['select', 'clear']);

const { t } = useI18n();
const root = t('household.root');

const MIN_ZOOM = 0.25;
/** A small family is drawn a little larger than life: the faces and the names stay sharp. */
const MAX_ZOOM = 2.5;
const FIT_ZOOM = 1.5;
/** The outline of somebody whose face the library does not keep. */
const SILHOUETTE = 'M0 -30a14 14 0 1 1 0 28a14 14 0 1 1 0 -28zM-24 16c0-12 10.5-19 24-19s24 7 24 19z';

const host = ref<HTMLElement | null>(null);
const size = reactive({ width: 0, height: 0 });
const view = reactive<{ zoom: number; offset: { x: number; y: number } }>({ zoom: 1, offset: { x: 0, y: 0 } });
const failed = reactive(new Set<number>());
let observer: ResizeObserver | null = null;

/** Show the whole picture, in the middle of the window. */
function fit() {
  Object.assign(view, fitView(props.bounds, { width: size.width, height: size.height }, { padding: 44, maxZoom: FIT_ZOOM }));
}

function zoomBy(factor: number) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  // The middle of the window stays where it is.
  view.offset = {
    x: size.width / 2 - (size.width / 2 - view.offset.x) * (next / view.zoom),
    y: size.height / 2 - (size.height / 2 - view.offset.y) * (next / view.zoom),
  };
  view.zoom = next;
}

function onWheel(event: WheelEvent) {
  if (!host.value) return;
  const box = host.value.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
  // The point under the cursor stays under it.
  view.offset = {
    x: x - (x - view.offset.x) * (next / view.zoom),
    y: y - (y - view.offset.y) * (next / view.zoom),
  };
  view.zoom = next;
}

// A press on the canvas where nobody is: it may become a drag, or just a click.
let drag: { x: number; y: number; startX: number; startY: number; pointer: number; moved: boolean } | null = null;

function panStart(event: PointerEvent) {
  // A person and the tools take their own clicks.
  if ((event.target as Element).closest('[data-person], button, input')) return;
  drag = { x: view.offset.x, y: view.offset.y, startX: event.clientX, startY: event.clientY, pointer: event.pointerId, moved: false };
  host.value?.setPointerCapture(event.pointerId);
}

function panMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  // A hand is never perfectly still: a few pixels are still a click.
  if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
  view.offset = { x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY };
}

function panEnd(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  // The canvas holds the pointer from the press to the release, so the click
  // that follows comes to it rather than to what was pressed on: a press that
  // never moved is how "put the card away" is said here.
  const clicked = !drag.moved;
  drag = null;
  if (clicked) emit('clear');
}

const touches = (ids: number[]) => props.selectedId != null && ids.includes(props.selectedId);

/** The line from the parents down to their children, as one stroke. */
function familyPath(family: any): string {
  return [
    ...family.drops.map((part: any) => `M${part.x} ${part.y1}V${part.y2}`),
    ...family.joins.map((part: any) => `M${part.x1} ${part.y}H${part.x2}`),
    ...(family.stem ? [`M${family.stem.x} ${family.stem.y1}V${family.stem.y2}`] : []),
    ...(family.bar ? [`M${family.bar.x1} ${family.bar.y}H${family.bar.x2}`] : []),
    ...family.stubs.map((part: any) => `M${part.x} ${part.y1}V${part.y2}`),
  ].join('');
}

/** The word on a social link: what the two are to each other. */
function labelOf(line: any): string {
  return t(`household.line_label.${line.label}`);
}

/** How much room that word takes, to put a pill of the right size behind it. */
function labelWidth(line: any): number {
  const width = [...labelOf(line)].reduce((sum, sign) => sum + (sign.charCodeAt(0) > 0x2e80 ? 11 : 6.4), 0);
  return Math.ceil(width);
}

function measure() {
  size.width = host.value?.clientWidth ?? 0;
  size.height = host.value?.clientHeight ?? 0;
}

// The picture changes shape when somebody joins or a link is made or taken
// away: show all of it again. A year of birth that is typed does not change the
// shape, and must not throw away where the user has moved the picture.
watch(
  () => [
    props.people.map((person) => `${person.id}:${person.name}`),
    props.lines.couples?.map((line: any) => line.key),
    props.lines.families?.map((line: any) => line.key),
    props.lines.socials?.map((line: any) => line.key),
  ].flat().join('|'),
  () => fit(),
);

onMounted(() => {
  measure();
  fit();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      measure();
      fit();
    });
    if (host.value) observer.observe(host.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<style src="./household.css"></style>
