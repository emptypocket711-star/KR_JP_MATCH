import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/core/media/image_cropper_service.dart';

void main() {
  test('cleans only Hana sanitized upload artifacts', () async {
    final directory = await Directory.systemTemp.createTemp('hana-media-test-');
    try {
      final sanitized = File(
        '${directory.path}/crop.jpg.hana-sanitized.jpg',
      );
      final original = File('${directory.path}/picker-original.jpg');
      await sanitized.writeAsBytes([0xff, 0xd8, 0xff, 0xd9]);
      await original.writeAsBytes([0xff, 0xd8, 0xff, 0xd9]);

      await deleteSanitizedUploadTempFile(sanitized.path);
      await deleteSanitizedUploadTempFile(original.path);

      expect(await sanitized.exists(), isFalse);
      expect(await original.exists(), isTrue);
    } finally {
      await directory.delete(recursive: true);
    }
  });
}
