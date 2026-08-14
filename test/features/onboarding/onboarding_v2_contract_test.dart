import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/onboarding/domain/onboarding_repository.dart';
import 'package:hana/features/onboarding/presentation/onboarding_provider.dart';

void main() {
  test('profile input includes exact date of birth and canonical media paths',
      () {
    final input = UserProfileInput(
      relationshipType: '언어교환',
      displayName: 'hana',
      birthYear: 1997,
      birthMonth: 8,
      birthDay: 14,
      gender: 'female',
      nationality: 'KR',
      residingCountry: 'KR',
      nativeLanguage: 'ko',
      learningLanguage: 'ja',
      bio: '안녕하세요',
      keywords: const ['언어교환'],
      qaItems: const [],
      photoUrls: const ['profile_media/alice/auth-1/image.jpg'],
    );

    expect(
      input.toMap(),
      containsPair('birthYear', 1997),
    );
    expect(input.toMap(), containsPair('birthMonth', 8));
    expect(input.toMap(), containsPair('birthDay', 14));
    expect(
      input.toMap()['photoUrls'],
      const ['profile_media/alice/auth-1/image.jpg'],
    );
  });

  test('form notifier stores one exact birth date atomically', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    container
        .read(onboardingFormStateProvider.notifier)
        .setBirthDate(DateTime(1996, 2, 29));

    final state = container.read(onboardingFormStateProvider);
    expect(state.birthYear, 1996);
    expect(state.birthMonth, 2);
    expect(state.birthDay, 29);
  });

  test('selecting the same language clears the conflicting counterpart', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(onboardingFormStateProvider.notifier);

    notifier.setLearningLanguage('ja');
    notifier.setNativeLanguage('ja');
    var state = container.read(onboardingFormStateProvider);
    expect(state.nativeLanguage, 'ja');
    expect(state.learningLanguage, isNull);

    notifier.setNativeLanguage('ko');
    notifier.setLearningLanguage('ko');
    state = container.read(onboardingFormStateProvider);
    expect(state.nativeLanguage, isNull);
    expect(state.learningLanguage, 'ko');
  });

  test('empty optional Q&A entries are removed from the server payload', () {
    expect(
      completedQaItems(const [
        {'question': '  좋아하는 음식은? ', 'answer': ' 초밥 '},
        {'question': '취미는?', 'answer': '   '},
        {'question': '', 'answer': '여행'},
      ]),
      const [
        {'question': '좋아하는 음식은?', 'answer': '초밥'},
      ],
    );
  });

  test('onboarding widget delegates all Firebase media access', () {
    final screenSource = File(
      'lib/features/onboarding/presentation/onboarding_screen.dart',
    ).readAsStringSync();
    final repositorySource = File(
      'lib/features/onboarding/data/onboarding_repository_impl.dart',
    ).readAsStringSync();

    expect(screenSource, isNot(contains('FirebaseStorage')));
    expect(screenSource, isNot(contains('FirebaseAuth')));
    expect(screenSource, isNot(contains('putFile(')));
    expect(screenSource, isNot(contains('getDownloadURL(')));
    expect(screenSource, contains('cropImageForUpload('));
    expect(screenSource, contains('deleteSanitizedUploadTempFile('));
    expect(screenSource, contains('AuthenticatedStorageImage('));
    expect(screenSource, contains('nativeLanguage != learningLanguage'));
    expect(screenSource, contains('ref.invalidate(profileAccessProvider)'));
    expect(screenSource, contains("label: '사진 제거'"));
    expect(screenSource, contains('dimension: 48'));
    expect(screenSource, contains("'문화교류'"));
    expect(screenSource, contains("'친한친구'"));
    expect(screenSource, isNot(contains("('연애',")));
    expect(screenSource, isNot(contains("('결혼',")));
    expect(screenSource, isNot(contains('formState.bio.isEmpty')));

    expect(repositorySource, contains('FirebaseFunctions.instanceFor('));
    expect(repositorySource, contains('AppConfig.firebaseFunctionsRegion'));
    expect(repositorySource, contains("'reserveMediaUploadV2'"));
    expect(repositorySource, contains('uploadReservedJpegFile('));
    expect(repositorySource, contains("'deleteMyProfilePhoto'"));
    expect(repositorySource, isNot(contains('FirebaseStorage')));
  });
}
