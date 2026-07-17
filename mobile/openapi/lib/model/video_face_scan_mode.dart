//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// How videos are treated by facial recognition
class VideoFaceScanMode {
  /// Instantiate a new enum with the provided [value].
  const VideoFaceScanMode._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const thumbnailOnly = VideoFaceScanMode._(r'thumbnailOnly');
  static const disabled = VideoFaceScanMode._(r'disabled');
  static const fullScan = VideoFaceScanMode._(r'fullScan');

  /// List of all possible values in this [enum][VideoFaceScanMode].
  static const values = <VideoFaceScanMode>[
    thumbnailOnly,
    disabled,
    fullScan,
  ];

  static VideoFaceScanMode? fromJson(dynamic value) => VideoFaceScanModeTypeTransformer().decode(value);

  static List<VideoFaceScanMode> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <VideoFaceScanMode>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = VideoFaceScanMode.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [VideoFaceScanMode] to String,
/// and [decode] dynamic data back to [VideoFaceScanMode].
class VideoFaceScanModeTypeTransformer {
  factory VideoFaceScanModeTypeTransformer() => _instance ??= const VideoFaceScanModeTypeTransformer._();

  const VideoFaceScanModeTypeTransformer._();

  String encode(VideoFaceScanMode data) => data.value;

  /// Decodes a [dynamic value][data] to a VideoFaceScanMode.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  VideoFaceScanMode? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'thumbnailOnly': return VideoFaceScanMode.thumbnailOnly;
        case r'disabled': return VideoFaceScanMode.disabled;
        case r'fullScan': return VideoFaceScanMode.fullScan;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [VideoFaceScanModeTypeTransformer] instance.
  static VideoFaceScanModeTypeTransformer? _instance;
}

