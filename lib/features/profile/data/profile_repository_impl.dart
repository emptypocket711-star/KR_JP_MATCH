import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../../app/config/app_config.dart';
import '../../../core/media/media_upload_reservation.dart';
import '../../../core/media/server_media_uploader.dart';
import '../domain/profile_edit_data.dart';
import '../domain/profile_repository.dart';

class ProfileRepositoryImpl implements ProfileRepository {
  ProfileRepositoryImpl({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance,
        _functions = functions ??
            FirebaseFunctions.instanceFor(
              region: AppConfig.firebaseFunctionsRegion,
            );

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;

  @override
  Future<ProfileEditData> getMyProfileForEdit() async {
    final uid = (await _currentUser()).uid;
    final snapshot = await _firestore.collection('users').doc(uid).get();
    if (!snapshot.exists) throw StateError('Profile not found');
    return ProfileEditData.fromMap(snapshot.data() ?? const {});
  }

  @override
  Future<String> uploadMyProfilePhoto(File file) async {
    await _currentUser();
    final result = await _functions
        .httpsCallable(
      'reserveMediaUploadV2',
      options: HttpsCallableOptions(timeout: const Duration(seconds: 12)),
    )
        .call({'kind': 'profile'});
    final reservation = MediaUploadReservation.fromCallableData(result.data);
    final confirmed = await uploadReservedJpegFile(
      functions: _functions,
      reservation: reservation,
      file: file,
      sizeErrorMessage: 'Profile image exceeds the upload size limit',
    );
    return confirmed.path;
  }

  @override
  Future<void> deleteMyProfilePhoto(String reference) async {
    await _currentUser();
    await _functions
        .httpsCallable(
      'deleteMyProfilePhoto',
      options: HttpsCallableOptions(timeout: const Duration(seconds: 20)),
    )
        .call({'url': reference});
  }

  @override
  Future<void> saveMyProfile(ProfileEditData data) async {
    await _currentUser();
    await _functions
        .httpsCallable(
          'updateMyProfile',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 20)),
        )
        .call(data.toUpdateMap());
  }

  Future<User> _currentUser() async {
    final current = _auth.currentUser;
    if (current != null) return current;
    try {
      return await _auth
          .authStateChanges()
          .where((user) => user != null)
          .cast<User>()
          .first
          .timeout(const Duration(seconds: 5));
    } on TimeoutException {
      throw StateError('Login is required');
    }
  }
}
