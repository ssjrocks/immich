import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user_metadata.provider.dart';
import 'package:immich_mobile/repositories/face_api.repository.dart';
import 'package:immich_mobile/repositories/person_api.repository.dart';
import 'package:openapi/api.dart' show AssetFaceResponseDto, PersonVideoOccurrenceResponseDto, VideoFaceScanMode;

final driftPeopleRepositoryProvider = Provider<DriftPeopleRepository>(
  (ref) => DriftPeopleRepository(ref.watch(driftProvider)),
);

final driftPeopleServiceProvider = Provider<DriftPeopleService>(
  (ref) => DriftPeopleService(
    ref.watch(driftPeopleRepositoryProvider),
    ref.watch(personApiRepositoryProvider),
    ref.watch(faceApiRepositoryProvider),
  ),
);

final driftPeopleAssetProvider = FutureProvider.family<List<DriftPerson>, String>((ref, assetId) async {
  final service = ref.watch(driftPeopleServiceProvider);
  return service.getAssetPeople(assetId);
});

final driftGetAllPeopleProvider = FutureProvider<List<DriftPerson>>((ref) async {
  final service = ref.watch(driftPeopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  return service.getAllPeople(minFaces: prefs?.minimumFaces ?? 3);
});

/// Every video [personId] appears in, with every distinct timestamp they were detected at.
/// Empty for people with no video appearances (e.g. photo-only, or the fork's video-face
/// scanning has never run/found them).
final personVideoOccurrencesProvider = FutureProvider.family<List<PersonVideoOccurrenceResponseDto>, String>((
  ref,
  personId,
) async {
  final service = ref.watch(driftPeopleServiceProvider);
  return service.getVideoOccurrences(personId);
});

/// All faces detected on [assetId] in one call -- each carries its own faceId, assigned person,
/// and (for video) timestampMs. Backs the asset-viewer people section: grouping by person gives
/// both the per-asset appearance timestamps for the seek/edit chip picker and the faceId needed to
/// target reassign/unassign/delete actions at a specific appearance.
final assetFacesProvider = FutureProvider.family<List<AssetFaceResponseDto>, String>((ref, assetId) async {
  final service = ref.watch(driftPeopleServiceProvider);
  return service.getAssetFaces(assetId);
});

/// Whether the manual "scan video for faces" trigger should be offered: the server must have
/// facial recognition enabled and its video scan mode set to full-scan. Resolves to false (rather
/// than throwing) if the config can't be fetched -- the button is simply omitted in that case.
final videoFaceScanEnabledProvider = FutureProvider<bool>((ref) async {
  try {
    final config = await ref.watch(apiServiceProvider).systemConfigApi.getConfig();
    final facialRecognition = config?.machineLearning.facialRecognition;
    if (facialRecognition == null) {
      return false;
    }
    return facialRecognition.enabled && facialRecognition.video.scanMode == VideoFaceScanMode.fullScan;
  } catch (_) {
    return false;
  }
});
