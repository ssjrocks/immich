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

  let hovered = $state<{ assetId: string; timestampMs: number } | undefined>();

  const formatTimestamp = (timestampMs: number) => Duration.fromMillis(timestampMs).toFormat('m:ss');

  const openAppearance = async (assetId: string, timestampMs: number) => {
    const url = `${Route.viewPerson({ id: person.id })}/photos/${assetId}?${QueryParameter.TIME_MS}=${timestampMs}`;
    await goto(url);
  };

  const showPreview = (assetId: string, timestampMs: number) => {
    hovered = { assetId, timestampMs };
  };

  const hidePreview = () => {
    hovered = undefined;
  };

  const onThumbnailLoaded = (video: HTMLVideoElement, timestampMs: number) => {
    video.currentTime = timestampMs / 1000;
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
                    muted
                    preload="metadata"
                    playsinline
                    class="shrink-0 rounded object-cover"
                    style="width: 28rem; height: 16rem;"
                    src={getAssetPlaybackUrl({ id: occurrence.assetId })}
                    onloadedmetadata={(event) => onThumbnailLoaded(event.currentTarget, timestampMs)}
                  ></video>
                  <video
                    muted
                    preload="metadata"
                    playsinline
                    class="shrink-0 rounded object-cover"
                    style="width: 28rem; height: 16rem;"
                    src={getAssetPlaybackUrl({ id: occurrence.assetId })}
                    onloadedmetadata={(event) => onClipLoaded(event.currentTarget, timestampMs)}
                    ontimeupdate={(event) => onClipTimeUpdate(event.currentTarget, timestampMs)}
                  ></video>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </section>
{/if}
