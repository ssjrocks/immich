<script lang="ts">
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import MergeIntoPersonModal from '$lib/modals/MergeIntoPersonModal.svelte';
  import { Route } from '$lib/route';
  import { faceManager } from '$lib/stores/face.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { getPeopleThumbnailUrl, handlePromiseError } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AssetTypeEnum,
    deleteFace,
    mergePerson,
    searchPerson,
    updatePerson,
    type AssetFaceResponseDto,
    type AssetResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { IconButton, modalManager, Text, toastManager } from '@immich/ui';
  import { mdiAccountOff, mdiCheck, mdiClose, mdiEye, mdiEyeOff, mdiMerge, mdiPencil, mdiPlus } from '@mdi/js';
  import { DateTime, Duration } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    isOwner: boolean;
    previousRoute: string;
  };

  const { asset, isOwner, previousRoute }: Props = $props();

  const isVideo = $derived(asset.type === AssetTypeEnum.Video);
  let expandedPersonId = $state<string | undefined>();
  let expandedPersonAnchor = $state<{ top: number; right: number } | undefined>();
  let renamingPersonId = $state<string | undefined>();
  let renameValue = $state('');

  const formatTimestamp = (timestampMs: number) => Duration.fromMillis(timestampMs).toFormat('m:ss');

  const getAppearanceTimestamps = (personFaces: { timestampMs?: number }[]) =>
    [...new Set(personFaces.map((face) => face.timestampMs).filter((ms): ms is number => ms != undefined))].sort(
      (a, b) => a - b,
    );

  const closeAppearances = () => {
    expandedPersonId = undefined;
    expandedPersonAnchor = undefined;
  };

  // Rendered with position:fixed anchored to the trigger's own viewport rect (rather than
  // position:absolute within the sidebar) so the popover can float out over the video instead of
  // being clipped by the sidebar's overflow-y-auto ancestor, which implicitly clips overflow-x too.
  const toggleAppearances = (personId: string, event: MouseEvent) => {
    if (expandedPersonId === personId) {
      closeAppearances();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    expandedPersonAnchor = { top: rect.bottom, right: window.innerWidth - rect.right };
    expandedPersonId = personId;
  };

  $effect(() => {
    if (!expandedPersonId) {
      return;
    }
    const close = () => closeAppearances();
    window.addEventListener('scroll', close, { capture: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  });

  const seekToAppearance = (timestampMs: number) => {
    assetViewerManager.seekVideoTo(timestampMs);
    closeAppearances();
  };

  const focusOnMount = (node: HTMLInputElement) => {
    node.focus();
  };

  const refreshFaces = async () => {
    faceManager.clear();
    await faceManager.getAssetFaces(asset.id);
  };

  const startRename = (person: PersonResponseDto, event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    renamingPersonId = person.id;
    renameValue = person.name;
  };

  const cancelRename = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    renamingPersonId = undefined;
  };

  const mergeInto = async (survivor: PersonResponseDto, absorbed: PersonResponseDto) => {
    try {
      await mergePerson({ id: survivor.id, mergePersonDto: { ids: [absorbed.id] } });
      toastManager.primary($t('merged_people_count', { values: { count: 1 } }));
      await refreshFaces();
    } catch (error) {
      handleError(error, $t('cannot_merge_people'));
    }
  };

  const submitRename = async (person: PersonResponseDto, event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    const name = renameValue.trim();
    renamingPersonId = undefined;
    if (name === person.name) {
      return;
    }
    try {
      // Typing an existing person's name usually signals "this is actually them" rather
      // than a coincidental duplicate name, so offer to merge instead of just renaming.
      const matches = await searchPerson({ name, withHidden: true });
      const existingPerson = matches.find(
        (match) => match.id !== person.id && match.name.toLowerCase() === name.toLowerCase(),
      );
      if (existingPerson) {
        const isConfirmed = await modalManager.showDialog({
          prompt: $t('merge_into_existing_person_prompt', { values: { name: existingPerson.name } }),
        });
        if (isConfirmed) {
          await mergeInto(existingPerson, person);
        }
        return;
      }

      await updatePerson({ id: person.id, personUpdateDto: { name } });
      toastManager.primary($t('change_name_successfully'));
      await refreshFaces();
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_name'));
    }
  };

  const markNotAFace = async (person: PersonResponseDto, personFaces: AssetFaceResponseDto[], event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('confirm_delete_face', { values: { name: person.name || $t('face_unassigned') } }),
    });
    if (!isConfirmed) {
      return;
    }
    try {
      for (const face of personFaces) {
        await deleteFace({ id: face.id, assetFaceDeleteDto: { force: false } });
      }
      await refreshFaces();
    } catch (error) {
      handleError(error, $t('error_delete_face'));
    }
  };

  const openMergeIntoExisting = async (person: PersonResponseDto, event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = await modalManager.show(MergeIntoPersonModal, { person });
    if (!target) {
      return;
    }
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('merge_into_existing_person_prompt', { values: { name: target.name || $t('face_unassigned') } }),
    });
    if (!isConfirmed) {
      return;
    }
    await mergeInto(target, person);
  };

  const people = $derived(Array.from(faceManager.people));
  const visiblePeople = $derived(
    people
      .filter((p) => assetViewerManager.isShowingHiddenPeople || !p.isHidden)
      .map((person) => {
        if (!person.birthDate) {
          return { formattedBirthDate: undefined, formattedAge: undefined, ...person };
        }
        const personBirthDate = DateTime.fromISO(person.birthDate);
        const ageInYears = Math.floor(DateTime.fromISO(asset.localDateTime).diff(personBirthDate, 'years').years);
        const ageInMonths = Math.floor(DateTime.fromISO(asset.localDateTime).diff(personBirthDate, 'months').months);

        let formattedAge;
        if (ageInYears < 0) {
          return { formattedBirthDate: undefined, formattedAge: undefined, ...person };
        } else if (ageInMonths < 12) {
          formattedAge = $t('age_months', { values: { months: ageInMonths } });
        } else if (ageInMonths > 12 && ageInMonths < 24) {
          formattedAge = $t('age_year_months', { values: { months: ageInMonths - 12 } });
        } else {
          formattedAge = $t('age_years', { values: { years: ageInYears } });
        }

        const formattedBirthDate = personBirthDate.toLocaleString(
          {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          },
          { locale: $locale },
        );
        return { formattedBirthDate, formattedAge, ...person };
      }),
  );
</script>

{#if !authManager.isSharedLink && isOwner}
  <section class="px-4 pt-4 text-sm">
    <div class="flex h-10 w-full items-center justify-between">
      <Text size="small" color="muted">{$t('people')}</Text>
      <div class="flex items-center gap-2">
        {#if people.some((person) => person.isHidden)}
          <IconButton
            aria-label={$t('show_hidden_people')}
            icon={assetViewerManager.isShowingHiddenPeople ? mdiEyeOff : mdiEye}
            size="medium"
            shape="round"
            color="secondary"
            variant="ghost"
            class="h-[3.125rem] w-[3.125rem]"
            onclick={() => assetViewerManager.toggleHiddenPeople()}
          />
        {/if}
        <IconButton
          aria-label={$t('tag_people')}
          icon={mdiPlus}
          size="medium"
          shape="round"
          color="secondary"
          variant="ghost"
          class="h-[3.125rem] w-[3.125rem]"
          onclick={() => assetViewerManager.toggleFaceEditMode()}
        />

        {#if faceManager.data.length > 0}
          <IconButton
            aria-label={$t('edit_people')}
            icon={mdiPencil}
            size="medium"
            shape="round"
            color={assetViewerManager.isPeopleEditMode ? 'primary' : 'secondary'}
            variant={assetViewerManager.isPeopleEditMode ? 'filled' : 'ghost'}
            class="h-[3.125rem] w-[3.125rem]"
            onclick={() => assetViewerManager.togglePeopleEditMode()}
          />
        {/if}
      </div>
    </div>

    <div class="mt-2 grid {visiblePeople.length <= 6 ? 'grid-cols-3 gap-3' : 'grid-cols-4 gap-2'}">
      {#each visiblePeople as person (person.id)}
        {@const personFaces = faceManager.facesByPersonId.get(person.id) ?? []}
        {@const isHighlighted = personFaces.some((f) => assetViewerManager.highlightedFaces.some((b) => b.id === f.id))}
        {@const appearances = getAppearanceTimestamps(personFaces)}

        {#snippet personCard()}
          <ImageThumbnail
            curve
            shadow
            url={getPeopleThumbnailUrl(person)}
            altText={person.name}
            title={person.name}
            widthStyle="100%"
            hidden={person.isHidden}
            highlighted={isHighlighted}
            class="outline-offset-2 outline-immich-primary group-focus-visible:outline-2 dark:outline-immich-dark-primary"
          />
          {#if renamingPersonId === person.id}
            <div class="mt-1 flex items-center gap-1" role="presentation" onclick={(event) => event.stopPropagation()}>
              <input
                type="text"
                class="w-full min-w-0 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                bind:value={renameValue}
                use:focusOnMount
                onkeydown={(event) => {
                  if (event.key === 'Enter') {
                    handlePromiseError(submitRename(person, event));
                  } else if (event.key === 'Escape') {
                    cancelRename(event);
                  }
                }}
              />
              <IconButton
                aria-label={$t('save')}
                icon={mdiCheck}
                size="small"
                shape="round"
                color="primary"
                variant="ghost"
                onclick={(event: Event) => handlePromiseError(submitRename(person, event))}
              />
              <IconButton
                aria-label={$t('cancel')}
                icon={mdiClose}
                size="small"
                shape="round"
                color="secondary"
                variant="ghost"
                onclick={cancelRename}
              />
            </div>
          {:else}
            <p class="mt-1 truncate font-medium" title={person.name}>{person.name}</p>
          {/if}
          {#if person.birthDate && person.formattedAge}
            <p class="font-light {visiblePeople.length > 6 ? 'text-xs' : ''}" title={person.formattedBirthDate!}>
              {person.formattedAge}
            </p>
          {/if}
        {/snippet}

        <div class="group relative">
          {#if isVideo && appearances.length > 0}
            <button
              type="button"
              class="w-full text-left outline-none"
              onfocus={() => assetViewerManager.setHighlightedFaces(personFaces)}
              onblur={() => assetViewerManager.clearHighlightedFaces()}
              onpointerenter={() => assetViewerManager.setHighlightedFaces(personFaces)}
              onpointerleave={() => assetViewerManager.clearHighlightedFaces()}
              onclick={(event) => toggleAppearances(person.id, event)}
            >
              {@render personCard()}
            </button>

            {#if expandedPersonId === person.id && expandedPersonAnchor}
              <div
                class="fixed z-50 mt-1 flex w-max max-w-56 flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                style="top: {expandedPersonAnchor.top}px; right: {expandedPersonAnchor.right}px;"
              >
                {#each appearances as timestampMs (timestampMs)}
                  <button
                    type="button"
                    class="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                    onclick={() => seekToAppearance(timestampMs)}
                  >
                    {formatTimestamp(timestampMs)}
                  </button>
                {/each}
              </div>
            {/if}
          {:else}
            <a
              class="outline-none"
              href={Route.viewPerson(person, { previousRoute })}
              onfocus={() => assetViewerManager.setHighlightedFaces(personFaces)}
              onblur={() => assetViewerManager.clearHighlightedFaces()}
              onpointerenter={() => assetViewerManager.setHighlightedFaces(personFaces)}
              onpointerleave={() => assetViewerManager.clearHighlightedFaces()}
            >
              {@render personCard()}
            </a>
          {/if}

          {#if assetViewerManager.isPeopleEditMode && renamingPersonId !== person.id}
            <div
              class="absolute top-0 right-0 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <IconButton
                aria-label={$t('edit_name')}
                icon={mdiPencil}
                size="medium"
                shape="round"
                color="primary"
                variant="filled"
                onclick={(event: Event) => startRename(person, event)}
              />
              <IconButton
                aria-label={$t('merge_people')}
                icon={mdiMerge}
                size="medium"
                shape="round"
                color="secondary"
                variant="filled"
                onclick={(event: Event) => handlePromiseError(openMergeIntoExisting(person, event))}
              />
              <IconButton
                aria-label={$t('delete_face')}
                icon={mdiAccountOff}
                size="medium"
                shape="round"
                color="danger"
                variant="filled"
                onclick={(event: Event) => handlePromiseError(markNotAFace(person, personFaces, event))}
              />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
