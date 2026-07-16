<script lang="ts">
  import { goto } from '$app/navigation';
  import { QueryParameter } from '$lib/constants';
  import { Route } from '$lib/route';
  import { getAssetPlaybackUrl } from '$lib/utils';
  import type { PersonResponseDto, PersonVideoOccurrenceResponseDto } from '@immich/sdk';
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
  let thumbnailVideo: HTMLVideoElement | undefined = $state();
  let clipVideo: HTMLVideoElement | undefined = $state();
  // The clip only starts loading once the thumbnail is ready, so a hover never opens more
  // than one concurrent video stream at a time -- halves the peak simultaneous connections.
  let clipReady = $state(false);

  const formatTimestamp = (timestampMs: number) => Duration.fromMillis(timestampMs).toFormat('m:ss');

  const openAppearance = async (assetId: string, timestampMs: number) => {
    const url = `${Route.viewPerson({ id: person.id })}/photos/${assetId}?${QueryParameter.TIME_MS}=${timestampMs}`;
    await goto(url);
  };

  // Debounced so quickly scanning the mouse across many chips doesn't fire off a
  // burst of video loads for chips the user never intended to linger on.
  const showPreview = (assetId: string, timestampMs: number) => {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      clipReady = false;
      hovered = { assetId, timestampMs };
    }, HOVER_INTENT_DELAY_MS);
  };

  const hidePreview = () => {
    clearTimeout(hoverTimeout);
    hovered = undefined;
    clipReady = false;
  };

  // Mirrors the cleanup pattern in VideoThumbnail.svelte: removing a <video> from the
  // DOM alone doesn't reliably release its network/decoder resources, so each preview
  // must be explicitly paused and unloaded before the next one replaces it -- otherwise
  // repeated hovers accumulate live video loads and can bog down the whole page.
  const releaseVideo = (video: HTMLVideoElement | undefined) => {
    if (!video) {
      return;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  $effect(() => {
    // re-run (and clean up the previous run) whenever the hovered chip changes
    hovered;
    return () => {
      releaseVideo(thumbnailVideo);
      releaseVideo(clipVideo);
    };
  });

  const onThumbnailLoaded = (video: HTMLVideoElement, timestampMs: number) => {
    video.currentTime = timestampMs / 1000;
    clipReady = true;
  };

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
  <section class="w-fit max-w-64 px-4 pb-4 sm:max-w-96 sm:px-6">
    <p class="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">{$t('appears_in_videos')}</p>
    <div class="flex flex-col gap-2">
      {#each occurrences as occurrence (occurrence.assetId)}
        <div class="flex flex-wrap items-center gap-1">
          {#each occurrence.timestampsMs as timestampMs (timestampMs)}
            <div class="relative inline-block">
              <button
                type="button"
                class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                onclick={() => openAppearance(occurrence.assetId, timestampMs)}
                onfocus={() => showPreview(occurrence.assetId, timestampMs)}
                onblur={hidePreview}
                onpointerenter={() => showPreview(occurrence.assetId, timestampMs)}
                onpointerleave={hidePreview}
              >
                {formatTimestamp(timestampMs)}
              </button>

              {#if hovered?.assetId === occurrence.assetId && hovered.timestampMs === timestampMs}
                <div
                  class="absolute top-full left-0 z-10 mt-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                  style="width: 57rem;"
                >
                  <video
                    bind:this={thumbnailVideo}
                    muted
                    preload="metadata"
                    playsinline
                    class="shrink-0 rounded object-cover"
                    style="width: 28rem; height: 16rem;"
                    src={getAssetPlaybackUrl({ id: occurrence.assetId })}
                    onloadedmetadata={(event) => onThumbnailLoaded(event.currentTarget, timestampMs)}
                  ></video>
                  {#if clipReady}
                    <video
                      bind:this={clipVideo}
                      muted
                      preload="metadata"
                      playsinline
                      class="shrink-0 rounded object-cover"
                      style="width: 28rem; height: 16rem;"
                      src={getAssetPlaybackUrl({ id: occurrence.assetId })}
                      onloadedmetadata={(event) => onClipLoaded(event.currentTarget, timestampMs)}
                      ontimeupdate={(event) => onClipTimeUpdate(event.currentTarget, timestampMs)}
                    ></video>
                  {:else}
                    <div class="shrink-0 rounded bg-gray-100 dark:bg-gray-700" style="width: 28rem; height: 16rem;"></div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </section>
{/if}
