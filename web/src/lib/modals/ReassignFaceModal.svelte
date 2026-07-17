<script lang="ts">
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import SearchPeople from '$lib/components/faces-page/PeopleSearch.svelte';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { createPerson, getAllPeople, type PersonResponseDto } from '@immich/sdk';
  import { Button, Modal, ModalBody, Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    person: PersonResponseDto;
    faceId?: string;
    onClose: (target?: PersonResponseDto) => void;
  };

  let { person, faceId, onClose }: Props = $props();

  let suggestedPeople: PersonResponseDto[] = $state([]);
  let searchName = $state('');
  let searchedPeopleLocal: PersonResponseDto[] = $state([]);
  let isCreating = $state(false);

  const candidates = $derived((searchName ? searchedPeopleLocal : suggestedPeople).filter((p) => p.id !== person.id));

  onMount(async () => {
    // Ranked by embedding similarity to the specific mistagged face (not to `person`, who is --
    // by definition -- the wrong match), so the right person is usually right at the top.
    const data = await getAllPeople({ withHidden: true, closestAssetId: faceId });
    suggestedPeople = data.people;
  });

  const createAndAssign = async () => {
    const name = searchName.trim();
    if (!name) {
      return;
    }
    try {
      isCreating = true;
      const created = await createPerson({ personCreateDto: { name } });
      onClose(created);
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_name'));
    } finally {
      isCreating = false;
    }
  };
</script>

<Modal title={$t('wrong_person')} {onClose} size="small">
  <ModalBody>
    <Text size="small" color="muted" class="mb-4">{$t('wrong_person_description')}</Text>
    <div class="mb-4">
      <SearchPeople type="searchBar" placeholder={$t('search_people')} bind:searchName bind:searchedPeopleLocal />
    </div>
    {#if candidates.length === 0}
      <Text size="small" color="muted">{$t('no_results')}</Text>
      {#if searchName.trim()}
        <Button size="small" class="mt-2" disabled={isCreating} onclick={createAndAssign}>
          {$t('create_person_named', { values: { name: searchName.trim() } })}
        </Button>
      {/if}
    {:else}
      <div class="grid max-h-100 grid-cols-4 gap-4 overflow-y-auto immich-scrollbar">
        {#each candidates as candidate (candidate.id)}
          <button
            type="button"
            class="flex flex-col items-center gap-1 rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            onclick={() => onClose(candidate)}
          >
            <ImageThumbnail
              curve
              shadow
              circle
              url={getPeopleThumbnailUrl(candidate)}
              altText={candidate.name}
              widthStyle="72px"
              heightStyle="72px"
            />
            <span class="w-full truncate text-center text-xs">{candidate.name || $t('face_unassigned')}</span>
          </button>
        {/each}
      </div>
    {/if}
  </ModalBody>
</Modal>
