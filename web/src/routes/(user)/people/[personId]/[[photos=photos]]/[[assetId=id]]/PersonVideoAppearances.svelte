<script lang="ts">
  import { goto } from '$app/navigation';
  import { QueryParameter } from '$lib/constants';
  import { Route } from '$lib/route';
  import { getAssetPlaybackUrl, getAssetVideoFrameUrl } from '$lib/utils';
  import { type PersonResponseDto, type PersonVideoOccurrenceResponseDto } from '@immich/sdk';
  import { Duration } from 'luxon';
  import { t } from 'svelte-i18n';

  interface Props {
    person: PersonResponseDto;
    occurrences: PersonVideoOccurrenceResponseDto[];
  }

  let { person, occurrences }: Props = $props();

  const PREVIEW_PADDING_SECONDS = 4;
  const HOVER_INTENT_DELAY_MS = 200;

  let selectedAssetId = $state<string | undefined>();

  // Most-appearances-first, so the video worth looking at first is at the top of the list
  // instead of requiring a scroll through everything to find it.
  const sortedOccurrences = $derived([...occurrences].sort((a, b) => b.timestampsMs.length - a.timestampsMs.length));

  // Falls back to the top of the sorted list whenever selectedAssetId is unset or no longer
  // matches an occurrence (e.g. on first render, or if the underlying data changes).
  const selectedOccurrence = $derived(
    sortedOccurrences.find((occurrence) => occurrence.assetId === selectedAssetId) ?? sortedOccurrences[0],
  );

  let hovered = $state<{ assetId: string; timestampMs: number } | undefined>();
  let hoverTimeout: ReturnType<typeof setTimeout> | undefined;
  let clipVideo: HTMLVideoElement | undefined = $state();

  const formatTimestamp = (timestampMs: number) => Duration.fromMillis(timestampMs).toFormat('m:ss');

  const openAppearance = async (assetId: string, timestampMs: number) => {
    const url = `${Route.viewPerson({ id: person.id })}/photos/${assetId}?${QueryParameter.TIME_MS}=${timestampMs}`;
    await goto(url);
  };

  // Debounced so quickly scanning the mouse across many thumbnails doesn't fire off a
  // burst of video loads for ones the user never intended to linger on.
  const showPreview = (assetId: string, timestampMs: number) => {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      hovered = { assetId, timestampMs };
    }, HOVER_INTENT_DELAY_MS);
  };

  const hidePreview = () => {
    clearTimeout(hoverTimeout);
    hovered = undefined;
  };

  // Mirrors the cleanup pattern in VideoThumbnail.svelte: removing a <video> from the DOM
  // alone doesn't reliably release its network/decoder resources, so each preview must be
  // explicitly paused and unloaded before the next one replaces it -- otherwise repeated
  // hovers accumulate live video loads and can bog down the whole page.
  const releaseVideo = (video: HTMLVideoElement | undefined) => {
    if (!video) {
      return;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  $effect(() => {
    // re-run (and clean up the previous run) whenever the hovered thumbnail changes
    hovered;
    return () => releaseVideo(clipVideo);
  });

  const onClipLoaded = (video: HTMLVideoElement, timestampMs: number) => {
    video.currentTime = Math.max(0, timestampMs / 1000 - PREVIEW_PADDING_SECONDS);
    void video.play().catch(() => {});
  };

  const onClipTimeUpdate = (video: HTMLVideoElement, timestampMs: number) => {
    if (video.currentTime >= timestampMs / 1000 + PREVIEW_PADDING_SECONDS) {
      video.pause();
    }
  };
</script>

{#if occurrences.length > 0}
  <section class="px-4 pb-4 sm:px-6">
    <p class="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">{$t('appears_in_videos')}</p>
    <div class="flex h-96 gap-4">
      <div
        class="flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-e border-gray-200 pe-3 dark:border-gray-700"
      >
        {#each sortedOccurrences as occurrence (occurrence.assetId)}
          {@const isSelected = occurrence.assetId === selectedOccurrence?.assetId}
          <button
            type="button"
            class="flex shrink-0 flex-col items-center gap-1 rounded-lg p-2 text-center {isSelected
              ? 'bg-immich-primary/10 dark:bg-immich-dark-primary/15'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
            onclick={() => (selectedAssetId = occurrence.assetId)}
          >
            <span class="w-full truncate text-xs font-medium" title={occurrence.originalFileName}>
              {occurrence.originalFileName}
            </span>
            <div class="h-16 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
              <img
                src={getAssetVideoFrameUrl(occurrence.assetId, occurrence.timestampsMs[0])}
                alt=""
                loading="lazy"
                class="h-full w-full object-cover"
              />
            </div>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {$t('appearance_count', { values: { count: occurrence.timestampsMs.length } })}
            </span>
          </button>
        {/each}
      </div>

      {#if selectedOccurrence}
        <div class="min-w-0 flex-1 overflow-y-auto">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="truncate text-sm font-medium" title={selectedOccurrence.originalFileName}>
              {selectedOccurrence.originalFileName}
            </span>
            {#if selectedOccurrence.durationMs != null}
              <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {formatTimestamp(selectedOccurrence.durationMs)}
              </span>
            {/if}
          </div>
          <div class="flex flex-wrap gap-3">
            {#each selectedOccurrence.timestampsMs as timestampMs (timestampMs)}
              {@const isHovered =
                hovered?.assetId === selectedOccurrence.assetId && hovered.timestampMs === timestampMs}
              <button
                type="button"
                class="flex w-28 flex-col items-center gap-1"
                onclick={() => openAppearance(selectedOccurrence.assetId, timestampMs)}
                onfocus={() => showPreview(selectedOccurrence.assetId, timestampMs)}
                onblur={hidePreview}
                onpointerenter={() => showPreview(selectedOccurrence.assetId, timestampMs)}
                onpointerleave={hidePreview}
              >
                <div class="h-20 w-28 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                  {#if isHovered}
                    <video
                      bind:this={clipVideo}
                      muted
                      preload="metadata"
                      playsinline
                      class="h-full w-full object-cover"
                      src={getAssetPlaybackUrl({ id: selectedOccurrence.assetId })}
                      onloadedmetadata={(event) => onClipLoaded(event.currentTarget, timestampMs)}
                      ontimeupdate={(event) => onClipTimeUpdate(event.currentTarget, timestampMs)}
                    ></video>
                  {:else}
                    <img
                      src={getAssetVideoFrameUrl(selectedOccurrence.assetId, timestampMs)}
                      alt=""
                      loading="lazy"
                      class="h-full w-full object-cover"
                    />
                  {/if}
                </div>
                <span class="text-xs text-gray-700 dark:text-gray-300">{formatTimestamp(timestampMs)}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>
{/if}
