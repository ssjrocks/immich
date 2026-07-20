import 'package:auto_route/auto_route.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/duration_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/presentation/widgets/people/merge_into_person_modal.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/person_edit_actions_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/person_edit_name_modal.widget.dart';
import 'package:immich_mobile/presentation/widgets/people/reassign_face_modal.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/video_player_provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/routes.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/asset_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:immich_mobile/utils/people.utils.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:openapi/api.dart' show AssetFaceResponseDto, AssetJobName;

class PeopleDetails extends ConsumerStatefulWidget {
  final BaseAsset asset;

  const PeopleDetails({super.key, required this.asset});

  @override
  ConsumerState<PeopleDetails> createState() => _PeopleDetailsState();
}

class _PeopleDetailsState extends ConsumerState<PeopleDetails> {
  // Edit mode is a toggle -- while on, each person card grows a small edit badge that resolves a
  // target face (below) and opens [PersonEditActionsSheet] instead of navigating away.
  bool _editMode = false;

  // Which person's appearance-timestamp picker is currently expanded, if any. Shared by both
  // seeking (view mode) and target-face selection (edit mode) -- see [_handleAvatarTap].
  String? _expandedPersonId;

  // The appearance a person's edit actions should target, once explicitly picked from the
  // timestamp picker. Cleared whenever that person is affected by a mutation. Only meaningful for
  // people with more than one appearance in this asset -- see [_resolveFaceForEdit].
  final Map<String, int> _selectedTimestampMsByPerson = {};

  RemoteAsset get _asset => widget.asset as RemoteAsset;

  @override
  Widget build(BuildContext context) {
    final asset = widget.asset;
    if (asset is! RemoteAsset) {
      return const SizedBox.shrink();
    }

    final peopleAsync = ref.watch(driftPeopleAssetProvider(asset.id));
    final facesAsync = ref.watch(assetFacesProvider(asset.id));
    final currentUser = ref.watch(currentUserProvider);
    final videoFaceScanEnabled = asset.isVideo
        ? ref.watch(videoFaceScanEnabledProvider).valueOrNull ?? false
        : false;
    final canScanVideo = asset.isVideo && (currentUser?.isAdmin ?? false) && videoFaceScanEnabled;

    return peopleAsync.when(
      data: (people) {
        final facesByPerson = <String, List<AssetFaceResponseDto>>{};
        for (final face in facesAsync.valueOrNull ?? const <AssetFaceResponseDto>[]) {
          final personId = face.person?.id;
          if (personId == null) {
            continue;
          }
          (facesByPerson[personId] ??= []).add(face);
        }

        final expandedPerson = people.firstWhereOrNull((p) => p.id == _expandedPersonId);

        return AnimatedCrossFade(
          firstChild: const SizedBox.shrink(),
          secondChild: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(left: 16, right: 4, top: 16, bottom: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        "people".t(context: context),
                        style: context.textTheme.labelLarge?.copyWith(color: context.colorScheme.onSurfaceSecondary),
                      ),
                    ),
                    if (canScanVideo)
                      IconButton(
                        tooltip: 'scan_video_faces'.t(context: context),
                        icon: const Icon(Icons.face_retouching_natural),
                        onPressed: () => _scanVideoForFaces(asset.id),
                      ),
                    if (people.isNotEmpty)
                      IconButton(
                        tooltip: 'edit_people'.t(context: context),
                        icon: Icon(_editMode ? Icons.edit : Icons.edit_outlined),
                        color: _editMode ? context.primaryColor : null,
                        onPressed: () => setState(() {
                          _editMode = !_editMode;
                          _expandedPersonId = null;
                        }),
                      ),
                  ],
                ),
              ),
              SizedBox(
                height: 160,
                child: ListView(
                  padding: const EdgeInsets.only(left: 16.0),
                  scrollDirection: Axis.horizontal,
                  children: [
                    for (final person in people)
                      _PersonCard(
                        person: person,
                        assetFileCreatedAt: asset.createdAt,
                        isVideo: asset.isVideo,
                        editMode: _editMode,
                        personFaces: facesByPerson[person.id] ?? const [],
                        expanded: _expandedPersonId == person.id,
                        onAvatarTap: () => _handleAvatarTap(person, facesByPerson[person.id] ?? const []),
                        onNameTap: () => _showNameEditModal(person),
                        onEditBadgeTap: () => _handleEditBadgeTap(person, facesByPerson[person.id] ?? const []),
                      ),
                  ],
                ),
              ),
              AnimatedCrossFade(
                firstChild: const SizedBox.shrink(),
                secondChild: expandedPerson == null
                    ? const SizedBox.shrink()
                    : _AppearancePicker(
                        person: expandedPerson,
                        faces: facesByPerson[expandedPerson.id] ?? const [],
                        editMode: _editMode,
                        selectedTimestampMs: _selectedTimestampMsByPerson[expandedPerson.id],
                        onClose: () => setState(() => _expandedPersonId = null),
                        onSelect: (ms) => _handleChipTap(expandedPerson.id, ms),
                      ),
                crossFadeState: expandedPerson == null ? CrossFadeState.showFirst : CrossFadeState.showSecond,
                duration: Durations.short4,
              ),
            ],
          ),
          crossFadeState: people.isEmpty ? CrossFadeState.showFirst : CrossFadeState.showSecond,
          duration: Durations.short4,
        );
      },
      error: (error, stack) => Text("error_loading_people".t(context: context), style: context.textTheme.bodyMedium),
      loading: () => const SizedBox.shrink(),
    );
  }

  List<int> _distinctTimestamps(List<AssetFaceResponseDto> faces) {
    final timestamps = <int>{};
    for (final face in faces) {
      final ms = face.timestampMs.orElse(null);
      if (ms != null) {
        timestamps.add(ms);
      }
    }
    return timestamps.toList()..sort();
  }

  Future<void> _showNameEditModal(DriftPerson person) async {
    await showDialog(context: context, useRootNavigator: false, builder: (context) => DriftPersonNameEditForm(person: person));

    if (!mounted) {
      return;
    }
    ref.invalidate(driftPeopleAssetProvider(_asset.id));
  }

  void _handleAvatarTap(DriftPerson person, List<AssetFaceResponseDto> personFaces) {
    if (_asset.isVideo && _distinctTimestamps(personFaces).length > 1) {
      setState(() => _expandedPersonId = _expandedPersonId == person.id ? null : person.id);
      return;
    }

    final previousRouteData = ref.read(previousRouteDataProvider);
    final previousRouteArgs = previousRouteData?.arguments;

    // Prevent circular navigation
    if (previousRouteArgs is DriftPersonRouteArgs && previousRouteArgs.person.id == person.id) {
      context.back();
      return;
    }
    ContextHelper(context).pop();
    context.pushRoute(DriftPersonRoute(person: person));
  }

  void _handleChipTap(String personId, int timestampMs) {
    if (_editMode) {
      setState(() => _selectedTimestampMsByPerson[personId] = timestampMs);
      return;
    }

    ref.read(videoPlayerProvider(_asset.heroTag).notifier).seekTo(Duration(milliseconds: timestampMs));
    setState(() => _expandedPersonId = null);
  }

  /// Resolves which single face a person's edit actions should target. A person with only one
  /// appearance in this asset has nothing to disambiguate. With several, an appearance must have
  /// already been explicitly picked from the timestamp picker -- if not, this opens/focuses the
  /// picker instead of guessing, and returns null so the caller bails out.
  AssetFaceResponseDto? _resolveFaceForEdit(DriftPerson person, List<AssetFaceResponseDto> personFaces) {
    if (personFaces.isEmpty) {
      return null;
    }
    if (personFaces.length == 1) {
      return personFaces.first;
    }

    final selectedMs = _selectedTimestampMsByPerson[person.id];
    final match = selectedMs == null
        ? null
        : personFaces.firstWhereOrNull((face) => face.timestampMs.orElse(null) == selectedMs);
    if (match != null) {
      return match;
    }

    setState(() => _expandedPersonId = person.id);
    return null;
  }

  void _handleEditBadgeTap(DriftPerson person, List<AssetFaceResponseDto> personFaces) {
    final face = _resolveFaceForEdit(person, personFaces);
    if (face == null) {
      return;
    }
    _showEditActionsSheet(person, face.id);
  }

  Future<void> _showEditActionsSheet(DriftPerson person, String faceId) async {
    await showModalBottomSheet(
      context: context,
      useRootNavigator: false,
      builder: (context) => PersonEditActionsSheet(
        personName: person.name,
        onWrongPerson: () {
          Navigator.of(context).pop();
          _handleWrongPerson(person, faceId);
        },
        onMerge: () {
          Navigator.of(context).pop();
          _handleMerge(person);
        },
        onRemoveFromPerson: () {
          Navigator.of(context).pop();
          _handleUnassignFace(person, faceId);
        },
        onDeleteFace: () {
          Navigator.of(context).pop();
          _handleDeleteFace(person, faceId);
        },
      ),
    );
  }

  Future<bool> _confirm(String message) async {
    final result = await showDialog<bool>(
      context: context,
      useRootNavigator: false,
      builder: (context) => AlertDialog(
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(10))),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(
              'cancel'.t(context: context),
              style: TextStyle(color: context.primaryColor, fontWeight: FontWeight.bold),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'confirm'.t(context: context),
              style: TextStyle(color: context.colorScheme.error, fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  void _afterFaceMutation(String personId, {String? otherPersonId}) {
    ref.invalidate(driftPeopleAssetProvider(_asset.id));
    ref.invalidate(assetFacesProvider(_asset.id));
    ref.invalidate(personVideoOccurrencesProvider(personId));
    if (otherPersonId != null) {
      ref.invalidate(personVideoOccurrencesProvider(otherPersonId));
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _selectedTimestampMsByPerson.remove(personId);
      _expandedPersonId = null;
    });
  }

  // Scoped to a single face -- fixing "this face was tagged as the wrong person" doesn't claim the
  // two whole identities are the same person, so it never touches [person]'s other faces.
  Future<void> _handleWrongPerson(DriftPerson person, String faceId) async {
    final target = await showDialog<PersonDto>(
      context: context,
      useRootNavigator: false,
      builder: (context) => ReassignFaceModal(person: person, faceId: faceId),
    );
    if (target == null || !mounted) {
      return;
    }

    try {
      await ref.read(driftPeopleServiceProvider).reassignFace(target.id, faceId);
      _afterFaceMutation(person.id, otherPersonId: target.id);
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: 'reassigned_face_to_person'.t(context: context, args: {'name': target.name}),
          toastType: ToastType.success,
        );
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(context: context, msg: 'cannot_reassign_face'.t(context: context), toastType: ToastType.error);
      }
    }
  }

  Future<void> _handleMerge(DriftPerson person) async {
    final target = await showDialog<PersonDto>(
      context: context,
      useRootNavigator: false,
      builder: (context) => MergeIntoPersonModal(person: person),
    );
    if (target == null || !mounted) {
      return;
    }

    final targetName = target.name.isEmpty ? 'face_unassigned'.t(context: context) : target.name;
    final confirmed = await _confirm('merge_into_existing_person_prompt'.t(context: context, args: {'name': targetName}));
    if (!confirmed || !mounted) {
      return;
    }

    try {
      await ref.read(driftPeopleServiceProvider).mergePersons(target.id, person.id);
      _afterFaceMutation(person.id, otherPersonId: target.id);
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: 'merged_people_count'.t(context: context, args: {'count': 1}),
          toastType: ToastType.success,
        );
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(context: context, msg: 'cannot_merge_people'.t(context: context), toastType: ToastType.error);
      }
    }
  }

  Future<void> _handleUnassignFace(DriftPerson person, String faceId) async {
    final name = person.name.isEmpty ? 'face_unassigned'.t(context: context) : person.name;
    final confirmed = await _confirm('confirm_unassign_face'.t(context: context, args: {'name': name}));
    if (!confirmed || !mounted) {
      return;
    }

    try {
      await ref.read(driftPeopleServiceProvider).unassignFace(faceId);
      _afterFaceMutation(person.id);
    } catch (_) {
      if (mounted) {
        ImmichToast.show(context: context, msg: 'error_unassign_face'.t(context: context), toastType: ToastType.error);
      }
    }
  }

  Future<void> _handleDeleteFace(DriftPerson person, String faceId) async {
    final name = person.name.isEmpty ? 'face_unassigned'.t(context: context) : person.name;
    final confirmed = await _confirm('confirm_delete_face'.t(context: context, args: {'name': name}));
    if (!confirmed || !mounted) {
      return;
    }

    try {
      await ref.read(driftPeopleServiceProvider).deleteFace(faceId);
      _afterFaceMutation(person.id);
    } catch (_) {
      if (mounted) {
        ImmichToast.show(context: context, msg: 'error_delete_face'.t(context: context), toastType: ToastType.error);
      }
    }
  }

  Future<void> _scanVideoForFaces(String assetId) async {
    try {
      await ref.read(assetApiRepositoryProvider).runJob(assetId, AssetJobName.scanVideoFaces);
      if (mounted) {
        ImmichToast.show(context: context, msg: 'scanning_video_faces'.t(context: context), toastType: ToastType.info);
      }
    } catch (_) {
      if (mounted) {
        ImmichToast.show(
          context: context,
          msg: 'scaffold_body_error_occurred'.t(context: context),
          toastType: ToastType.error,
        );
      }
    }
  }
}

class _PersonCard extends StatelessWidget {
  final DriftPerson person;
  final DateTime assetFileCreatedAt;
  final bool isVideo;
  final bool editMode;
  final List<AssetFaceResponseDto> personFaces;
  final bool expanded;
  final VoidCallback onAvatarTap;
  final VoidCallback onNameTap;
  final VoidCallback onEditBadgeTap;
  final double imageSize = 96;

  const _PersonCard({
    required this.person,
    required this.assetFileCreatedAt,
    required this.isVideo,
    required this.editMode,
    required this.personFaces,
    required this.expanded,
    required this.onAvatarTap,
    required this.onNameTap,
    required this.onEditBadgeTap,
  });

  int get _appearanceCount {
    final timestamps = <int>{};
    for (final face in personFaces) {
      final ms = face.timestampMs.orElse(null);
      if (ms != null) {
        timestamps.add(ms);
      }
    }
    return timestamps.length;
  }

  @override
  Widget build(BuildContext context) {
    final hasMultipleAppearances = isVideo && _appearanceCount > 1;

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 96),
      child: Padding(
        padding: const EdgeInsets.only(right: 16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                GestureDetector(
                  onTap: onAvatarTap,
                  child: SizedBox(
                    height: imageSize,
                    child: Material(
                      shape: CircleBorder(
                        side: BorderSide(
                          color: expanded ? context.primaryColor : context.primaryColor.withAlpha(50),
                          width: expanded ? 2.0 : 1.0,
                        ),
                      ),
                      shadowColor: context.colorScheme.shadow,
                      elevation: 3,
                      child: CircleAvatar(
                        maxRadius: imageSize / 2,
                        backgroundImage: RemoteImageProvider(url: getFaceThumbnailUrl(person.id)),
                      ),
                    ),
                  ),
                ),
                if (hasMultipleAppearances)
                  Positioned(bottom: 0, left: 0, child: _CountBadge(count: _appearanceCount)),
                if (editMode) Positioned(top: -4, right: -4, child: _EditBadge(onTap: onEditBadgeTap)),
              ],
            ),
            const SizedBox(height: 4),
            if (person.name.isEmpty)
              GestureDetector(
                onTap: onNameTap,
                child: Text(
                  "add_a_name".t(context: context),
                  style: context.textTheme.labelLarge?.copyWith(color: context.primaryColor),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                ),
              )
            else
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    person.name,
                    textAlign: TextAlign.center,
                    overflow: TextOverflow.ellipsis,
                    style: context.textTheme.labelLarge,
                    maxLines: 1,
                  ),
                  if (person.birthDate != null)
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        formatAge(person.birthDate!, assetFileCreatedAt),
                        textAlign: TextAlign.center,
                        style: context.textTheme.bodyMedium?.copyWith(
                          color: context.textTheme.bodyMedium?.color?.withAlpha(175),
                        ),
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  final int count;

  const _CountBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: context.colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: context.colorScheme.outline.withAlpha(125)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.movie_creation_outlined, size: 10, color: context.primaryColor),
          const SizedBox(width: 2),
          Text('$count', style: context.textTheme.labelSmall?.copyWith(fontSize: 9)),
        ],
      ),
    );
  }
}

class _EditBadge extends StatelessWidget {
  final VoidCallback onTap;

  const _EditBadge({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: context.primaryColor,
      shape: const CircleBorder(),
      elevation: 2,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(4.0),
          child: Icon(Icons.edit, size: 14, color: context.colorScheme.onPrimary),
        ),
      ),
    );
  }
}

/// Appearance-timestamp picker for a video person, expanded below the people row. In view mode,
/// tapping a chip seeks the video player there; in edit mode, it instead selects that appearance
/// as the target for the person's edit actions (see [_PeopleDetailsState._resolveFaceForEdit]).
class _AppearancePicker extends StatelessWidget {
  final DriftPerson person;
  final List<AssetFaceResponseDto> faces;
  final bool editMode;
  final int? selectedTimestampMs;
  final VoidCallback onClose;
  final ValueChanged<int> onSelect;

  const _AppearancePicker({
    required this.person,
    required this.faces,
    required this.editMode,
    required this.selectedTimestampMs,
    required this.onClose,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final timestamps = <int>{};
    for (final face in faces) {
      final ms = face.timestampMs.orElse(null);
      if (ms != null) {
        timestamps.add(ms);
      }
    }
    final sorted = timestamps.toList()..sort();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.colorScheme.outline.withAlpha(75)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  person.name.isEmpty ? 'face_unassigned'.t(context: context) : person.name,
                  style: context.textTheme.labelLarge,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              InkWell(
                customBorder: const CircleBorder(),
                onTap: onClose,
                child: const Padding(padding: EdgeInsets.all(4.0), child: Icon(Icons.close, size: 18)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final ms in sorted)
                _TimestampChip(ms: ms, selected: editMode && selectedTimestampMs == ms, onTap: () => onSelect(ms)),
            ],
          ),
        ],
      ),
    );
  }
}

class _TimestampChip extends StatelessWidget {
  final int ms;
  final bool selected;
  final VoidCallback onTap;

  const _TimestampChip({required this.ms, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? context.primaryColor : context.colorScheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          Duration(milliseconds: ms).format(),
          style: context.textTheme.labelMedium?.copyWith(
            color: selected ? context.colorScheme.onPrimary : null,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
