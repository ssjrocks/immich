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
  <section class="w-fit max-w-64 px-4 pb-4 sm:max-w-none sm:px-6">
    <p class="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">{$t('appears_in_videos')}</p>
    <div class="flex flex-col gap-4">
      {#each occurrences as occurrence (occurrence.assetId)}
        <div class="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="truncate text-sm font-medium" title={occurrence.originalFileName}>
              {occurrence.originalFileName}
            </span>
            {#if occurrence.durationMs != null}
              <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {formatTimestamp(occurrence.durationMs)}
              </span>
            {/if}
          </div>
          <div class="flex flex-wrap gap-3">
            {#each occurrence.timestampsMs as timestampMs (timestampMs)}
              {@const isHovered = hovered?.assetId === occurrence.assetId && hovered.timestampMs === timestampMs}
              <button
                type="button"
                class="flex w-24 flex-col items-center gap-1"
                onclick={() => openAppearance(occurrence.assetId, timestampMs)}
                onfocus={() => showPreview(occurrence.assetId, timestampMs)}
                onblur={hidePreview}
                onpointerenter={() => showPreview(occurrence.assetId, timestampMs)}
                onpointerleave={hidePreview}
              >
                <div class="h-16 w-24 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                  {#if isHovered}
                    <video
                      bind:this={clipVideo}
                      muted
                      preload="metadata"
                      playsinline
                      class="h-full w-full object-cover"
                      src={getAssetPlaybackUrl({ id: occurrence.assetId })}
                      onloadedmetadata={(event) => onClipLoaded(event.currentTarget, timestampMs)}
                      ontimeupdate={(event) => onClipTimeUpdate(event.currentTarget, timestampMs)}
                    ></video>
                  {:else}
                    <img
                      src={getAssetVideoFrameUrl(occurrence.assetId, timestampMs)}
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
      {/each}
    </div>
  </section>
{/if}
