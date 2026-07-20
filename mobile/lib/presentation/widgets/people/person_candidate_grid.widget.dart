import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

/// Shared candidate grid + "no results, create new" fallback for the "wrong person" and "merge"
/// pickers (see [ReassignFaceModal] and [MergeIntoPersonModal]) -- identical layout, different
/// candidate source and selection outcome.
class PersonCandidateResults extends StatelessWidget {
  final bool isLoading;
  final List<PersonDto> candidates;
  final String query;
  final bool isCreating;
  final ValueChanged<PersonDto> onSelected;
  final VoidCallback onCreate;

  const PersonCandidateResults({
    super.key,
    required this.isLoading,
    required this.candidates,
    required this.query,
    required this.isCreating,
    required this.onSelected,
    required this.onCreate,
  });

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (candidates.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('no_results'.t(context: context), style: context.textTheme.bodyMedium),
            if (query.isNotEmpty) ...[
              const SizedBox(height: 12),
              FilledButton(
                onPressed: isCreating ? null : onCreate,
                child: Text('create_person_named'.t(context: context, args: {'name': query})),
              ),
            ],
          ],
        ),
      );
    }

    return GridView.builder(
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 0.8,
      ),
      itemCount: candidates.length,
      itemBuilder: (context, index) {
        final candidate = candidates[index];
        return InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => onSelected(candidate),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(radius: 32, backgroundImage: RemoteImageProvider(url: getFaceThumbnailUrl(candidate.id))),
              const SizedBox(height: 4),
              Text(
                candidate.name.isEmpty ? 'face_unassigned'.t(context: context) : candidate.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: context.textTheme.labelSmall,
              ),
            ],
          ),
        );
      },
    );
  }
}
