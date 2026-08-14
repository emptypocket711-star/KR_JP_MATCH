import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';

import '../../app/theme/app_theme.dart';
import '../i18n/ui_text.dart';
import 'image_upload_sanitizer.dart';

Future<String?> cropImageForUpload(
  BuildContext context, {
  required String sourcePath,
  required bool preferSquare,
}) async {
  CroppedFile? cropped;
  try {
    cropped = await ImageCropper().cropImage(
      sourcePath: sourcePath,
      maxWidth: 1800,
      maxHeight: 1800,
      compressFormat: ImageCompressFormat.jpg,
      compressQuality: 90,
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: context.t('사진 편집', '写真を編集'),
          toolbarColor: AppTheme.primary,
          toolbarWidgetColor: Colors.white,
          activeControlsWidgetColor: AppTheme.primary,
          initAspectRatio: preferSquare
              ? CropAspectRatioPreset.square
              : CropAspectRatioPreset.original,
          lockAspectRatio: false,
          aspectRatioPresets: const [
            CropAspectRatioPreset.original,
            CropAspectRatioPreset.square,
            CropAspectRatioPreset.ratio4x3,
            CropAspectRatioPreset.ratio16x9,
          ],
        ),
        IOSUiSettings(
          title: context.t('사진 편집', '写真を編集'),
          doneButtonTitle: context.t('완료', '完了'),
          cancelButtonTitle: context.t('취소', 'キャンセル'),
          resetButtonHidden: false,
          rotateButtonsHidden: false,
          aspectRatioPickerButtonHidden: false,
          resetAspectRatioEnabled: true,
          aspectRatioPresets: const [
            CropAspectRatioPreset.original,
            CropAspectRatioPreset.square,
            CropAspectRatioPreset.ratio4x3,
            CropAspectRatioPreset.ratio16x9,
          ],
        ),
      ],
    );
  } on PlatformException catch (error) {
    debugPrint('Image cropper failed to open or finish: ${error.code}');
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            context.t(
              '사진 편집기를 열지 못했어요. 잠시 후 다시 시도해 주세요.',
              '写真編集を開けませんでした。しばらくしてからもう一度お試しください。',
            ),
          ),
        ),
      );
    }
    return null;
  }

  if (cropped == null) return null;

  try {
    return await sanitizeJpegFileForUpload(cropped.path);
  } on UploadImageSanitizationException {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            context.t(
              '안전하게 처리할 수 없는 사진이에요. 다른 사진을 선택해 주세요.',
              '安全に処理できない写真です。別の写真を選択してください。',
            ),
          ),
        ),
      );
    }
    return null;
  } finally {
    try {
      await File(cropped.path).delete();
    } catch (_) {
      // The cropped source is an app-cache artifact. Failure to clean it up is
      // non-fatal because only the metadata-free copy can reach upload code.
    }
  }
}

/// Removes only the pixel-reencoded upload artifact created above. Callers use
/// this in `finally` after Storage succeeds or fails; the original picker file
/// is never accepted here as a deletion target.
Future<void> deleteSanitizedUploadTempFile(String path) async {
  if (!path.endsWith('.hana-sanitized.jpg')) return;
  try {
    final file = File(path);
    if (await file.exists()) await file.delete();
  } catch (_) {
    // Cache cleanup is best-effort and must not hide the upload outcome.
  }
}
