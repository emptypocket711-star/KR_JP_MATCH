import 'package:flutter/widgets.dart';

extension UiText on BuildContext {
  bool get isJapaneseUi => Localizations.localeOf(this).languageCode == 'ja';

  String t(String ko, String ja) => isJapaneseUi ? ja : ko;

  String headerAsset(String name) {
    final suffix = isJapaneseUi ? '_ja' : '';
    return 'assets/images/${name}_header$suffix.png';
  }
}

String genderLabel(BuildContext context, String gender) {
  if (gender == 'male') {
    return context.t('\uB0A8\uC131', '\u7537\u6027');
  }
  if (gender == 'female') {
    return context.t('\uC5EC\uC131', '\u5973\u6027');
  }
  return gender;
}

String loungeCategoryLabel(BuildContext context, String category) {
  switch (category) {
    case '\uC804\uCCB4':
      return context.t('\uC804\uCCB4', '\u3059\u3079\u3066');
    case '\uC77C\uC0C1':
      return context.t('\uC77C\uC0C1', '\u65E5\u5E38');
    case '\uC5EC\uD589':
      return context.t('\uC5EC\uD589', '\u65C5\u884C');
    case '\uC5B8\uC5B4\uAD50\uD658':
      return context.t('\uC5B8\uC5B4\uAD50\uD658', '\u8A00\u8A9E\u4EA4\u63DB');
    case '\uB9DB\uC9D1':
      return context.t('\uB9DB\uC9D1', '\u30B0\u30EB\u30E1');
    case '\uC9C8\uBB38':
      return context.t('\uC9C8\uBB38', '\u8CEA\u554F');
  }
  return category;
}
