import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/duration_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/asset_viewer.page.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart' show PersonVideoOccurrenceResponseDto;

/// Row height used by [_VideoOccurrenceTile], kept as a constant so the containing
/// page can estimate this section's total height for the scrubber's month-snapping
/// offset without needing a second source of truth.
const double personVideoAppearanceRowHeight = 88;

/// Height of the section header (label + paddings) above the list of rows.
const double personVideoAppearanceHeaderHeight = 48;

/// Estimates the total height of [PersonVideoAppearances] for a given number of
/// video occurrences. Returns 0 when there are none, since the section renders
/// nothing in that case.
double estimatePersonVideoAppearancesHeight(int occurrenceCount) {
  if (occurrenceCount == 0) {
    return 0;
  }
  return personVideoAppearanceHeaderHeight + (occurrenceCount * personVideoAppearanceRowHeight);
}

/// De-duplicates and sorts a video's timestamps ascending. The API can return
/// duplicate timestamps (e.g. overlapping face detections from a reassign/rescan).
List<int> _dedupedSortedTimestamps(List<int> timestampsMs) {
  final unique = timestampsMs.toSet().toList();
  unique.sort();
  return unique;
}

/// A section listing every video a person appears in, with a tap-through to a
/// bottom sheet showing every distinct timestamp within that video. Renders nothing
/// when the person has no video appearances.
class PersonVideoAppearances extends ConsumerWidget {
  final String personId;

  const PersonVideoAppearances({super.key, required this.personId});

  Future<void> _openOccurrence(BuildContext context, WidgetRef ref, PersonVideoOccurrenceResponseDto occurrence) {
    final timestamps = _dedupedSortedTimestamps(occurrence.timestampsMs);
    return showModalBottomSheet(
      context: context,
      backgroundColor: context.colorScheme.surface,
      isScrollControlled: true,
      builder: (context) {
        return _VideoOccurrenceSheet(occurrence: occurrence, timestampsMs: timestamps);
      },
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final occurrencesAsync = ref.watch(personVideoOccurrencesProvider(personId));

    return occurrencesAsync.when(
      data: (occurrences) {
        if (occurrences.isEmpty) {
          return const SizedBox.shrink();
        }

        // Most-appearances-first, so the video worth looking at first is at the top
        // of the list instead of requiring a scroll through everything to find it.
        final sorted = [...occurrences]
          ..sort(
            (a, b) => _dedupedSortedTimestamps(
              b.timestampsMs,
            ).length.compareTo(_dedupedSortedTimestamps(a.timestampsMs).length),
          );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 16, top: 16, bottom: 8),
              child: Text(
                "appears_in_videos".t(context: context),
                style: context.textTheme.labelLarge?.copyWith(color: context.colorScheme.onSurfaceSecondary),
              ),
            ),
            for (final occurrence in sorted)
              _VideoOccurrenceRow(occurrence: occurrence, onTap: () => _openOccurrence(context, ref, occurrence)),
          ],
        );
      },
      error: (_, __) => const SizedBox.shrink(),
      loading: () => const SizedBox.shrink(),
    );
  }
}

class _VideoOccurrenceRow extends StatelessWidget {
  final PersonVideoOccurrenceResponseDto occurrence;
  final VoidCallback onTap;

  const _VideoOccurrenceRow({required this.occurrence, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final timestamps = _dedupedSortedTimestamps(occurrence.timestampsMs);
    final firstTimestampMs = timestamps.isNotEmpty ? timestamps.first : 0;

    return InkWell(
      onTap: onTap,
      child: SizedBox(
        height: personVideoAppearanceRowHeight,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: 96,
                  height: double.infinity,
                  child: Image(
                    image: RemoteImageProvider(url: getVideoFrameUrl(occurrence.assetId, firstTimestampMs)),
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) => Container(
                      color: context.colorScheme.surfaceContainerHighest,
                      child: Icon(Icons.movie_outlined, color: context.colorScheme.onSurfaceSecondary),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      occurrence.originalFileName,
                      style: context.textTheme.bodyLarge,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      "appearance_count".t(context: context, args: {"count": timestamps.length}),
                      style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceSecondary),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: context.colorScheme.onSurfaceSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

class _VideoOccurrenceSheet extends ConsumerWidget {
  final PersonVideoOccurrenceResponseDto occurrence;
  final List<int> timestampsMs;

  const _VideoOccurrenceSheet({required this.occurrence, required this.timestampsMs});

  Future<void> _openAsset(BuildContext context, WidgetRef ref, int timestampMs) async {
    final asset = await ref.read(assetServiceProvider).getRemoteAsset(occurrence.assetId);
    if (asset == null || !context.mounted) {
      return;
    }

    Navigator.of(context).pop();

    AssetViewer.setAsset(ref, asset);
    unawaited(
      context.pushRoute(
        AssetViewerRoute(
          initialIndex: 0,
          timelineService: ref.read(timelineFactoryProvider).fromAssets([asset], TimelineOrigin.deepLink),
          initialSeekMs: timestampMs,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final durationMs = occurrence.durationMs;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    occurrence.originalFileName,
                    style: context.textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (durationMs != null) ...[
                  const SizedBox(width: 8),
                  Text(
                    Duration(milliseconds: durationMs).format(),
                    style: context.textTheme.bodyMedium?.copyWith(color: context.colorScheme.onSurfaceSecondary),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 16),
            Flexible(
              child: GridView.builder(
                shrinkWrap: true,
                itemCount: timestampsMs.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 0.85,
                ),
                itemBuilder: (context, index) {
                  final timestampMs = timestampsMs[index];
                  return _TimestampTile(
                    assetId: occurrence.assetId,
                    timestampMs: timestampMs,
                    onTap: () => _openAsset(context, ref, timestampMs),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TimestampTile extends StatelessWidget {
  final String assetId;
  final int timestampMs;
  final VoidCallback onTap;

  const _TimestampTile({required this.assetId, required this.timestampMs, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: double.infinity,
                child: Image(
                  image: RemoteImageProvider(url: getVideoFrameUrl(assetId, timestampMs)),
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) => Container(
                    color: context.colorScheme.surfaceContainerHighest,
                    child: Icon(Icons.movie_outlined, color: context.colorScheme.onSurfaceSecondary),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            Duration(milliseconds: timestampMs).format(),
            style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceSecondary),
          ),
        ],
      ),
    );
  }
}
