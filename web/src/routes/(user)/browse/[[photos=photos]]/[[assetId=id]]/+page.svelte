<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import GroupTab from '$lib/elements/GroupTab.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { browseSettings, type BrowseMediaFilter, type BrowseSortField } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { AssetOrder, AssetTypeEnum, browseAssets, SearchOrderField, type AssetResponseDto } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, Icon, IconButton, LoadingSpinner } from '@immich/ui';
  import { mdiDotsVertical, mdiImageOffOutline, mdiSelectAll, mdiSortAscending, mdiSortDescending } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();

  const mediaTypes: Record<BrowseMediaFilter, AssetTypeEnum | undefined> = {
    all: undefined,
    IMAGE: AssetTypeEnum.Image,
    VIDEO: AssetTypeEnum.Video,
  };

  const sortFields: Record<BrowseSortField, SearchOrderField> = {
    fileCreatedAt: SearchOrderField.FileCreatedAt,
    fileSizeInBytes: SearchOrderField.FileSizeInBytes,
    resolution: SearchOrderField.Resolution,
    duration: SearchOrderField.Duration,
    originalFileName: SearchOrderField.OriginalFileName,
  };

  // Each field starts in the direction you almost always want -- newest, largest and longest first,
  // but names A to Z -- so one click on a field gives a useful order without touching the arrow too.
  const naturalDirection: Record<BrowseSortField, 'asc' | 'desc'> = {
    fileCreatedAt: 'desc',
    fileSizeInBytes: 'desc',
    resolution: 'desc',
    duration: 'desc',
    originalFileName: 'asc',
  };

  const mediaOptions = $derived([
    { value: 'all', label: $t('all') },
    { value: 'IMAGE', label: $t('photos') },
    { value: 'VIDEO', label: $t('videos') },
  ]);

  // Duration means nothing for stills, so it's only offered when videos can be in the results.
  const sortOptions = $derived(
    [
      { value: 'fileCreatedAt', label: $t('date_taken') },
      { value: 'fileSizeInBytes', label: $t('file_size') },
      { value: 'resolution', label: $t('resolution') },
      { value: 'duration', label: $t('duration') },
      { value: 'originalFileName', label: $t('filename') },
    ].filter((option) => option.value !== 'duration' || $browseSettings.media !== 'IMAGE'),
  );

  const viewport: Viewport = $state({ width: 0, height: 0 });
  let scrollElement: HTMLElement | undefined = $state();
  let assets: AssetResponseDto[] = $state([]);
  let nextPage = $state(1);
  let isLoading = $state(false);
  // Bumped whenever the filter or sort changes, so a page still in flight for the previous query
  // can't land in the new results.
  let generation = 0;

  // UserPageLayout scrolls an inner element, not the document. Hand that element to GalleryViewer so it
  // tracks the real scroll position, and size the viewport to what's visible -- binding it to the
  // content's height instead would render every loaded tile at once and never trigger the next page.
  const trackScrollElement = (node: HTMLElement) => {
    scrollElement = node;
    const observer = new ResizeObserver(() => (viewport.height = node.clientHeight));
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  };

  const loadNextPage = async () => {
    if (!nextPage || isLoading) {
      return;
    }

    isLoading = true;
    const requested = generation;
    const { media, field, direction } = $browseSettings;
    try {
      const { assets: page } = await browseAssets({
        browseSearchDto: {
          page: nextPage,
          withExif: true,
          type: mediaTypes[media],
          order: { field: sortFields[field], direction: direction === 'asc' ? AssetOrder.Asc : AssetOrder.Desc },
        },
      });
      if (requested !== generation) {
        return;
      }
      assets.push(...page.items);
      nextPage = Number(page.nextPage) || 0;
    } catch (error) {
      handleError(error, $t('failed_to_load_assets'));
    } finally {
      if (requested === generation) {
        isLoading = false;
      }
    }
  };

  const reload = () => {
    generation++;
    assets = [];
    nextPage = 1;
    isLoading = false;
    assetMultiSelectManager.clear();
    scrollElement?.scrollTo({ top: 0 });
    void loadNextPage();
  };

  const setMedia = (media: string) => {
    browseSettings.update((settings) => {
      const next = { ...settings, media: media as BrowseMediaFilter };
      // Switching to photos while sorted by duration would leave nothing meaningful to sort on.
      if (next.media === 'IMAGE' && next.field === 'duration') {
        next.field = 'fileCreatedAt';
        next.direction = naturalDirection.fileCreatedAt;
      }
      return next;
    });
    reload();
  };

  const setField = (field: string) => {
    const sortField = field as BrowseSortField;
    browseSettings.update((settings) => ({ ...settings, field: sortField, direction: naturalDirection[sortField] }));
    reload();
  };

  const toggleDirection = () => {
    browseSettings.update((settings) => ({ ...settings, direction: settings.direction === 'asc' ? 'desc' : 'asc' }));
    reload();
  };

  const removeAssets = (assetIds: string[]) => {
    const removed = new Set(assetIds);
    assets = assets.filter((asset) => !removed.has(asset.id));
  };

  const handleFavorite = (assetIds: string[], isFavorite: boolean) => {
    for (const id of assetIds) {
      const asset = assets.find((candidate) => candidate.id === id);
      if (asset) {
        asset.isFavorite = isFavorite;
      }
    }
  };

  const handleSetVisibility = (assetIds: string[]) => {
    assetMultiSelectManager.clear();
    removeAssets(assetIds);
  };

  const handleSelectAll = () => {
    assetMultiSelectManager.selectAssets(assets.map((asset) => toTimelineAsset(asset)));
  };

  onMount(() => void loadNextPage());
</script>

<OnEvents onAlbumAddAssets={() => assetMultiSelectManager.clear()} />

<UserPageLayout
  hideNavbar={assetMultiSelectManager.selectionActive}
  title={data.meta.title}
  use={[trackScrollElement]}
>
  {#snippet buttons()}
    <div class="flex items-center gap-2 overflow-x-auto">
      <div class="h-10 shrink-0">
        <GroupTab
          label={$t('media_type')}
          filters={mediaOptions.map((option) => option.value)}
          labels={mediaOptions.map((option) => option.label)}
          selected={$browseSettings.media}
          onSelect={setMedia}
        />
      </div>
      <div class="h-10 shrink-0">
        <GroupTab
          label={$t('sort_by')}
          filters={sortOptions.map((option) => option.value)}
          labels={sortOptions.map((option) => option.label)}
          selected={$browseSettings.field}
          onSelect={setField}
        />
      </div>
      <IconButton
        shape="round"
        color="secondary"
        variant="ghost"
        icon={$browseSettings.direction === 'asc' ? mdiSortAscending : mdiSortDescending}
        aria-label={$browseSettings.direction === 'asc' ? $t('ascending') : $t('descending')}
        title={$browseSettings.direction === 'asc' ? $t('ascending') : $t('descending')}
        onclick={toggleDirection}
      />
    </div>
  {/snippet}

  <div bind:clientWidth={viewport.width}>
    {#if assets.length > 0}
      <GalleryViewer
        {assets}
        assetInteraction={assetMultiSelectManager}
        {viewport}
        {scrollElement}
        onEndReached={loadNextPage}
        onReload={reload}
      />
    {:else if !isLoading}
      <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
        <div class="flex flex-col content-center items-center text-center">
          <Icon icon={mdiImageOffOutline} size="3.5em" />
          <p class="mt-5 text-3xl font-medium">{$t('no_results')}</p>
        </div>
      </div>
    {/if}

    {#if isLoading}
      <div class="flex items-center justify-center py-16">
        <LoadingSpinner size="giant" />
      </div>
    {/if}
  </div>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <CreateSharedLink />
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      aria-label={$t('select_all')}
      icon={mdiSelectAll}
      onclick={handleSelectAll}
    />
    <ActionButton action={Actions.AddToAlbum} />

    {#if assetMultiSelectManager.isAllUserOwned}
      <FavoriteAction removeFavorite={assetMultiSelectManager.isAllFavorite} onFavorite={handleFavorite} />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <!-- Browse only shows timeline assets, so anything archived leaves the list. -->
        <ArchiveAction menuItem onArchive={(ids) => removeAssets(ids)} />
        {#if authManager.preferences.tags.enabled}
          <TagAction menuItem />
        {/if}
        <DeleteAssets menuItem onAssetDelete={removeAssets} onUndoDelete={reload} />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <hr />
        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
        <ActionMenuItem action={Actions.GenerateSubtitlesJob} />
      </ButtonContextMenu>
    {:else}
      <DownloadAction />
    {/if}
  </AssetSelectControlBar>
{/if}
