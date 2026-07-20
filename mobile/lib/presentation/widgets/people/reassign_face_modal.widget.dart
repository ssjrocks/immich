import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/theme_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/people/person_candidate_grid.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

/// "Wrong person" picker: search + ranked candidate grid + create-new-person fallback. Ranks
/// candidates by similarity to the specific mistagged [faceId] (not [person], who is by
/// definition the wrong match), so the right person is usually right at the top. Returns the
/// chosen (or newly created) [PersonDto] via [Navigator.pop], or null if cancelled.
class ReassignFaceModal extends ConsumerStatefulWidget {
  final DriftPerson person;
  final String faceId;

  const ReassignFaceModal({super.key, required this.person, required this.faceId});

  @override
  ConsumerState<ReassignFaceModal> createState() => _ReassignFaceModalState();
}

class _ReassignFaceModalState extends ConsumerState<ReassignFaceModal> {
  final _searchController = TextEditingController();
  List<PersonDto> _candidates = [];
  bool _isLoading = true;
  bool _isCreating = false;

  @override
  void initState() {
    super.initState();
    _loadCandidates();
    _searchController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadCandidates() async {
    try {
      final candidates = await ref
          .read(driftPeopleServiceProvider)
          .getReassignCandidates(closestAssetId: widget.faceId);
      if (!mounted) {
        return;
      }
      setState(() {
        _candidates = candidates;
        _isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _isLoading = false);
    }
  }

  List<PersonDto> get _filteredCandidates {
    final query = _searchController.text.trim().toLowerCase();
    final base = _candidates.where((candidate) => candidate.id != widget.person.id);
    if (query.isEmpty) {
      return base.toList();
    }
    return base.where((candidate) => candidate.name.toLowerCase().contains(query)).toList();
  }

  Future<void> _createAndSelect() async {
    final name = _searchController.text.trim();
    if (name.isEmpty || _isCreating) {
      return;
    }
    setState(() => _isCreating = true);
    try {
      final created = await ref.read(driftPeopleServiceProvider).createPerson(name: name);
      if (!mounted) {
        return;
      }
      context.pop<PersonDto>(created);
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() => _isCreating = false);
      ImmichToast.show(
        context: context,
        msg: 'scaffold_body_error_occurred'.t(context: context),
        gravity: ToastGravity.BOTTOM,
        toastType: ToastType.error,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('wrong_person'.t(context: context), style: const TextStyle(fontWeight: FontWeight.bold)),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'wrong_person_description'.t(context: context),
              style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceSecondary),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _searchController,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                hintText: 'search_people'.t(context: context),
                border: const OutlineInputBorder(),
                prefixIcon: const Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 260,
              child: PersonCandidateResults(
                isLoading: _isLoading,
                candidates: _filteredCandidates,
                query: _searchController.text.trim(),
                isCreating: _isCreating,
                onSelected: (person) => context.pop<PersonDto>(person),
                onCreate: _createAndSelect,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => context.pop(null),
          child: Text(
            "cancel",
            style: TextStyle(color: Colors.red[300], fontWeight: FontWeight.bold),
          ).tr(),
        ),
      ],
    );
  }
}
