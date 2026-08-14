import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/auth_repository_impl.dart';
import '../domain/auth_repository.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepositoryImpl();
});

final authStateProvider = StreamProvider<User?>((ref) {
  final authRepository = ref.watch(authRepositoryProvider);
  return authRepository.authStateChanges();
});

final currentUserProvider = Provider<User?>((ref) {
  final authRepository = ref.watch(authRepositoryProvider);
  return authRepository.getCurrentUser();
});

final signOutProvider = FutureProvider<void>((ref) async {
  final authRepository = ref.watch(authRepositoryProvider);
  await authRepository.signOut();
});

enum ProfileAccessState {
  loading,
  incomplete,
  remediation,
  active,
  disabled,
  error,
}

@visibleForTesting
ProfileAccessState profileAccessStateFromDocument({
  required bool exists,
  required Map<String, dynamic>? data,
  DateTime? referenceDate,
}) {
  if (!exists || data == null) return ProfileAccessState.incomplete;
  final status = data['status'];
  final accountStatus = data['accountStatus'];
  final isDisabled = data['isBanned'] == true ||
      data['isDeleted'] == true ||
      data['deleted'] == true ||
      data['deletionRequested'] == true ||
      data['deletedAt'] != null ||
      status == 'banned' ||
      status == 'deleted' ||
      status == 'deactivated' ||
      accountStatus == 'banned' ||
      accountStatus == 'deleting' ||
      accountStatus == 'deleted' ||
      accountStatus == 'deactivated';
  if (isDisabled) return ProfileAccessState.disabled;
  if (data['onboardingCompleted'] != true) {
    return ProfileAccessState.incomplete;
  }
  return _hasCompleteAdultPublicProfile(
    data,
    referenceDate ?? DateTime.now().toUtc(),
  )
      ? ProfileAccessState.active
      : ProfileAccessState.remediation;
}

bool _hasCompleteAdultPublicProfile(
  Map<String, dynamic> data,
  DateTime referenceDate,
) {
  final displayName = data['displayName'];
  final gender = data['gender'];
  final nationality = data['nationality'];
  final residingCountry = data['residingCountry'];
  final nativeLanguage = data['nativeLanguage'];
  final learningLanguage = data['learningLanguage'];
  return displayName is String &&
      displayName.trim().isNotEmpty &&
      _hasMinimumAdultAge(data, referenceDate) &&
      (gender == 'male' || gender == 'female') &&
      (nationality == 'KR' || nationality == 'JP') &&
      (residingCountry == 'KR' ||
          residingCountry == 'JP' ||
          residingCountry == 'OTHER') &&
      (nativeLanguage == 'ko' || nativeLanguage == 'ja') &&
      (learningLanguage == 'ko' || learningLanguage == 'ja') &&
      nativeLanguage != learningLanguage &&
      data['bio'] is String;
}

bool _hasMinimumAdultAge(
  Map<String, dynamic> data,
  DateTime referenceDate,
) {
  final reference = referenceDate.toUtc();
  final year = data['birthYear'];
  final month = data['birthMonth'];
  final day = data['birthDay'];
  if (year is! int ||
      month is! int ||
      day is! int ||
      year < 1900 ||
      year > reference.year ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31) {
    return false;
  }
  final birthDate = DateTime.utc(year, month, day);
  if (birthDate.year != year ||
      birthDate.month != month ||
      birthDate.day != day) {
    return false;
  }
  if (birthDate.isAfter(reference)) return false;
  var age = reference.year - birthDate.year;
  final birthdayHasPassed = reference.month > birthDate.month ||
      (reference.month == birthDate.month && reference.day >= birthDate.day);
  if (!birthdayHasPassed) age -= 1;
  return age >= 18;
}

ProfileAccessState resolvedProfileAccessState(
  AsyncValue<ProfileAccessState> value,
) {
  if (value.isLoading) return ProfileAccessState.loading;
  if (value.hasError) return ProfileAccessState.error;
  return value.asData?.value ?? ProfileAccessState.error;
}

final profileAccessProvider = FutureProvider<ProfileAccessState>((ref) async {
  final user = ref.watch(authStateProvider).asData?.value;
  if (user == null) return ProfileAccessState.incomplete;
  try {
    final doc = await FirebaseFirestore.instance
        .collection('users')
        .doc(user.uid)
        .get();
    return profileAccessStateFromDocument(
      exists: doc.exists,
      data: doc.data(),
    );
  } catch (_) {
    return ProfileAccessState.error;
  }
});
