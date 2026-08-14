import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/auth/presentation/auth_provider.dart';

void main() {
  test('missing document and reservation shell are incomplete', () {
    expect(
      profileAccessStateFromDocument(exists: false, data: null),
      ProfileAccessState.incomplete,
    );
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          'accountStatus': 'onboarding',
          'onboardingCompleted': false,
        },
      ),
      ProfileAccessState.incomplete,
    );
  });

  test('only explicit usable onboarding completion is active', () {
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          ..._completeProfile,
          'accountStatus': 'active',
        },
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.active,
    );
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: const {'onboardingCompleted': 'true'},
      ),
      ProfileAccessState.incomplete,
    );
  });

  test('server unusable account fields are disabled fail-closed', () {
    final disabledDocuments = <Map<String, dynamic>>[
      {..._completeProfile, 'isBanned': true},
      {..._completeProfile, 'isDeleted': true},
      {..._completeProfile, 'deleted': true},
      {..._completeProfile, 'deletionRequested': true},
      {..._completeProfile, 'deletedAt': 'timestamp'},
      {..._completeProfile, 'status': 'banned'},
      {..._completeProfile, 'status': 'deleted'},
      {..._completeProfile, 'status': 'deactivated'},
      {..._completeProfile, 'accountStatus': 'banned'},
      {..._completeProfile, 'accountStatus': 'deleting'},
      {..._completeProfile, 'accountStatus': 'deleted'},
      {..._completeProfile, 'accountStatus': 'deactivated'},
    ];

    for (final document in disabledDocuments) {
      expect(
        profileAccessStateFromDocument(
          exists: true,
          data: document,
          referenceDate: _referenceDate,
        ),
        ProfileAccessState.disabled,
        reason: document.toString(),
      );
    }
  });

  test('completed but invalid legacy identity enters safe remediation', () {
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: const {'onboardingCompleted': true},
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.remediation,
    );
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          ..._completeProfile,
          'nativeLanguage': 'ko',
          'learningLanguage': 'ko',
        },
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.remediation,
    );
  });

  test('internal flags do not change viewer eligibility', () {
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          ..._completeProfile,
          'isTestUser': true,
          'isAdmin': true,
          'hiddenFromDiscovery': true,
        },
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.active,
    );
  });

  test('adult boundary uses exact full date against an injected clock', () {
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          ..._completeProfile,
          'birthYear': 2008,
          'birthMonth': 8,
          'birthDay': 14,
        },
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.active,
    );
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          ..._completeProfile,
          'birthYear': 2008,
          'birthMonth': 8,
          'birthDay': 15,
        },
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.remediation,
    );
    expect(
      profileAccessStateFromDocument(
        exists: true,
        data: {
          ..._completeProfile,
          'birthYear': 2000,
          'birthMonth': 2,
          'birthDay': 30,
        },
        referenceDate: _referenceDate,
      ),
      ProfileAccessState.remediation,
    );
  });

  test('async loading and failures remain distinct access states', () {
    expect(
      resolvedProfileAccessState(
        const AsyncValue<ProfileAccessState>.loading(),
      ),
      ProfileAccessState.loading,
    );
    expect(
      resolvedProfileAccessState(
        AsyncValue<ProfileAccessState>.error(
          StateError('offline'),
          StackTrace.empty,
        ),
      ),
      ProfileAccessState.error,
    );
    expect(
      resolvedProfileAccessState(
        const AsyncValue.data(ProfileAccessState.incomplete),
      ),
      ProfileAccessState.incomplete,
    );
  });

  test('provider exposes explicit state and catches Firestore failures', () {
    final source = File(
      'lib/features/auth/presentation/auth_provider.dart',
    ).readAsStringSync();

    expect(source, contains('FutureProvider<ProfileAccessState>'));
    expect(source, contains('return ProfileAccessState.error;'));
    expect(source, isNot(contains('FutureProvider<bool>')));
    expect(source, isNot(contains('profileExistsProvider')));
  });
}

final _referenceDate = DateTime.utc(2026, 8, 14);

const _completeProfile = <String, dynamic>{
  'onboardingCompleted': true,
  'displayName': 'Hana',
  'birthYear': 1995,
  'birthMonth': 5,
  'birthDay': 10,
  'gender': 'female',
  'nationality': 'KR',
  'residingCountry': 'KR',
  'nativeLanguage': 'ko',
  'learningLanguage': 'ja',
  'bio': '',
};
