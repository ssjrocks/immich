import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Per-face edit actions for a person tagged in the asset viewer, shown once a specific face has
/// been resolved (single appearance, or an explicitly picked video timestamp). Rename lives
/// elsewhere (tap the person's name -- see [DriftPersonNameEditForm]) since it edits the person's
/// identity, not this one face.
class PersonEditActionsSheet extends StatelessWidget {
  final String personName;
  final VoidCallback onWrongPerson;
  final VoidCallback onMerge;
  final VoidCallback onRemoveFromPerson;
  final VoidCallback onDeleteFace;

  const PersonEditActionsSheet({
    super.key,
    required this.personName,
    required this.onWrongPerson,
    required this.onMerge,
    required this.onRemoveFromPerson,
    required this.onDeleteFace,
  });

  @override
  Widget build(BuildContext context) {
    final textStyle = context.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24.0),
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              child: Text(
                personName.isEmpty ? 'face_unassigned'.t(context: context) : personName,
                style: context.textTheme.labelLarge?.copyWith(color: context.colorScheme.onSurfaceSecondary),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.person_search_outlined),
              title: Text('wrong_person'.t(context: context), style: textStyle),
              subtitle: Text('wrong_person_description'.t(context: context)),
              onTap: onWrongPerson,
            ),
            ListTile(
              leading: const Icon(Icons.merge_outlined),
              title: Text('merge_people'.t(context: context), style: textStyle),
              onTap: onMerge,
            ),
            ListTile(
              leading: const Icon(Icons.person_remove_outlined),
              title: Text('remove_from_person'.t(context: context), style: textStyle),
              onTap: onRemoveFromPerson,
            ),
            ListTile(
              leading: Icon(Icons.person_off_outlined, color: context.colorScheme.error),
              title: Text(
                'delete_face'.t(context: context),
                style: textStyle?.copyWith(color: context.colorScheme.error),
              ),
              onTap: onDeleteFace,
            ),
          ],
        ),
      ),
    );
  }
}
