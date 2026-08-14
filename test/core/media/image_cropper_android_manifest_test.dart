import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android declares the uCrop activity required by image_cropper', () {
    final manifest =
        File('android/app/src/main/AndroidManifest.xml').readAsStringSync();

    expect(manifest, contains('com.yalantis.ucrop.UCropActivity'));
    expect(manifest, contains('@style/Theme.AppCompat.Light.NoActionBar'));
    expect(manifest, contains('android:exported="false"'));
  });
}
