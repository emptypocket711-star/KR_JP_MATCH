import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';

import '../../../app/config/app_config.dart';
import '../../../core/media/media_upload_reservation.dart';
import '../../../core/media/server_media_uploader.dart';
import '../../../core/services/fcm_service.dart';
import '../domain/onboarding_repository.dart';

typedef PrepareProfileReadyFcmRegistration = Future<void> Function() Function();

Future<void> completeOnboardingThenRegisterFcm({
  required Future<void> Function() completeProfile,
  required PrepareProfileReadyFcmRegistration prepareRegistration,
}) async {
  // Capture the auth-session fence before the profile request. If sign-out
  // happens while it is in flight, the deferred registration becomes a no-op.
  final registerAfterProfileReady = prepareRegistration();
  await completeProfile();
  try {
    await registerAfterProfileReady();
  } catch (_) {
    // Push registration is best effort and must not turn a successfully saved
    // profile into an onboarding failure.
  }
}

class OnboardingRepositoryImpl implements OnboardingRepository {
  final FirebaseFunctions _functions;
  final PrepareProfileReadyFcmRegistration _prepareFcmRegistration;

  OnboardingRepositoryImpl({
    FirebaseFunctions? functions,
    PrepareProfileReadyFcmRegistration? prepareFcmRegistration,
  })  : _functions = functions ??
            FirebaseFunctions.instanceFor(
              region: AppConfig.firebaseFunctionsRegion,
            ),
        _prepareFcmRegistration = prepareFcmRegistration ??
            FcmService().prepareRegistrationAfterProfileReady;

  @override
  Future<void> completeOnboarding(UserProfileInput input) async {
    await completeOnboardingThenRegisterFcm(
      completeProfile: () async {
        await _functions
            .httpsCallable('completeOnboarding')
            .call(input.toMap());
      },
      prepareRegistration: _prepareFcmRegistration,
    );
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
