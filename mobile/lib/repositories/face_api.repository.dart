import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:openapi/api.dart';

final faceApiRepositoryProvider = Provider((ref) => FaceApiRepository(ref.watch(apiServiceProvider).facesApi));

class FaceApiRepository extends ApiRepository {
  final FacesApi _api;

  FaceApiRepository(this._api);

  /// Detaches [faceId] from its person without deleting it -- the face survives unassigned and
  /// can be re-matched by a future facial-recognition run.
  Future<void> unassign(String faceId) async {
    await _api.unassignFace(faceId);
  }

  /// Permanently deletes [faceId] ("not a face").
  Future<void> delete(String faceId) async {
    await _api.deleteFace(faceId, AssetFaceDeleteDto(force: false));
  }

  /// Re-assigns [faceId] to [personId] ("wrong person" fix), leaving that face's previous person
  /// and all its other faces untouched -- not a merge.
  Future<void> reassign(String personId, String faceId) async {
    await _api.reassignFacesById(personId, FaceDto(id: faceId));
  }

  /// All faces detected on [assetId] -- each with its own face id, assigned person (if any), and,
  /// for videos, the timestamp it was detected at. Neither the local person mirror nor the video
  /// occurrences summary carry per-face ids, so this is the only way to resolve a specific faceId
  /// (e.g. to target one of several timestamped appearances for reassign/unassign/delete).
  Future<List<AssetFaceResponseDto>> getAssetFaces(String assetId) async {
    return await _api.getFaces(assetId) ?? [];
  }
}
