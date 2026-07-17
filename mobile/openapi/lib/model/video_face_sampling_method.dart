//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

/// How frames are sampled from a video during a full scan
class VideoFaceSamplingMethod {
  /// Instantiate a new enum with the provided [value].
  const VideoFaceSamplingMethod._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const frameCount = VideoFaceSamplingMethod._(r'frameCount');
  static const interval = VideoFaceSamplingMethod._(r'interval');

  /// List of all possible values in this [enum][VideoFaceSamplingMethod].
  static const values = <VideoFaceSamplingMethod>[
    frameCount,
    interval,
  ];

  static VideoFaceSamplingMethod? fromJson(dynamic value) => VideoFaceSamplingMethodTypeTransformer().decode(value);

  static List<VideoFaceSamplingMethod> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <VideoFaceSamplingMethod>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = VideoFaceSamplingMethod.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [VideoFaceSamplingMethod] to String,
/// and [decode] dynamic data back to [VideoFaceSamplingMethod].
class VideoFaceSamplingMethodTypeTransformer {
  factory VideoFaceSamplingMethodTypeTransformer() => _instance ??= const VideoFaceSamplingMethodTypeTransformer._();

  const VideoFaceSamplingMethodTypeTransformer._();

  String encode(VideoFaceSamplingMethod data) => data.value;

  /// Decodes a [dynamic value][data] to a VideoFaceSamplingMethod.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  VideoFaceSamplingMethod? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'frameCount': return VideoFaceSamplingMethod.frameCount;
        case r'interval': return VideoFaceSamplingMethod.interval;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [VideoFaceSamplingMethodTypeTransformer] instance.
  static VideoFaceSamplingMethodTypeTransformer? _instance;
}

