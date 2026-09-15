<script lang="ts">
  import SearchPeople from '$lib/components/faces-page/PeopleSearch.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllPeople, getPerson, mergePeople, type PersonResponseDto } from '@immich/sdk';
  import { Button, Icon, modalManager, toastManager } from '@immich/ui';
  import { mdiAccountQuestionOutline, mdiCallMerge, mdiMerge } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { flip } from 'svelte/animate';
  import { quintOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import FaceThumbnail from './FaceThumbnail.svelte';

  interface Props {
    person: PersonResponseDto;
    onBack: () => void;
    onMerge: (mergedPerson: PersonResponseDto) => void;
  }

  // Deliberately not $bindable. The old screen swapped `person` with the selected target and
  // re-navigated to keep the merge flowing the right way, which is what let a stale thumbnail
  // render under the new name. The direction is now fixed -- this person always merges *into*
  // the target -- so nothing here ever reassigns it.
  let { person, onBack, onMerge }: Props = $props();

  const MAX_EXTRA_PEOPLE = 5;

  let people: PersonResponseDto[] = $state([]);
  let target: PersonResponseDto | undefined = $state();
  let extraPeople: PersonResponseDto[] = $state([]);
  let targetSearch = $state('');
  let searchedPeopleLocal: PersonResponseDto[] = $state([]);

  // One ranked fetch backs the whole screen: `closestPersonId` orders everyone by face-embedding
  // distance from this person and tags each row with its similarity and face count, so the two
  // sections below are just filtered views of the same ranking.
  onMount(async () => {
    const data = await getAllPeople({ withHidden: false, closestPersonId: person.id });
    people = data.people;
  });

  const byId = $derived(new Map(people.map((candidate) => [candidate.id, candidate])));

  // Name-search results come from a different endpoint and carry no similarity/face count, so
  // fold in the ranked row whenever we already have one.
  const enrich = (candidate: PersonResponseDto) => byId.get(candidate.id) ?? candidate;

  const isTaken = (id: string) =>
    id === person.id || id === target?.id || extraPeople.some((candidate) => candidate.id === id);

  const namedCandidates = $derived(
    (targetSearch ? searchedPeopleLocal : people).filter((candidate) => candidate.name && !isTaken(candidate.id)),
  );
  const unnamedCandidates = $derived(people.filter((candidate) => !candidate.name && !isTaken(candidate.id)));

  // With a target chosen, this person and any extras all fold into that target. Without one, we
  // keep upstream's behaviour: the extras fold into this person.
  const destination = $derived(target ?? person);
  const sources = $derived(target ? [person, ...extraPeople] : extraPeople);
  const canMerge = $derived(sources.length > 0);

  const faceCountLabel = (candidate: PersonResponseDto) =>
    candidate.faceCount === undefined ? '' : $t('face_count', { values: { count: candidate.faceCount } });

  const similarityLabel = (candidate: PersonResponseDto) =>
    candidate.similarity === undefined
      ? ''
      : $t('similarity_percent', { values: { value: Math.round(candidate.similarity * 100) } });

  const selectTarget = (candidate: PersonResponseDto) => {
    target = enrich(candidate);
    targetSearch = '';
  };

  const selectExtra = (candidate: PersonResponseDto) => {
    if (extraPeople.length >= MAX_EXTRA_PEOPLE) {
      toastManager.warning($t('merge_people_limit', { values: { count: MAX_EXTRA_PEOPLE } }));
      return;
    }
    extraPeople = [...extraPeople, enrich(candidate)];
  };

  const removeExtra = (id: string) => {
    extraPeople = extraPeople.filter((candidate) => candidate.id !== id);
  };

  const handleMerge = async () => {
    const isConfirm = await modalManager.showDialog({ prompt: $t('merge_people_prompt') });
    if (!isConfirm) {
      return;
    }

    try {
      // The first id is the one everyone else merges into.
      const results = await mergePeople({
        mergePersonDto: { ids: [destination.id, ...sources.map(({ id }) => id)] },
      });
      const count = results.filter(({ success }) => success).length;
      toastManager.primary($t('merged_people_count', { values: { count } }));

      // Always hand back whoever survived the merge -- the target, if one was picked, otherwise
      // this person. The page owns the view mode, so it decides whether to navigate.
      onMerge(await getPerson({ id: destination.id }));
    } catch (error) {
      handleError(error, $t('cannot_merge_people'));
    }
  };
</script>

{#snippet caption(candidate: PersonResponseDto)}
  <span class="text-xs text-gray-600 dark:text-gray-300">{faceCountLabel(candidate)}</span>
{/snippet}

{#snippet similarity(candidate: PersonResponseDto)}
  <span
    class="text-xs font-medium text-gray-600 dark:text-gray-300"
    title={$t('similarity_percent_description', { values: { name: person.name || $t('no_name') } })}
  >
    {similarityLabel(candidate)}
  </span>
{/snippet}

<!-- A bubble that has been pulled up into the tray: face count above, actions and score below. -->
{#snippet selectedTile(candidate: PersonResponseDto, size: number, onRemove?: () => void)}
  {@const info = enrich(candidate)}
  <div class="flex flex-col items-center gap-1.5" style:width={size + 'px'}>
    {@render caption(info)}
    <!-- Keyed so a new selection mounts a fresh <img> rather than reusing the previous
         bubble's node, which could otherwise flash the outgoing person's thumbnail. -->
    {#key candidate.id}
      <FaceThumbnail person={candidate} border circle selectable={false} thumbnailSize={size} />
    {/key}
    <div class="flex items-center gap-3 text-xs">
      <a
        href={Route.viewPerson(candidate)}
        target="_blank"
        rel="noreferrer"
        class="text-immich-primary underline dark:text-immich-dark-primary"
      >
        {$t('view')}
      </a>
      {#if onRemove}
        <button type="button" class="text-immich-primary underline dark:text-immich-dark-primary" onclick={onRemove}>
          {$t('remove')}
        </button>
      {:else}
        <span class="text-gray-400 dark:text-gray-500">{$t('merge_source_person')}</span>
      {/if}
    </div>
    {#if onRemove}
      {@render similarity(info)}
    {/if}
  </div>
{/snippet}

<!-- A bubble still sitting in one of the pick lists below. -->
{#snippet candidateTile(candidate: PersonResponseDto, onSelect: (candidate: PersonResponseDto) => void)}
  {@const info = enrich(candidate)}
  <div class="flex flex-col items-center gap-1">
    {@render caption(info)}
    <FaceThumbnail person={candidate} circle border selectable onClick={() => onSelect(candidate)} />
    {@render similarity(info)}
  </div>
{/snippet}

<section
  transition:fly={{ y: 500, duration: 100, easing: quintOut }}
  class="absolute inset-s-0 top-0 size-full bg-light"
>
  <ControlAppBar onClose={onBack}>
    {#snippet leading()}
      {$t('merge_people')}
      <div></div>
    {/snippet}
    {#snippet trailing()}
      <Button leadingIcon={mdiMerge} size="small" shape="round" disabled={!canMerge} onclick={handleMerge}>
        {$t('merge')}
      </Button>
    {/snippet}
  </ControlAppBar>

  <section class="flex h-full flex-col gap-6 px-8 pt-22 pb-8 xl:px-17.5">
    <!-- Selection tray -->
    <div class="rounded-3xl bg-gray-200 p-6 dark:bg-immich-dark-gray">
      <p class="mb-4 text-center text-sm uppercase dark:text-white">
        {target ? $t('merge_into_person', { values: { name: target.name } }) : $t('choose_matching_people_to_merge')}
      </p>

      <div class="flex flex-wrap items-start justify-center gap-4">
        {@render selectedTile(person, 120)}

        {#each extraPeople as candidate (candidate.id)}
          <div animate:flip={{ duration: 250, easing: quintOut }}>
            {@render selectedTile(candidate, 120, () => removeExtra(candidate.id))}
          </div>
        {/each}

        <div class="flex h-30 items-center">
          <Icon icon={mdiCallMerge} size="48" class="rotate-90 dark:text-white" />
        </div>

        {#if target}
          {@render selectedTile(target, 150, () => (target = undefined))}
        {:else}
          <div
            class="flex size-37.5 flex-col items-center justify-center gap-2 rounded-full border-2 border-dashed border-gray-400 p-4 text-center dark:border-gray-500"
          >
            <Icon icon={mdiAccountQuestionOutline} size="32" class="text-gray-500 dark:text-gray-400" />
            <span class="text-xs text-gray-600 dark:text-gray-300">{$t('choose_merge_target')}</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Targets: named people only, single pick. Disappears once a target is chosen. -->
    {#if !target}
      <div class="flex min-h-0 flex-col">
        <div class="mb-3 flex h-12 items-center gap-4">
          <h2 class="text-sm uppercase dark:text-white">{$t('merge_targets')}</h2>
          <div class="md:w-96">
            <SearchPeople
              type="searchBar"
              placeholder={$t('search_people')}
              bind:searchName={targetSearch}
              bind:searchedPeopleLocal
            />
          </div>
        </div>

        <!-- Capped to roughly a single row: this list is a one-off pick, so it shouldn't
             eat the vertical space the unnamed list below actually needs. Scrolls for more. -->
        <div class="max-h-60 immich-scrollbar overflow-y-auto rounded-3xl bg-gray-200 p-6 dark:bg-immich-dark-gray">
          {#if namedCandidates.length === 0}
            <p class="text-center text-sm text-gray-600 dark:text-gray-300">{$t('no_results')}</p>
          {:else}
            <div class="grid grid-cols-3 gap-6 md:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10">
              {#each namedCandidates as candidate (candidate.id)}
                {@render candidateTile(candidate, selectTarget)}
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Unnamed people: multi-pick extras that ride along into the same merge. -->
    <div class="flex min-h-0 flex-1 flex-col">
      <h2 class="mb-3 text-sm uppercase dark:text-white">{$t('merge_unnamed_people')}</h2>

      <!-- This is the list the user actually works through, so it takes all remaining
           height and keeps a generous floor rather than collapsing to the height of
           however few candidates came back — a one-row-tall box reads as broken. -->
      <div
        class="min-h-100 flex-1 immich-scrollbar overflow-y-auto rounded-3xl bg-gray-200 p-6 dark:bg-immich-dark-gray"
      >
        {#if unnamedCandidates.length === 0}
          <p class="text-center text-sm text-gray-600 dark:text-gray-300">{$t('no_results')}</p>
        {:else}
          <div class="grid grid-cols-3 gap-6 md:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10">
            {#each unnamedCandidates as candidate (candidate.id)}
              {@render candidateTile(candidate, selectExtra)}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>
</section>
