<script lang="ts">
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import {
    AssetTypeEnum,
    getAssetTranscript,
    type AssetResponseDto,
    type AssetTranscriptLineResponseDto,
  } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import { Duration } from 'luxon';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
  }

  let { asset }: Props = $props();

  let lines = $state<AssetTranscriptLineResponseDto[]>([]);
  let currentMs = $state<number>();

  $effect(() => {
    const { id, type } = asset;
    lines = [];
    if (type !== AssetTypeEnum.Video) {
      return;
    }

    // Moving on to another video before this one's transcript arrives must not show the old one.
    let cancelled = false;
    getAssetTranscript({ ...authManager.params, id })
      .then((result) => {
        if (!cancelled) {
          lines = result;
        }
      })
      // Optional extra: without a transcript the section just isn't shown, so there's nothing to report.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const video = assetViewerManager.videoPlayer;
    if (!video || lines.length === 0) {
      currentMs = undefined;
      return;
    }

    const update = () => (currentMs = video.currentTime * 1000);
    update();
    video.addEventListener('timeupdate', update);
    return () => video.removeEventListener('timeupdate', update);
  });

  // The line being spoken right now, if any: highlighted while it's on screen as a subtitle.
  const activeIndex = $derived(
    currentMs === undefined ? -1 : lines.findIndex((line) => line.startMs <= currentMs! && currentMs! < line.endMs),
  );

  const formatTime = (ms: number) => Duration.fromMillis(ms).toFormat(ms >= 3_600_000 ? 'h:mm:ss' : 'm:ss');
</script>

{#if lines.length > 0}
  <section class="px-4 pt-4 pb-12 text-sm dark:text-immich-dark-fg">
    <div class="flex h-10 w-full items-center">
      <Text size="small" color="muted">{$t('transcript')}</Text>
    </div>

    <ol class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700" aria-label={$t('transcript')}>
      {#each lines as line, index (index)}
        <li class="border-gray-200 not-first:border-t dark:border-gray-700">
          <button
            type="button"
            class={[
              'grid w-full grid-cols-[auto_1fr] gap-3 px-3 py-1.5 text-start transition-colors hover:bg-gray-100 dark:hover:bg-gray-800',
              index === activeIndex && 'bg-primary/10 dark:bg-immich-dark-primary/15',
            ]}
            title={$t('play_from_time', { values: { time: formatTime(line.startMs) } })}
            aria-current={index === activeIndex ? 'true' : undefined}
            onclick={() => assetViewerManager.seekVideoTo(line.startMs)}
          >
            <span class="font-mono text-xs/5 text-primary tabular-nums">{formatTime(line.startMs)}</span>
            <span class="leading-5">{line.text}</span>
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/if}
