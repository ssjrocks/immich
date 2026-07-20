import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/people/person_candidate_grid.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';

/// "Merge into" picker: search + ranked candidate grid + create-new-person fallback. Ranks
/// candidates by similarity to [person]'s whole identity (unlike [ReassignFaceModal], which ranks
/// by a single mistagged face). Returns the chosen (or newly created) [PersonDto] -- the caller is
/// responsible for confirming and performing the actual merge, since it's destructive.
class MergeIntoPersonModal extends ConsumerStatefulWidget {
  final DriftPerson person;

  const MergeIntoPersonModal({super.key, required this.person});

  @override
  ConsumerState<MergeIntoPersonModal> createState() => _MergeIntoPersonModalState();
}

class _MergeIntoPersonModalState extends ConsumerState<MergeIntoPersonModal> {
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
          .getReassignCandidates(closestPersonId: widget.person.id);
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
      title: Text('merge_people'.t(context: context), style: const TextStyle(fontWeight: FontWeight.bold)),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
