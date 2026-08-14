import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/discovery/domain/candidate.dart';
import 'package:hana/features/discovery/domain/discovery_repository.dart';
import 'package:hana/features/discovery/presentation/discovery_provider.dart';
import 'package:hana/features/profile/presentation/profile_detail_screen.dart';

void main() {
  testWidgets('resource-exhausted opens the low-key sheet', (tester) async {
    await _pumpProfile(
      tester,
      _ProfileRepositoryFake(
        startChatError: _TestFunctionsException('resource-exhausted'),
      ),
    );

    await tester.ensureVisible(find.text('대화하기'));
    await tester.tap(find.text('대화하기'));
    await tester.pumpAndSettle();

    expect(find.text('열쇠가 없어요'), findsOneWidget);
    expect(find.text('채팅방을 열지 못했어요. 다시 시도해 주세요.'), findsNothing);
  });

  testWidgets('other start-chat failures show a generic retry error',
      (tester) async {
    await _pumpProfile(
      tester,
      _ProfileRepositoryFake(
        startChatError: _TestFunctionsException('unavailable'),
      ),
    );

    await tester.ensureVisible(find.text('대화하기'));
    await tester.tap(find.text('대화하기'));
    await tester.pump();

    expect(
      find.text('채팅방을 열지 못했어요. 다시 시도해 주세요.'),
      findsOneWidget,
    );
    expect(find.text('대화하기'), findsOneWidget);
  });
}

Future<void> _pumpProfile(
  WidgetTester tester,
  DiscoveryRepository repository,
) async {
  tester.view.physicalSize = const Size(1080, 1920);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        discoveryRepositoryProvider.overrideWithValue(repository),
      ],
      child: const MaterialApp(
        home: ProfileDetailScreen(uid: 'target-1'),
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(find.text('대화하기'), findsOneWidget);
}

class _TestFunctionsException extends FirebaseFunctionsException {
  _TestFunctionsException(String code)
      : super(code: code, message: 'start chat failed');
}

class _ProfileRepositoryFake implements DiscoveryRepository {
  _ProfileRepositoryFake({required this.startChatError});

  final Object startChatError;

  @override
  bool get hasMore => false;

  @override
  Future<List<PublicProfile>> fetchUsers({bool reset = false}) async => [];

  @override
  Future<ProfileDetailResult> getProfileDetail(String targetUid) async {
    return ProfileDetailResult(
      profile: _profile,
      isOwnProfile: false,
      hasActiveChat: false,
      hasAlreadyRated: false,
    );
  }

  @override
  Future<String> startDirectChat(String targetUid) async {
    throw startChatError;
  }

  @override
  Future<Map<String, dynamic>> likeUser(String targetUid) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> passUser(String targetUid) {
    throw UnimplementedError();
  }

  @override
  Future<Map<String, dynamic>> requestCandidates({int limit = 10}) {
    throw UnimplementedError();
  }

  @override
  Future<void> submitRating({
    required String ratedUid,
    required int stars,
    required List<String> tags,
  }) {
    throw UnimplementedError();
  }
}

final _profile = PublicProfile(
  uid: 'target-1',
  displayName: 'Hana',
  birthYear: 1997,
  gender: 'female',
  nationality: 'JP',
  residingCountry: 'JP',
  nativeLanguage: 'ja',
  learningLanguage: 'ko',
  bio: '',
  photoUrls: const [],
);
