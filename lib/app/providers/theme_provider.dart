import 'package:flutter_riverpod/flutter_riverpod.dart';

class IsDarkModeNotifier extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool value) => state = value;
}

final isDarkModeProvider =
    NotifierProvider<IsDarkModeNotifier, bool>(IsDarkModeNotifier.new);
