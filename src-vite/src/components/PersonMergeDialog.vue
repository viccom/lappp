<template>
  <ModalDialog :title="t('msgbox.merge_person.title')" :width="360" @cancel="emit('cancel')">
    <div class="flex flex-col gap-2 min-h-0">
      <!-- search -->
      <div class="flex items-center gap-2 px-2 rounded bg-base-300/50">
        <IconSearch class="w-4 h-4 text-base-content/40 shrink-0" />
        <input
          v-model="query"
          type="text"
          class="input input-ghost input-sm flex-1 focus:outline-none"
          :placeholder="t('msgbox.merge_person.search')"
        />
        <IconClose
          v-if="query"
          class="w-4 h-4 text-base-content/40 cursor-pointer shrink-0"
          @click="query = ''"
        />
      </div>

      <!-- the people a link can point at -->
      <div v-if="visibleTargets.length > 0" class="overflow-y-auto max-h-64 flex flex-col">
        <button
          v-for="target in visibleTargets"
          :key="target.id"
          class="sidebar-item gap-2 text-left"
          :class="chosenId === target.id ? 'sidebar-item-selected' : 'sidebar-item-hover'"
          @click="chosenId = target.id"
        >
          <div class="w-7 h-7 rounded-full overflow-hidden bg-base-300/70 ring-1 ring-base-content/5 shrink-0 flex items-center justify-center">
            <img
              v-if="target.thumbnail"
              :src="'data:image/jpeg;base64,' + target.thumbnail"
              class="w-full h-full object-cover"
            />
            <IconPerson v-else class="w-4 h-4 text-base-content/30" />
          </div>
          <span class="sidebar-item-label truncate">{{ target.name }}</span>
          <span class="ml-auto text-base-content/30 text-xs shrink-0">
            {{ target.count.toLocaleString() }}
          </span>
        </button>
      </div>

      <div v-else class="py-6 text-center text-sm text-base-content/40">
        {{ t('msgbox.merge_person.empty') }}
      </div>

      <!-- what will happen -->
      <div v-if="chosen" class="text-xs text-base-content/50 px-1">
        {{ t('msgbox.merge_person.confirm', confirmParams) }}
      </div>

      <div class="flex justify-end gap-2 mt-1">
        <TButton :text="t('msgbox.cancel')" @click="emit('cancel')" />
        <TButton
          :text="t('msgbox.merge_person.title')"
          buttonClasses="btn-primary"
          :disabled="!chosen"
          @click="chosen && emit('confirm', chosen)"
        />
      </div>
    </div>
  </ModalDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconPerson, IconSearch, IconClose } from '@/common/icons';
import ModalDialog from '@/components/ModalDialog.vue';
import TButton from '@/components/TButton.vue';
import { mergeTargets, mergeConfirmParams } from '@/common/personMerge';

const props = defineProps({
  // The people rows that are about to be linked.
  sources: {
    type: Array as () => any[],
    required: true,
  },
  // The people a link can point at.
  targets: {
    type: Array as () => any[],
    default: () => [],
  },
});

const emit = defineEmits(['confirm', 'cancel']);

const { t } = useI18n();
const query = ref('');
const chosenId = ref<number | null>(null);

const excludedIds = computed(() => props.sources.map((person) => person.id));
const visibleTargets = computed(() => mergeTargets(props.targets, {
  excludeIds: excludedIds.value,
  query: query.value,
}));

const chosen = computed(() => visibleTargets.value.find((target) => target.id === chosenId.value) ?? null);
const confirmParams = computed(() => mergeConfirmParams(props.sources, chosen.value ?? { name: '' }));
</script>
