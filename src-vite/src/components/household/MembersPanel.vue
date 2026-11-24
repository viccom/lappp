<template>
  <div class="hh-panel" data-role="overview">
    <div>
      <div class="hh-panel-name">{{ name }}</div>
      <div class="hh-panel-sub">{{ t('household.people_count', { count: members.length }) }} · {{ t('household.links_count', { count: links }) }}</div>
    </div>
    <p v-if="links === 0" class="hh-empty">{{ t('household.no_links_hint') }}</p>
    <p v-else class="hh-empty">{{ t('household.overview_hint') }}</p>

    <section>
      <h3 class="hh-title">
        <span>{{ t('household.members') }}</span>
        <span class="hh-count">{{ members.length }}</span>
      </h3>
      <button
        v-for="member in members"
        :key="member.id"
        type="button"
        class="hh-row"
        data-role="member"
        :data-name="member.name"
        :data-node-id="member.id"
        @click="emit('select', member.id)"
      >
        <PersonFace :src="member.thumbnail" :size="28" />
        <span class="truncate">{{ member.name }}</span>
        <span v-if="member.isRoot" class="hh-badge ml-auto" data-role="root-badge">{{ t('household.root') }}</span>
        <span v-else-if="member.term" class="ml-auto shrink-0 text-[11px] text-base-content/45">{{ member.term }}</span>
      </button>
    </section>

    <section v-if="unjoined.length">
      <h3 class="hh-title">
        <span>{{ t('household.not_joined') }}</span>
        <span class="hh-count">{{ unjoined.length }}</span>
      </h3>
      <button
        v-for="entry in unjoined"
        :key="entry.name"
        type="button"
        class="hh-row"
        data-role="join"
        :data-name="entry.name"
        @click="emit('join', entry)"
      >
        <PersonFace :src="entry.thumbnail" :size="28" />
        <span class="truncate">{{ entry.name }}</span>
        <span class="ml-auto shrink-0 text-[11px] text-primary">{{ t('household.add') }}</span>
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PersonFace from './PersonFace.vue';

/**
 * What the side shows while nobody is selected: everybody of the graph, to
 * pick one from, and the people who could still join.
 */
defineProps({
  name: { type: String, default: '' },
  /** `{ id, name, term, thumbnail, isRoot }` */
  members: { type: Array as () => Array<Record<string, any>>, default: () => [] },
  links: { type: Number, default: 0 },
  /** `{ name, thumbnail }` */
  unjoined: { type: Array as () => Array<Record<string, any>>, default: () => [] },
});
const emit = defineEmits(['select', 'join']);

const { t } = useI18n();
</script>
