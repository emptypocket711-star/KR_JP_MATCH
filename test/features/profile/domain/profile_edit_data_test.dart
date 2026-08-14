import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/profile/domain/profile_edit_data.dart';

void main() {
  ProfileEditData completeData({
    int? birthYear = 1994,
    int? birthMonth = 7,
    int? birthDay = 21,
  }) {
    return ProfileEditData(
      photoUrls: const ['profile_media/user-1/auth-1/image.jpg'],
      displayName: ' Hana ',
      bio: ' hello ',
      relationshipType: '언어교환',
      birthYear: birthYear,
      birthMonth: birthMonth,
      birthDay: birthDay,
      gender: 'female',
      nationality: 'KR',
      residingCountry: 'KR',
      nativeLanguage: 'ko',
      learningLanguage: 'ja',
      keywords: const ['여행'],
      preferredGender: 'all',
      preferredNationality: 'any',
      preferredAgeMin: 20,
      preferredAgeMax: 40,
    );
  }

  test('update payload contains exactly the server-editable profile fields',
      () {
    final payload = completeData().toUpdateMap();

    expect(payload.keys.toSet(), {
      'displayName',
      'bio',
      'relationshipType',
      'birthYear',
      'birthMonth',
      'birthDay',
      'gender',
      'nationality',
      'residingCountry',
      'nativeLanguage',
      'learningLanguage',
      'keywords',
      'photoUrls',
      'preferredGender',
      'preferredNationality',
      'preferredAgeMin',
      'preferredAgeMax',
    });
    expect(payload['displayName'], 'Hana');
    expect(payload['bio'], 'hello');
    expect(payload['birthYear'], 1994);
    expect(payload['birthMonth'], 7);
    expect(payload['birthDay'], 21);
    expect(payload['preferredGender'], 'any');
  });

  test('missing month or day is not silently replaced with January 1', () {
    expect(
      () => completeData(birthMonth: null).toUpdateMap(),
      throwsStateError,
    );
    expect(
      () => completeData(birthDay: null).toUpdateMap(),
      throwsStateError,
    );
  });

  test('impossible calendar dates are rejected before the callable', () {
    expect(
      () => completeData(birthMonth: 2, birthDay: 30).toUpdateMap(),
      throwsStateError,
    );
  });

  test('an empty photo list remains a valid server payload', () {
    final payload = ProfileEditData(
      photoUrls: const [],
      displayName: 'Hana',
      bio: '',
      relationshipType: '언어교환',
      birthYear: 1994,
      birthMonth: 7,
      birthDay: 21,
      gender: 'female',
      nationality: 'KR',
      residingCountry: 'KR',
      nativeLanguage: 'ko',
      learningLanguage: 'ja',
      keywords: const [],
      preferredAgeMin: 18,
      preferredAgeMax: 50,
    ).toUpdateMap();

    expect(payload['photoUrls'], isEmpty);
    expect(payload['bio'], '');
  });

  test('profile photo removal exposes an accessible touch target', () {
    final source = File(
      'lib/features/profile/presentation/profile_edit_screen.dart',
    ).readAsStringSync();

    expect(source, contains("label: '사진 제거'"));
    expect(source, contains('dimension: 48'));
    expect(source, contains('.deleteMyProfilePhoto(reference)'));
  });

  test('successful remediation invalidates the account access gate', () {
    final source = File(
      'lib/features/profile/presentation/profile_edit_screen.dart',
    ).readAsStringSync();

    expect(source, contains('ref.invalidate(profileAccessProvider)'));
    expect(source, contains("context.go('/splash')"));
    expect(source, contains("onPressed: () => context.go('/settings')"));
  });
}
