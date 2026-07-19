<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import MergeIntoPersonModal from '$lib/modals/MergeIntoPersonModal.svelte';
  import ReassignFaceModal from '$lib/modals/ReassignFaceModal.svelte';
  import { Route } from '$lib/route';
  import { handleRunAssetJob } from '$lib/services/asset.service';
  import { faceManager } from '$lib/stores/face.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { getPeopleThumbnailUrl, handlePromiseError } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import {
    AssetJobName,
    AssetTypeEnum,
    deleteFace,
    mergePerson,
    reassignFacesById,
    unassignFace,
    VideoFaceScanMode,
    type AssetFaceResponseDto,
    type AssetResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { IconButton, modalManager, Text, toastManager } from '@immich/ui';
  import {
    mdiAccountOff,
    mdiAccountRemove,
    mdiEye,
    mdiEyeOff,
    mdiFaceRecognition,
    mdiMerge,
    mdiPencil,
    mdiPlus,
  } from '@mdi/js';
  import { DateTime, Duration } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    isOwner: boolean;
    previousRoute: string;
  };

  const { asset, isOwner, previousRoute }: Props = $props();

  const isVideo = $derived(asset.type === AssetTypeEnum.Video);
  const isAdmin = $derived(authManager.authenticated && authManager.user.isAdmin);
  let videoFaceScanEnabled = $state(false);

  onMount(async () => {
    if (!isAdmin || !isVideo) {
      return;
    }
    try {
      try {
        // Throws if no other admin page has loaded the config yet this session.
        void systemConfigManager.value;
      } catch {
        await systemConfigManager.init();
      }
      const { enabled, video } = systemConfigManager.value.machineLearning.facialRecognition;
      videoFaceScanEnabled = enabled && video.scanMode === VideoFaceScanMode.FullScan;
    } catch {
      // A failed config load just means no button; this isn't essential enough to surface an error for.
    }
  });

  const scanVideoFaces = () =>
    handlePromiseError(handleRunAssetJob({ name: AssetJobName.ScanVideoFaces, assetIds: [asset.id] }));

  let expandedPersonId = $state<string | undefined>();
  let expandedPersonAnchor = $state<{ top: number; right: number } | undefined>();
  // Which specific face (of possibly several timestamped occurrences) the edit-mode actions
  // (wrong person / delete) should act on -- set by picking an appearance from the popover below.
  // Scoped per person so switching cards doesn't carry a stale selection over.
  let selectedFaceForEdit = $state<{ personId: string; faceId: string } | undefined>();

  const formatTimestamp = (timestampMs: number) => Duration.fromMillis(timestampMs).toFormat('m:ss');

  // One face per distinct timestamp (a person can have duplicate-timestamp face rows left over
  // from a reassign/rescan -- collapse those rather than showing/keying on the raw duplicate).
  const getAppearances = (personFaces: AssetFaceResponseDto[]) => {
    // Local to a single call, discarded immediately after -- not component state, so the plain
    // built-in is correct here and SvelteSet's reactivity tracking would be pure overhead.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seenTimestamps = new Set<number>();
    const appearances: AssetFaceResponseDto[] = [];
    for (const face of [...personFaces].sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))) {
      if (face.timestampMs == undefined || seenTimestamps.has(face.timestampMs)) {
        continue;
      }
      seenTimestamps.add(face.timestampMs);
      appearances.push(face);
    }
    return appearances;
  };

  const closeAppearances = () => {
    expandedPersonId = undefined;
    expandedPersonAnchor = undefined;
  };

  // Rendered with position:fixed anchored to the trigger's own viewport rect (rather than
  // position:absolute within the sidebar) so the popover can float out over the video instead of
  // being clipped by the sidebar's overflow-y-auto ancestor, which implicitly clips overflow-x too.
  const openAppearances = (personId: string, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    expandedPersonAnchor = { top: rect.bottom, right: window.innerWidth - rect.right };
    expandedPersonId = personId;
  };

  const toggleAppearances = (personId: string, event: MouseEvent) => {
    if (expandedPersonId === personId) {
      closeAppearances();
      return;
    }
    openAppearances(personId, event.currentTarget as HTMLElement);
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

  // Edit-mode counterpart to seekToAppearance: pauses on the exact frame instead of playing
  // through it, draws the detected face's box so the user can visually confirm it's the right
  // one, and remembers it as the target for the wrong-person/delete actions below. Unlike
  // seekToAppearance, this leaves the popover open -- comparing several appearances back and
  // forth before acting is the whole point, so it shouldn't have to be reopened each time.
  const selectAppearanceForEdit = (person: PersonResponseDto, face: AssetFaceResponseDto) => {
    if (face.timestampMs != undefined) {
      assetViewerManager.confirmFaceAtTimestamp(face, face.timestampMs);
    }
    selectedFaceForEdit = { personId: person.id, faceId: face.id };
  };

  // A person can have multiple timestamped faces in one video asset -- resolves which single
  // face an edit action should target. With only one occurrence there's nothing to disambiguate.
  // With several, an appearance must have already been explicitly picked (selectAppearanceForEdit);
  // if not, this opens the appearance picker instead of guessing and returns undefined so the
  // caller bails out -- the user re-triggers the action once they've picked one.
  const resolveFaceForAction = (
    person: PersonResponseDto,
    personFaces: AssetFaceResponseDto[],
    trigger: HTMLElement,
  ): AssetFaceResponseDto | undefined => {
    if (personFaces.length === 1) {
      return personFaces[0];
    }
    const selected =
      selectedFaceForEdit?.personId === person.id
        ? personFaces.find((face) => face.id === selectedFaceForEdit!.faceId)
        : undefined;
    if (selected) {
      return selected;
    }
    openAppearances(person.id, trigger);
    return undefined;
  };

  const refreshFaces = async () => {
    faceManager.clear();
    await faceManager.getAssetFaces(asset.id);
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

  // Scoped to a single face, unlike mergeInto -- renaming a face is usually correcting a single
  // misidentification (e.g. one video frame tagged as the wrong person), not a claim that the two
  // whole identities are the same person and should be combined everywhere.
  const reassignFaceToExisting = async (target: PersonResponseDto, face: AssetFaceResponseDto) => {
    try {
      await reassignFacesById({ id: target.id, faceDto: { id: face.id } });
      toastManager.primary($t('reassigned_face_to_person', { values: { name: target.name } }));
      selectedFaceForEdit = undefined;
      assetViewerManager.clearConfirmedFaceBox();
      await refreshFaces();
    } catch (error) {
      handleError(error, $t('cannot_reassign_face'));
    }
  };

  // This never touches person's actual name/identity -- it's specifically for "this face was
  // tagged as the wrong person", scoped to a single face via reassignFaceToExisting. Renaming
  // a person's real name is a different action, done from that person's own page.
  const openReassignFace = async (person: PersonResponseDto, personFaces: AssetFaceResponseDto[], event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const face = resolveFaceForAction(person, personFaces, event.currentTarget as HTMLElement);
    if (!face) {
      return;
    }
    const target = await modalManager.show(ReassignFaceModal, { person, faceId: face.id });
    if (!target) {
      return;
    }
    await reassignFaceToExisting(target, face);
  };

  const markNotAFace = async (person: PersonResponseDto, personFaces: AssetFaceResponseDto[], event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const face = resolveFaceForAction(person, personFaces, event.currentTarget as HTMLElement);
    if (!face) {
      return;
    }
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('confirm_delete_face', { values: { name: person.name || $t('face_unassigned') } }),
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await deleteFace({ id: face.id, assetFaceDeleteDto: { force: false } });
      selectedFaceForEdit = undefined;
      assetViewerManager.clearConfirmedFaceBox();
      await refreshFaces();
      // Only drop the asset from the person's own timeline once none of their faces remain in
      // it -- deleting one of several timestamped appearances still leaves them tagged here.
      if (personFaces.length === 1) {
        eventManager.emit('PersonAssetDelete', { id: person.id, assetId: asset.id });
      }
    } catch (error) {
      handleError(error, $t('error_delete_face'));
    }
  };

  // For "this named person is wrong and I don't know who this actually is" -- unlike
  // markNotAFace, the face isn't deleted: it's detached and left unassigned, so facial
  // recognition can pick it back up and re-cluster it next run instead of losing it entirely.
  const unassignFaceFromPerson = async (person: PersonResponseDto, personFaces: AssetFaceResponseDto[], event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const face = resolveFaceForAction(person, personFaces, event.currentTarget as HTMLElement);
    if (!face) {
      return;
    }
    const isConfirmed = await modalManager.showDialog({
      prompt: $t('confirm_unassign_face', { values: { name: person.name || $t('face_unassigned') } }),
    });
    if (!isConfirmed) {
      return;
    }
    try {
      await unassignFace({ id: face.id });
      selectedFaceForEdit = undefined;
      assetViewerManager.clearConfirmedFaceBox();
      await refreshFaces();
      if (personFaces.length === 1) {
        eventManager.emit('PersonAssetDelete', { id: person.id, assetId: asset.id });
      }
    } catch (error) {
      handleError(error, $t('error_unassign_face'));
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

        {#if videoFaceScanEnabled}
          <IconButton
            aria-label={$t('scan_video_faces')}
            icon={mdiFaceRecognition}
            size="medium"
            shape="round"
            color="secondary"
            variant="ghost"
            class="h-[3.125rem] w-[3.125rem]"
            onclick={scanVideoFaces}
          />
        {/if}
      </div>
    </div>

    <div
      class="mt-2 grid {assetViewerManager.isPeopleEditMode
        ? 'grid-cols-2 gap-3'
        : visiblePeople.length <= 6
          ? 'grid-cols-3 gap-3'
          : 'grid-cols-4 gap-2'}"
    >
      {#each visiblePeople as person (person.id)}
        {@const personFaces = faceManager.facesByPersonId.get(person.id) ?? []}
        {@const isHighlighted = personFaces.some((f) => assetViewerManager.highlightedFaces.some((b) => b.id === f.id))}
        {@const appearances = getAppearances(personFaces)}

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
          <p class="mt-1 truncate font-medium" title={person.name}>{person.name}</p>
          {#if person.birthDate && person.formattedAge}
            <p class="font-light {visiblePeople.length > 6 ? 'text-xs' : ''}" title={person.formattedBirthDate!}>
              {person.formattedAge}
            </p>
          {/if}
        {/snippet}

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="group relative"
          onfocusin={() => assetViewerManager.setHighlightedFaces(personFaces)}
          onfocusout={() => assetViewerManager.clearHighlightedFaces()}
          onpointerenter={() => assetViewerManager.setHighlightedFaces(personFaces)}
          onpointerleave={() => assetViewerManager.clearHighlightedFaces()}
        >
          {#if isVideo && appearances.length > 0}
            <button
              type="button"
              class="w-full text-left outline-none"
              onclick={(event) => toggleAppearances(person.id, event)}
            >
              {@render personCard()}
            </button>

            {#if expandedPersonId === person.id && expandedPersonAnchor}
              <div
                class="fixed z-50 mt-1 flex w-max max-w-56 flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                style="top: {expandedPersonAnchor.top}px; right: {expandedPersonAnchor.right}px;"
                use:clickOutside={{ onOutclick: closeAppearances, onEscape: closeAppearances }}
              >
                {#each appearances as face (face.id)}
                  {@const isSelected =
                    assetViewerManager.isPeopleEditMode &&
                    selectedFaceForEdit?.personId === person.id &&
                    selectedFaceForEdit.faceId === face.id}
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-xs {isSelected
                      ? 'bg-immich-primary text-white dark:bg-immich-dark-primary dark:text-immich-dark-bg'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600'}"
                    onclick={() =>
                      assetViewerManager.isPeopleEditMode
                        ? selectAppearanceForEdit(person, face)
                        : seekToAppearance(face.timestampMs!)}
                  >
                    {formatTimestamp(face.timestampMs!)}
                  </button>
                {/each}
              </div>
            {/if}
          {:else}
            <a class="outline-none" href={Route.viewPerson(person, { previousRoute })}>
              {@render personCard()}
            </a>
          {/if}

          {#if assetViewerManager.isPeopleEditMode}
            <div
              class="absolute top-0 right-0 flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <IconButton
                aria-label={$t('wrong_person')}
                icon={mdiPencil}
                size="small"
                shape="round"
                color="primary"
                variant="filled"
                onclick={(event: Event) => handlePromiseError(openReassignFace(person, personFaces, event))}
              />
              <IconButton
                aria-label={$t('merge_people')}
                icon={mdiMerge}
                size="small"
                shape="round"
                color="secondary"
                variant="filled"
                onclick={(event: Event) => handlePromiseError(openMergeIntoExisting(person, event))}
              />
              <IconButton
                aria-label={$t('remove_from_person')}
                icon={mdiAccountRemove}
                size="small"
                shape="round"
                color="warning"
                variant="filled"
                onclick={(event: Event) => handlePromiseError(unassignFaceFromPerson(person, personFaces, event))}
              />
              <IconButton
                aria-label={$t('delete_face')}
                icon={mdiAccountOff}
                size="small"
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
