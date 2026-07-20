import 'dart:async';

import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';
import 'package:immich_mobile/repositories/face_api.repository.dart';
import 'package:immich_mobile/repositories/person_api.repository.dart';
import 'package:openapi/api.dart' show AssetFaceResponseDto, PersonVideoOccurrenceResponseDto;

class DriftPeopleService {
  final DriftPeopleRepository _repository;
  final PersonApiRepository _personApiRepository;
  final FaceApiRepository _faceApiRepository;

  const DriftPeopleService(this._repository, this._personApiRepository, this._faceApiRepository);

  Future<DriftPerson?> get(String personId) {
    return _repository.get(personId);
  }

  Future<List<DriftPerson>> getAssetPeople(String assetId) {
    return _repository.getAssetPeople(assetId);
  }

  Future<List<DriftPerson>> getAllPeople({int minFaces = 3}) {
    return _repository.getAllPeople(minFaces: minFaces);
  }

  Future<int> updateName(String personId, String name) async {
    await _personApiRepository.update(personId, name: name);
    return _repository.updateName(personId, name);
  }

  Future<int> updateBrithday(String personId, DateTime birthday) async {
    await _personApiRepository.update(personId, birthday: birthday);
    return _repository.updateBirthday(personId, birthday);
  }

  /// Every video this person appears in, with every distinct timestamp they were detected at.
  Future<List<PersonVideoOccurrenceResponseDto>> getVideoOccurrences(String personId) {
    return _personApiRepository.getVideoOccurrences(personId);
  }

  /// Candidate people for a "wrong person"/reassign picker, ranked by similarity to the specific
  /// mistagged face ([closestAssetId]), or for a merge picker, ranked by similarity to the whole
  /// person ([closestPersonId]). Exactly one of the two should be provided.
  Future<List<PersonDto>> getReassignCandidates({String? closestAssetId, String? closestPersonId}) {
    return _personApiRepository.getCandidates(closestAssetId: closestAssetId, closestPersonId: closestPersonId);
  }

  Future<PersonDto> createPerson({String? name}) {
    return _personApiRepository.create(name: name);
  }

  /// Fixes a single mistagged face -- only [faceId] moves to [targetPersonId]; nothing else about
  /// either person changes.
  Future<void> reassignFace(String targetPersonId, String faceId) {
    return _faceApiRepository.reassign(targetPersonId, faceId);
  }

  /// Merges [sourcePersonId]'s entire identity into [targetPersonId]; [sourcePersonId] stops
  /// existing afterward.
  Future<void> mergePersons(String targetPersonId, String sourcePersonId) {
    return _personApiRepository.mergeInto(targetPersonId, sourcePersonId);
  }

  /// Detaches [faceId] from its person without deleting it, so it can be re-matched later.
  Future<void> unassignFace(String faceId) {
    return _faceApiRepository.unassign(faceId);
  }

  /// Permanently deletes [faceId] ("not a face").
  Future<void> deleteFace(String faceId) {
    return _faceApiRepository.delete(faceId);
  }

  /// All faces on [assetId], used to resolve a specific faceId for a person before an edit action
  /// (reassign/unassign/delete) -- see [FaceApiRepository.getAssetFaces].
  Future<List<AssetFaceResponseDto>> getAssetFaces(String assetId) {
    return _faceApiRepository.getAssetFaces(assetId);
  }
}
