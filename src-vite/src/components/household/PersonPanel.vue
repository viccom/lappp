<template>
  <div class="hh-panel" data-role="person-panel">
    <!-- who -->
    <header>
      <PersonFace :src="thumbnail" :size="56" />
      <div class="min-w-0 flex-1">
        <div class="hh-panel-name" data-role="person-name">{{ name }}</div>
        <div class="hh-panel-sub">
          <span v-if="isRoot" class="hh-badge" data-role="root-badge">{{ t('household.root') }}</span>
          <span v-if="term" class="hh-primary-text" data-role="person-term">{{ term }}</span>
          <span v-if="birthYear">{{ birthYear }}</span>
        </div>
      </div>
      <TButton :icon="IconClose" :buttonSize="'small'" :tooltip="t('household.close_card')" data-role="close-person" @click="emit('close')" />
    </header>

    <!-- what is known of them: saved as soon as it changes -->
    <section class="hh-section" data-role="attributes">
      <h3 class="hh-title">
        <span>{{ t('household.attributes') }}</span>
        <span v-if="saveState !== 'idle'" class="hh-save" :data-state="saveState" data-role="save-state">{{ saveWord }}</span>
      </h3>
      <div class="hh-field">
        <span class="hh-label">{{ t('household.gender') }}</span>
        <div class="hh-seg" role="group" :aria-label="t('household.gender')" data-role="gender">
          <button
            v-for="option in GENDERS"
            :key="option"
            type="button"
            :data-gender="option"
            :aria-pressed="gender === option"
            @click="emit('save', { gender: option })"
          >{{ t(`household.gender_${option}`) }}</button>
        </div>
      </div>
      <label class="hh-field">
        <span class="hh-label">{{ t('household.birth_year') }}</span>
        <input
          type="text"
          inputmode="numeric"
          maxlength="4"
          class="input hh-input"
          :class="{ 'input-error': yearBad }"
          :data-invalid="yearBad ? 'true' : undefined"
          data-role="birth-year"
          :value="yearText"
          @input="yearText = ($event.target as HTMLInputElement).value"
          @change="setYear($event)"
        />
      </label>
      <p v-if="yearBad" class="hh-field-note">{{ t('household.year_invalid') }}</p>
      <label class="hh-field">
        <span class="hh-label">{{ t('household.birth_place') }}</span>
        <input
          type="text"
          class="input hh-input"
          data-role="birth-place"
          :value="node.birthPlace ?? ''"
          @change="emit('save', { birthPlace: ($event.target as HTMLInputElement).value })"
        />
      </label>
      <label class="hh-field hh-field-stack">
        <span class="hh-label">{{ t('household.notes') }}</span>
        <textarea
          rows="2"
          class="textarea hh-input"
          data-role="notes"
          :value="node.notes ?? ''"
          @change="emit('save', { notes: ($event.target as HTMLTextAreaElement).value })"
        ></textarea>
      </label>
      <label class="hh-check">
        <input
          type="checkbox"
          class="toggle toggle-xs"
          data-role="share-age"
          :checked="node.shareAge !== false"
          @change="emit('save', { shareAge: ($event.target as HTMLInputElement).checked })"
        />
        <span>{{ t('household.share_age') }}</span>
      </label>
      <label class="hh-check">
        <input
          type="checkbox"
          class="toggle toggle-xs"
          data-role="share-details"
          :checked="node.shareDetails === true"
          @change="emit('save', { shareDetails: ($event.target as HTMLInputElement).checked })"
        />
        <span>{{ t('household.share_details') }}</span>
      </label>
    </section>

    <!-- who they are to the others, and the others to them -->
    <section v-for="group in groups" :key="group.kind" class="hh-section hh-group" data-role="group" :data-group="group.kind">
      <h3 class="hh-title">
        <span>{{ t(group.labelKey) }}</span>
        <span class="hh-count" data-role="group-count">{{ group.links.length }}</span>
        <button
          type="button"
          class="hh-add"
          data-role="add-link"
          :data-group="group.kind"
          :aria-expanded="openGroup === group.kind"
          @click="emit('toggle-picker', group.kind)"
        >
          <IconAdd class="w-3.5 h-3.5" />{{ t('household.add') }}
        </button>
      </h3>

      <div
        v-for="link in group.links"
        :key="link.key"
        class="hh-link"
        :data-link="group.kind"
        :data-name="nameOf(link.otherId)"
        :data-other="link.otherId"
      >
        <PersonFace :src="thumbOf(link.otherId)" :size="26" />
        <button type="button" class="hh-link-name" @click="emit('select', link.otherId)">{{ nameOf(link.otherId) }}</button>
        <span class="hh-word">{{ wordOf(group.kind, link) }}</span>
        <button
          type="button"
          class="hh-x"
          data-role="remove-link"
          :aria-label="t('household.remove_link')"
          :title="t('household.remove_link')"
          @click="emit('remove-link', link)"
        >×</button>
      </div>
      <p v-if="!group.links.length && openGroup !== group.kind" class="hh-empty">{{ t(`household.none_${group.kind}`) }}</p>

      <div v-if="openGroup === group.kind" :ref="setPicker" class="hh-picker" data-role="picker" :data-group="group.kind">
        <div v-if="group.kind === 'social'" class="hh-chips" data-role="social-labels">
          <span class="hh-label">{{ t('household.social_is') }}</span>
          <button
            v-for="label in SOCIAL_LABELS"
            :key="label"
            type="button"
            data-role="social-label"
            :data-social-label="label"
            :aria-pressed="socialLabel === label"
            @click="socialLabel = label"
          >{{ t(`household.social_label.${label}`) }}</button>
        </div>
        <PersonPicker
          :rows="candidates[group.kind] ?? []"
          :placeholder="t('household.search_names')"
          :empty-text="t('household.no_candidates')"
          @pick="choose(group.kind, $event)"
        />
      </div>
    </section>

    <!-- what can be done with them -->
    <footer class="hh-actions">
      <button v-if="!isRoot" type="button" class="hh-btn hh-btn-primary" data-role="make-root" @click="emit('make-root')">
        <IconFlag class="w-4 h-4" />{{ t('household.make_root') }}
      </button>
      <button
        v-if="!isRoot"
        type="button"
        class="hh-btn"
        :class="{ 'hh-btn-danger': removing }"
        data-role="remove-person"
        @click="askRemove"
      >
        <IconTrash v-if="!removing" class="w-4 h-4" />{{ removing ? t(elsewhere ? 'household.remove_person_kept' : 'household.remove_person_confirm') : t('household.remove_person') }}
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconAdd, IconClose, IconFlag, IconTrash } from '@/common/icons';
import TButton from '@/components/TButton.vue';
import PersonFace from './PersonFace.vue';
import PersonPicker from './PersonPicker.vue';
import { SOCIAL_LABELS, kinKey } from '@/common/householdGraph';

/**
 * The card of the person that is selected: who they are, what is known of
 * them, and everybody they are linked to.
 *
 * The card changes nothing itself. It says what the user did, and shows what
 * the library holds once the page has written it and read it back.
 */
const props = defineProps({
  /** The object as the overview gives it. */
  node: { type: Object as () => Record<string, any>, required: true },
  name: { type: String, default: '' },
  /** What they are to the root of the graph. */
  term: { type: String as () => string | null, default: null },
  thumbnail: { type: String as () => string | null, default: null },
  isRoot: { type: Boolean, default: false },
  /** The four groups of links, as `groupLinks` makes them. */
  groups: { type: Array as () => Array<Record<string, any>>, default: () => [] },
  /** For each group, the people a new link of that group could point at. */
  candidates: { type: Object as () => Record<string, Array<Record<string, any>>>, default: () => ({}) },
  /** Everybody of the graph, by id: the name, the face and what is known of them. */
  members: { type: Object as () => Record<number, Record<string, any>>, default: () => ({}) },
  /** The group whose picker is open, or null. */
  openGroup: { type: String as () => string | null, default: null },
  /** The person is in another graph too: taking them out of this one leaves their links. */
  elsewhere: { type: Boolean, default: false },
  saveState: { type: String, default: 'idle' },
});
const emit = defineEmits(['close', 'save', 'select', 'add-link', 'remove-link', 'toggle-picker', 'make-root', 'remove-person']);

const { t } = useI18n();
const GENDERS = ['unknown', 'male', 'female'];
const UNKNOWN_GENDER = 'unknown';

const gender = computed(() => props.node.gender || UNKNOWN_GENDER);
const birthYear = computed(() => (/^\d{4}$/.exec(String(props.node.birthDate ?? '').trim()) ?? [])[0] ?? null);
const nameOf = (id: number) => props.members[id]?.name ?? String(id);
const thumbOf = (id: number) => props.members[id]?.thumbnail ?? null;

/** The word for somebody linked directly: the father, a daughter, a teacher. */
function wordOf(group: string, link: Record<string, any>): string {
  if (group === 'social') return link.word ? t(`household.social_label.${link.word}`) : '';
  const key = kinKey(group, props.members[link.otherId]);
  return key ? t(key) : '';
}

// ---- the year, typed ----

const yearText = ref(birthYear.value ?? '');
watch(birthYear, (year) => {
  yearText.value = year ?? '';
});
const yearBad = computed(() => yearText.value.trim() !== '' && !/^\d{4}$/.test(yearText.value.trim()));

function setYear(event: Event) {
  // What is in the field now, not what the last keystroke had left there.
  yearText.value = (event.target as HTMLInputElement).value;
  if (yearBad.value) return;
  const year = yearText.value.trim();
  emit('save', { birthYear: year === '' ? null : Number(year) });
}

// ---- the picker ----

const socialLabel = ref('classmate');

// A list that opens under the last group is below the edge of the panel:
// bring it into view.
let pickerElement: HTMLElement | null = null;

function setPicker(element: unknown) {
  pickerElement = element as HTMLElement | null;
}

watch(() => props.openGroup, async (group) => {
  if (!group) return;
  await nextTick();
  pickerElement?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
});

function choose(group: string, row: Record<string, any>) {
  emit('add-link', { group, nodeId: row.nodeId ?? null, name: row.name, label: socialLabel.value });
}

// ---- taking the person out: one click asks, the next one does ----

const removing = ref(false);
let forget: ReturnType<typeof setTimeout> | null = null;

function askRemove() {
  if (removing.value) {
    removing.value = false;
    emit('remove-person');
    return;
  }
  removing.value = true;
  forget = setTimeout(() => {
    removing.value = false;
  }, 4000);
}

// Another person is not the one that was to be taken out.
watch(() => props.node.id, () => {
  removing.value = false;
});

onBeforeUnmount(() => {
  if (forget) clearTimeout(forget);
});

const saveWord = computed(() => ({
  saving: t('household.saving'),
  saved: t('household.saved'),
  error: t('household.save_failed'),
}[props.saveState] ?? ''));
</script>
