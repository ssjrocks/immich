import { deletePerson, updatePerson, type PersonResponseDto } from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import {
  mdiAccountRemoveOutline,
  mdiCalendarEditOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiHeartMinusOutline,
  mdiHeartOutline,
} from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { eventManager } from '$lib/managers/event-manager.svelte';
import PersonEditBirthDateModal from '$lib/modals/PersonEditBirthDateModal.svelte';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

export const getPersonActions = ($t: MessageFormatter, person: PersonResponseDto) => {
  const SetDateOfBirth: ActionItem = {
    title: $t('set_date_of_birth'),
    icon: mdiCalendarEditOutline,
    onAction: () => modalManager.show(PersonEditBirthDateModal, { person }),
  };

  const Favorite: ActionItem = {
    title: $t('to_favorite'),
    icon: mdiHeartOutline,
    $if: () => !person.isFavorite,
    onAction: () => handleFavoritePerson(person),
  };

  const Unfavorite: ActionItem = {
    title: $t('unfavorite'),
    icon: mdiHeartMinusOutline,
    $if: () => !!person.isFavorite,
    onAction: () => handleUnfavoritePerson(person),
  };

  const HidePerson: ActionItem = {
    title: $t('hide_person'),
    icon: mdiEyeOffOutline,
    $if: () => !person.isHidden,
    onAction: () => handleHidePerson(person),
  };

  const ShowPerson: ActionItem = {
    title: $t('unhide_person'),
    icon: mdiEyeOutline,
    $if: () => !!person.isHidden,
    onAction: () => handleShowPerson(person),
  };

  const DeletePersonResetFaces: ActionItem = {
    title: $t('delete_person_reset_faces'),
    icon: mdiAccountRemoveOutline,
    color: 'danger',
    onAction: () => handleDeletePersonResetFaces(person),
  };

  return { SetDateOfBirth, Favorite, Unfavorite, HidePerson, ShowPerson, DeletePersonResetFaces };
};

const handleFavoritePerson = async (person: { id: string }) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { isFavorite: true } });
    eventManager.emit('PersonUpdate', response);
    toastManager.primary($t('added_to_favorites'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: false } }));
  }
};

const handleUnfavoritePerson = async (person: { id: string }) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { isFavorite: false } });
    eventManager.emit('PersonUpdate', response);
    toastManager.primary($t('removed_from_favorites'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: false } }));
  }
};

const handleHidePerson = async (person: { id: string }) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { isHidden: true } });
    toastManager.primary($t('changed_visibility_successfully'));
    eventManager.emit('PersonUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.unable_to_hide_person'));
  }
};

const handleShowPerson = async (person: { id: string }) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { isHidden: false } });
    toastManager.primary($t('changed_visibility_successfully'));
    eventManager.emit('PersonUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.something_went_wrong'));
  }
};

// Deletes the person outright rather than merely unassigning their faces, so a badly-merged
// cluster (faces of several different real people wrongly grouped under one name) can be fully
// undone. Deleting a person only unlinks their faces (personId set to null); the faces themselves
// aren't deleted and are picked up again by the next facial recognition run, same as
// deleteAllUnnamedPeople on the people-manage page.
const handleDeletePersonResetFaces = async (person: PersonResponseDto) => {
  const $t = await getFormatter();
  const name = person.name || $t('unnamed_person');

  const isConfirmed = await modalManager.showDialog({
    prompt: $t('confirm_delete_person_reset_faces', { values: { name } }),
  });
  if (!isConfirmed) {
    return;
  }

  try {
    await deletePerson({ id: person.id });
    toastManager.primary($t('deleted_person_reset_faces', { values: { name } }));
    await goto(Route.people());
  } catch (error) {
    handleError(error, $t('error_delete_person_reset_faces'));
  }
};

export const handleUpdatePersonBirthDate = async (person: PersonResponseDto, birthDate: string | null) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { birthDate } });
    toastManager.primary($t('date_of_birth_saved'));
    eventManager.emit('PersonUpdate', response);
    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_save_date_of_birth'));
  }
};
