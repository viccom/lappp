<template>
  <span class="hh-face" :style="{ width: `${size}px`, height: `${size}px` }">
    <img v-if="src && !failed" :src="src" alt="" draggable="false" @error="failed = true" />
    <svg v-else viewBox="0 0 24 24" aria-hidden="true" data-role="silhouette">
      <circle cx="12" cy="8.5" r="4" />
      <path d="M3.5 22c0-4.7 3.8-7.5 8.5-7.5s8.5 2.8 8.5 7.5z" />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

/** A person's face as the library keeps it, or the outline of somebody when it keeps none. */
const props = defineProps({
  src: { type: String as () => string | null, default: null },
  size: { type: Number, default: 32 },
});

// A face that does not load is shown as none, not as a broken picture.
const failed = ref(false);
watch(() => props.src, () => {
  failed.value = false;
});
</script>

<style scoped>
.hh-face {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--color-base-content) 10%, transparent);
}
.hh-face img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hh-face svg {
  width: 100%;
  height: 100%;
  fill: color-mix(in oklab, var(--color-base-content) 38%, transparent);
}
</style>
