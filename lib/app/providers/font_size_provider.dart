import 'package:flutter_riverpod/flutter_riverpod.dart';

enum FontSizePreset { small, medium, large }

extension FontSizePresetX on FontSizePreset {
  String get label => switch (this) {
        FontSizePreset.small => 'S',
        FontSizePreset.medium => 'M',
        FontSizePreset.large => 'L',
      };

  double get scale => switch (this) {
        FontSizePreset.small => 0.85,
        FontSizePreset.medium => 1.0,
        FontSizePreset.large => 1.15,
      };
}

class FontSizeNotifier extends Notifier<FontSizePreset> {
  @override
  FontSizePreset build() => FontSizePreset.medium;

  void set(FontSizePreset value) => state = value;
}

final fontSizeProvider =
    NotifierProvider<FontSizeNotifier, FontSizePreset>(FontSizeNotifier.new);
