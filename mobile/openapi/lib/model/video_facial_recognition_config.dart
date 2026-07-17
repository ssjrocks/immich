//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class VideoFacialRecognitionConfig {
  /// Returns a new [VideoFacialRecognitionConfig] instance.
  VideoFacialRecognitionConfig({
    required this.intervalSeconds,
    required this.maxFrames,
    required this.samplingMethod,
    required this.scanMode,
  });

  /// Seconds between captured frames when samplingMethod is \"interval\". Supports sub-second precision.
  ///
  /// Minimum value: 0.1
  /// Maximum value: 60
  double intervalSeconds;

  /// Maximum number of frames to sample per video. Used directly as the frame count in \"frameCount\" mode, or as a hard safety cap in \"interval\" mode. A hard ceiling to prevent a single long video from generating an unbounded number of face thumbnails.
  ///
  /// Minimum value: 1
  /// Maximum value: 10000
  int maxFrames;

  VideoFaceSamplingMethod samplingMethod;

  VideoFaceScanMode scanMode;

  @override
  bool operator ==(Object other) => identical(this, other) || other is VideoFacialRecognitionConfig &&
    other.intervalSeconds == intervalSeconds &&
    other.maxFrames == maxFrames &&
    other.samplingMethod == samplingMethod &&
    other.scanMode == scanMode;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (intervalSeconds.hashCode) +
    (maxFrames.hashCode) +
    (samplingMethod.hashCode) +
    (scanMode.hashCode);

  @override
  String toString() => 'VideoFacialRecognitionConfig[intervalSeconds=$intervalSeconds, maxFrames=$maxFrames, samplingMethod=$samplingMethod, scanMode=$scanMode]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'intervalSeconds'] = this.intervalSeconds;
      json[r'maxFrames'] = this.maxFrames;
      json[r'samplingMethod'] = this.samplingMethod;
      json[r'scanMode'] = this.scanMode;
    return json;
  }

  /// Returns a new [VideoFacialRecognitionConfig] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static VideoFacialRecognitionConfig? fromJson(dynamic value) {
    upgradeDto(value, "VideoFacialRecognitionConfig");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return VideoFacialRecognitionConfig(
        intervalSeconds: mapValueOfType<double>(json, r'intervalSeconds')!,
        maxFrames: mapValueOfType<int>(json, r'maxFrames')!,
        samplingMethod: VideoFaceSamplingMethod.fromJson(json[r'samplingMethod'])!,
        scanMode: VideoFaceScanMode.fromJson(json[r'scanMode'])!,
      );
    }
    return null;
  }

  static List<VideoFacialRecognitionConfig> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <VideoFacialRecognitionConfig>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = VideoFacialRecognitionConfig.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, VideoFacialRecognitionConfig> mapFromJson(dynamic json) {
    final map = <String, VideoFacialRecognitionConfig>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = VideoFacialRecognitionConfig.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of VideoFacialRecognitionConfig-objects as value to a dart map
  static Map<String, List<VideoFacialRecognitionConfig>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<VideoFacialRecognitionConfig>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = VideoFacialRecognitionConfig.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'intervalSeconds',
    'maxFrames',
    'samplingMethod',
    'scanMode',
  };
}

