import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hana/app/router/app_router.dart';
import 'package:hana/features/auth/presentation/auth_provider.dart';

void main() {
  test('profile loading waits on splash', () {
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.loading,
        location: '/discovery',
      ),
      '/splash',
    );
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.loading,
        location: '/splash',
      ),
      isNull,
    );
  });

  test('reservation shell cannot enter discovery', () {
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.incomplete,
        location: '/discovery',
      ),
      '/onboarding',
    );
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.incomplete,
        location: '/onboarding',
      ),
      isNull,
    );
  });

  test('active account leaves access gates for discovery', () {
    for (final location in [
      '/splash',
      '/login',
      '/onboarding',
      '/account-disabled',
      '/profile-access-error',
      '/',
    ]) {
      expect(
        profileAccessRedirect(
          accessState: ProfileAccessState.active,
          location: location,
        ),
        '/discovery',
        reason: location,
      );
    }
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.active,
        location: '/lounge',
      ),
      isNull,
    );
  });

  test('disabled and error states never fall through to onboarding', () {
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.disabled,
        location: '/discovery',
      ),
      '/account-disabled',
    );
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.error,
        location: '/discovery',
      ),
      '/profile-access-error',
    );

    final source = File('lib/app/router/app_router.dart').readAsStringSync();
    expect(source, contains("path: '/account-disabled'"));
    expect(source, contains("path: '/profile-access-error'"));
  });

  test('recoverable legacy profiles enter server-owned profile remediation',
      () {
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.remediation,
        location: '/discovery',
      ),
      '/profile/edit',
    );
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.remediation,
        location: '/profile/edit',
      ),
      isNull,
    );
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.remediation,
        location: '/settings',
      ),
      isNull,
    );
    expect(
      profileAccessRedirect(
        accessState: ProfileAccessState.remediation,
        location: '/lounge',
      ),
      '/profile/edit',
    );
  });
}
