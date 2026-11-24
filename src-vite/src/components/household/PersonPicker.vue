<template>
  <div class="flex flex-col gap-1.5" data-role="person-picker">
    <div v-if="!grid" class="relative">
      <IconSearch class="absolute left-2 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-base-content/40 pointer-events-none" />
      <input
        type="text"
        class="input input-xs pl-7 w-full text-sm"
        data-role="picker-search"
        :placeholder="placeholder"
        :value="query"
        @input="query = ($event.target as HTMLInputElement).value"
      />
    </div>

    <div v-if="grid" class="flex flex-col gap-1.5">
      <div class="relative mx-auto w-full max-w-xs">
        <IconSearch class="absolute left-2.5 top-1/2 w-4 h-4 -translate-y-1/2 text-base-content/40 pointer-events-none" />
        <input
          type="text"
          class="input input-sm pl-8 w-full"
          data-role="picker-search"
          :placeholder="placeholder"
          :value="query"
          @input="query = ($event.target as HTMLInputElement).value"
        />
      </div>
      <div class="hh-picker-grid">
        <button
          v-for="row in shown"
          :key="row.key"
          type="button"
          class="hh-choice"
          data-role="pick-person"
          :data-pick="row.nodeId ?? ''"
          :data-pick-name="row.name"
          @click="emit('pick', row)"
        >
          <PersonFace :src="row.thumbnail" :size="64" />
          <span class="truncate text-sm">{{ row.name }}</span>
          <span v-if="row.count != null" class="text-[11px] text-base-content/45">{{ t('household.photo_count', { count: row.count }) }}</span>
          <span v-else-if="row.hint" class="text-[11px] text-base-content/45 truncate">{{ row.hint }}</span>
        </button>
      </div>
    </div>

    <div v-else class="max-h-52 overflow-y-auto rounded-box border border-base-content/10 p-0.5 flex flex-col">
      <button
        v-for="row in shown"
        :key="row.key"
        type="button"
        class="hh-row"
        data-role="pick-person"
        :data-pick="row.nodeId ?? ''"
        :data-pick-name="row.name"
        @click="emit('pick', row)"
      >
        <PersonFace :src="row.thumbnail" :size="28" />
        <span class="truncate">{{ row.name }}</span>
        <span v-if="row.hint" class="ml-auto shrink-0 text-[11px] text-base-content/45">{{ row.hint }}</span>
      </button>
      <p v-if="!shown.length" class="px-2 py-3 text-center text-xs text-base-content/50" data-role="picker-empty">{{ emptyText }}</p>
    </div>

    <p v-if="grid && !shown.length" class="py-6 text-center text-sm text-base-content/50" data-role="picker-empty">{{ emptyText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconSearch } from '@/common/icons';
import PersonFace from './PersonFace.vue';

/**
 * A list of people to choose from: a search and the faces that match.
 *
 * A row is `{ key, name, nodeId, thumbnail, hint, count }`. `nodeId` is null
 * for a name that is in no graph yet; whoever picks it decides what that
 * means.
 */
const props = defineProps({
  rows: { type: Array as () => Array<Record<string, any>>, default: () => [] },
  placeholder: { type: String, default: '' },
  emptyText: { type: String, default: '' },
  /** Big cards side by side instead of a list: for choosing somebody to start from. */
  grid: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);

const { t } = useI18n();
const query = ref('');

const shown = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return props.rows.filter((row) => String(row.name ?? '').toLowerCase().includes(needle));
});
</script>
