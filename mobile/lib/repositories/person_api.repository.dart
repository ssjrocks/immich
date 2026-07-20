import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:openapi/api.dart';

final personApiRepositoryProvider = Provider((ref) => PersonApiRepository(ref.watch(apiServiceProvider).peopleApi));

class PersonApiRepository extends ApiRepository {
  final PeopleApi _api;

  PersonApiRepository(this._api);

  Future<List<PersonDto>> getAll() async {
    final dto = await checkNull(_api.getAllPeople());
    return dto.people.map(_toPerson).toList();
  }

  Future<PersonDto> update(String id, {String? name, DateTime? birthday}) async {
    final birthdayUtc = birthday == null ? null : DateTime.utc(birthday.year, birthday.month, birthday.day);
    final dto = PersonUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name),
      birthDate: birthdayUtc == null ? const Optional.absent() : Optional.present(birthdayUtc),
    );
    final response = await checkNull(_api.updatePerson(id, dto));
    return _toPerson(response);
  }

  /// Candidates for a face-reassignment or person-merge picker, ranked by embedding similarity to
  /// [closestAssetId] (a specific mistagged face) or [closestPersonId] (a whole person's identity).
  Future<List<PersonDto>> getCandidates({String? closestAssetId, String? closestPersonId}) async {
    final dto = await checkNull(
      _api.getAllPeople(closestAssetId: closestAssetId, closestPersonId: closestPersonId, withHidden: true),
    );
    return dto.people.map(_toPerson).toList();
  }

  Future<PersonDto> create({String? name}) async {
    final response = await checkNull(
      _api.createPerson(PersonCreateDto(name: name == null ? const Optional.absent() : Optional.present(name))),
    );
    return _toPerson(response);
  }

  /// Merges the entire [sourcePersonId] identity (all of their faces/assets) into [targetPersonId].
  /// [sourcePersonId] stops existing as a separate person afterward.
  Future<void> mergeInto(String targetPersonId, String sourcePersonId) async {
    await _api.mergePerson(targetPersonId, MergePersonDto(ids: [sourcePersonId]));
  }

  Future<List<PersonVideoOccurrenceResponseDto>> getVideoOccurrences(String personId) async {
    return checkNull(_api.getPersonVideoOccurrences(personId));
  }

  static PersonDto _toPerson(PersonResponseDto dto) => PersonDto(
    birthDate: dto.birthDate,
    id: dto.id,
    isHidden: dto.isHidden,
    name: dto.name,
    thumbnailPath: dto.thumbnailPath,
  );
}
