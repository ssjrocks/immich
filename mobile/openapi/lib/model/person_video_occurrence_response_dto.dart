//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PersonVideoOccurrenceResponseDto {
  /// Returns a new [PersonVideoOccurrenceResponseDto] instance.
  PersonVideoOccurrenceResponseDto({
    required this.assetId,
    required this.durationMs,
    required this.originalFileName,
    this.timestampsMs = const [],
  });

  /// Asset ID of the video
  String assetId;

  /// Duration of the video in milliseconds
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int? durationMs;

  /// Original filename of the video
  String originalFileName;

  /// Timestamps (ms from video start) where this person appears
  List<int> timestampsMs;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PersonVideoOccurrenceResponseDto &&
    other.assetId == assetId &&
    other.durationMs == durationMs &&
    other.originalFileName == originalFileName &&
    _deepEquality.equals(other.timestampsMs, timestampsMs);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode) +
    (durationMs == null ? 0 : durationMs!.hashCode) +
    (originalFileName.hashCode) +
    (timestampsMs.hashCode);

  @override
  String toString() => 'PersonVideoOccurrenceResponseDto[assetId=$assetId, durationMs=$durationMs, originalFileName=$originalFileName, timestampsMs=$timestampsMs]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
    if (this.durationMs != null) {
      json[r'durationMs'] = this.durationMs;
    } else {
      json[r'durationMs'] = null;
    }
      json[r'originalFileName'] = this.originalFileName;
      json[r'timestampsMs'] = this.timestampsMs;
    return json;
  }

  /// Returns a new [PersonVideoOccurrenceResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PersonVideoOccurrenceResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "PersonVideoOccurrenceResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PersonVideoOccurrenceResponseDto(
        assetId: mapValueOfType<String>(json, r'assetId')!,
        durationMs: mapValueOfType<int>(json, r'durationMs'),
        originalFileName: mapValueOfType<String>(json, r'originalFileName')!,
        timestampsMs: json[r'timestampsMs'] is Iterable
            ? (json[r'timestampsMs'] as Iterable).cast<int>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<PersonVideoOccurrenceResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PersonVideoOccurrenceResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PersonVideoOccurrenceResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PersonVideoOccurrenceResponseDto> mapFromJson(dynamic json) {
    final map = <String, PersonVideoOccurrenceResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PersonVideoOccurrenceResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PersonVideoOccurrenceResponseDto-objects as value to a dart map
  static Map<String, List<PersonVideoOccurrenceResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PersonVideoOccurrenceResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PersonVideoOccurrenceResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
    'durationMs',
    'originalFileName',
    'timestampsMs',
  };
}

