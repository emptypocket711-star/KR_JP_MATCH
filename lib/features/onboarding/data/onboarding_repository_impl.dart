import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';

import '../../../app/config/app_config.dart';
import '../../../core/media/media_upload_reservation.dart';
import '../../../core/media/server_media_uploader.dart';
import '../domain/onboarding_repository.dart';

class OnboardingRepositoryImpl implements OnboardingRepository {
  final FirebaseFunctions _functions;

  OnboardingRepositoryImpl({FirebaseFunctions? functions})
      : _functions = functions ??
            FirebaseFunctions.instanceFor(
              region: AppConfig.firebaseFunctionsRegion,
            );

  @override
  Future<void> completeOnboarding(UserProfileInput input) async {
    await _functions.httpsCallable('completeOnboarding').call(input.toMap());
  }

  @override
  Future<List<String>> uploadProfilePhotos(List<String> localPaths) async {
    final canonicalPaths = <String>[];
    for (final localPath in localPaths) {
      final reservationResult = await _functions
          .httpsCallable(
        'reserveMediaUploadV2',
        options: HttpsCallableOptions(
          timeout: const Duration(seconds: 12),
        ),
      )
          .call({'kind': 'profile'});
      final reservation = MediaUploadReservation.fromCallableData(
        reservationResult.data,
      );
      final confirmed = await uploadReservedJpegFile(
        functions: _functions,
        reservation: reservation,
        file: File(localPath),
        sizeErrorMessage: 'Profile image exceeds the upload size limit',
      );
      canonicalPaths.add(confirmed.path);
    }
    return canonicalPaths;
  }

  @override
  Future<void> deleteProfilePhoto(String reference) async {
    await _functions
        .httpsCallable(
      'deleteMyProfilePhoto',
      options: HttpsCallableOptions(timeout: const Duration(seconds: 20)),
    )
        .call({'url': reference});
  }
}
