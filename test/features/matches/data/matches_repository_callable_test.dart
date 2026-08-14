import 'dart:async';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hana/features/matches/data/matches_repository_impl.dart';
import 'package:hana/features/matches/domain/match.dart';

const _viewerUid = 'viewer-uid';
const _partnerUid = 'partner-uid';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('callable parser maps only the viewer-scoped active-chat contract', () {
    final page = parseActiveChatsCallableData({
      'rooms': [
        _room(
          id: 'room-1',
          favorite: true,
          createdAtMillis: 1700000000000,
          lastMessageAtMillis: 1700000001000,
          unreadCount: 4,
          preview: '안녕하세요',
        ),
      ],
      'nextCursor': 'room-1',
    }, _viewerUid);

    final room = page.rooms.single;
    expect(page.nextCursor, 'room-1');
    expect(room.matchId, 'room-1');
    expect(room.userIds, [_viewerUid, _partnerUid]);
    expect(
      room.createdAt,
      DateTime.fromMillisecondsSinceEpoch(1700000000000, isUtc: true),
    );
    expect(
      room.lastMessageAt,
      DateTime.fromMillisecondsSinceEpoch(1700000001000, isUtc: true),
    );
    expect(room.lastMessagePreview, '안녕하세요');
    expect(room.unreadCountFor(_viewerUid), 4);
    expect(room.isFavoriteFor(_viewerUid), isTrue);
    expect(room.partnerName(_viewerUid), 'Hana');
    expect(room.partnerPhoto(_viewerUid), 'users/partner-uid/profile/main.jpg');
    expect(room.partnerNationality(_viewerUid), 'JP');
    expect(room.partnerGender(_viewerUid), 'female');
  });

  test('callable parser fails closed on malformed room and cursor fields', () {
    final malformedResponses = <Object?>[
      null,
      {'rooms': 'not-a-list', 'nextCursor': null},
      {
        'rooms': List.generate(21, (index) => _room(id: 'room-$index')),
        'nextCursor': null,
      },
      {'rooms': const [], 'nextCursor': 'rooms/forged'},
      {
        'rooms': [
          {
            ..._room(),
            'userIds': [_viewerUid, _viewerUid]
          },
        ],
        'nextCursor': null,
      },
      {
        'rooms': [
          {
            ..._room(),
            'userIds': ['other-a', 'other-b']
          },
        ],
        'nextCursor': null,
      },
      {
        'rooms': [
          {
            ..._room(),
            'partner': {..._partner(), 'uid': 'mallory'},
          },
        ],
        'nextCursor': null,
      },
      {
        'rooms': [
          {..._room(), 'unreadCount': -1},
        ],
        'nextCursor': null,
      },
      {
        'rooms': [
          {..._room(), 'favorite': 'yes'},
        ],
        'nextCursor': null,
      },
      {
        'rooms': [
          {..._room(), 'createdAtMillis': 'yesterday'},
        ],
        'nextCursor': null,
      },
      {
        'rooms': [
          {..._room(), 'lastMessagePreview': 7},
        ],
        'nextCursor': null,
      },
    ];

    for (final response in malformedResponses) {
      expect(
        () => parseActiveChatsCallableData(response, _viewerUid),
        throwsFormatException,
        reason: '$response',
      );
    }
    expect(
      () => parseActiveChatsCallableData(
        {'rooms': const [], 'nextCursor': null},
        '',
      ),
      throwsFormatException,
    );
  });

  test('watchMatches immediately paginates and sorts deterministically',
      () async {
    final requests = <({int limit, String? cursor})>[];
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        requests.add((limit: limit, cursor: cursor));
        if (cursor == null) {
          return {
            'rooms': [
              _room(
                id: 'room-z',
                lastMessageAtMillis: 500,
              ),
              _room(
                id: 'room-b',
                favorite: true,
                lastMessageAtMillis: 100,
              ),
            ],
            'nextCursor': 'page-1',
          };
        }
        expect(cursor, 'page-1');
        return {
          'rooms': [
            _room(
              id: 'room-a',
              favorite: true,
              lastMessageAtMillis: 100,
            ),
            _room(
              id: 'room-c',
              lastMessageAtMillis: 500,
            ),
          ],
          'nextCursor': null,
        };
      },
      pollInterval: const Duration(days: 1),
    );

    final rooms = await repository
        .watchMatches(_viewerUid)
        .first
        .timeout(const Duration(seconds: 1));

    expect(requests, [
      (limit: 20, cursor: null),
      (limit: 20, cursor: 'page-1'),
    ]);
    expect(
      rooms.map((room) => room.matchId),
      ['room-a', 'room-b', 'room-c', 'room-z'],
    );
  });

  test('page overflow fails closed after five twenty-room requests', () async {
    var requestCount = 0;
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        requestCount += 1;
        expect(limit, 20);
        return {
          'rooms': [
            _room(
              id: 'room-$requestCount',
              lastMessageAtMillis: requestCount,
            ),
          ],
          'nextCursor': 'cursor-$requestCount',
        };
      },
      pollInterval: const Duration(days: 1),
    );

    await expectLater(
      repository.watchMatches(_viewerUid).first,
      throwsA(isA<FormatException>()),
    );

    expect(requestCount, 5);
  });

  test('polling emits a refreshed callable snapshot without overlap', () async {
    var activeRequests = 0;
    var maxActiveRequests = 0;
    var requestCount = 0;
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        activeRequests += 1;
        maxActiveRequests = activeRequests > maxActiveRequests
            ? activeRequests
            : maxActiveRequests;
        requestCount += 1;
        await Future<void>.delayed(const Duration(milliseconds: 2));
        activeRequests -= 1;
        return {
          'rooms': [
            _room(id: 'room-1', preview: 'poll-$requestCount'),
          ],
          'nextCursor': null,
        };
      },
      pollInterval: const Duration(milliseconds: 1),
    );

    final emissions = await repository
        .watchMatches(_viewerUid)
        .take(2)
        .toList()
        .timeout(const Duration(seconds: 1));

    expect(emissions[0].single.lastMessagePreview, 'poll-1');
    expect(emissions[1].single.lastMessagePreview, 'poll-2');
    expect(maxActiveRequests, 1);
  });

  test('a callable error is emitted and the next poll retries successfully',
      () async {
    var requestCount = 0;
    final errorSeen = Completer<void>();
    final recovered = Completer<List<Match>>();
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        requestCount += 1;
        if (requestCount == 1) throw StateError('temporary callable failure');
        return {
          'rooms': [_room(id: 'room-recovered')],
          'nextCursor': null,
        };
      },
      pollInterval: const Duration(milliseconds: 1),
    );

    late final StreamSubscription<List<Match>> subscription;
    subscription = repository.watchMatches(_viewerUid).listen(
      (rooms) {
        if (!recovered.isCompleted) recovered.complete(rooms);
      },
      onError: (Object error) {
        expect(error, isA<StateError>());
        if (!errorSeen.isCompleted) errorSeen.complete();
      },
    );

    await errorSeen.future.timeout(const Duration(seconds: 1));
    final rooms = await recovered.future.timeout(const Duration(seconds: 1));
    expect(rooms.single.matchId, 'room-recovered');
    expect(requestCount, 2);
    await subscription.cancel();
  });

  test('cancellation suppresses a late in-flight callable error', () async {
    final started = Completer<void>();
    final response = Completer<Object?>();
    final errors = <Object>[];
    final lifecycle = _FakeLifecycle();
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) {
        if (!started.isCompleted) started.complete();
        return response.future;
      },
      pollInterval: const Duration(days: 1),
      lifecycleRegistrar: lifecycle.register,
    );

    final subscription = repository.watchMatches(_viewerUid).listen(
          (_) {},
          onError: (Object error) => errors.add(error),
        );
    await started.future.timeout(const Duration(seconds: 1));
    await subscription.cancel();
    response.completeError(StateError('late callable failure'));
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(errors, isEmpty);
    expect(lifecycle.disposeCount, 1);
  });

  test('pause stops polling and resume triggers one fresh immediate poll',
      () async {
    var requestCount = 0;
    final firstEmission = Completer<void>();
    final resumedEmission = Completer<void>();
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        requestCount += 1;
        return {
          'rooms': [
            _room(id: 'room-1', preview: 'poll-$requestCount'),
          ],
          'nextCursor': null,
        };
      },
      pollInterval: const Duration(milliseconds: 50),
    );

    final subscription = repository.watchMatches(_viewerUid).listen((rooms) {
      if (!firstEmission.isCompleted) {
        firstEmission.complete();
      } else if (!resumedEmission.isCompleted) {
        resumedEmission.complete();
      }
    });
    await firstEmission.future.timeout(const Duration(seconds: 1));
    subscription.pause();
    await Future<void>.delayed(const Duration(milliseconds: 120));
    expect(requestCount, 1);

    subscription.resume();
    await resumedEmission.future.timeout(const Duration(seconds: 1));
    expect(requestCount, 2);
    await subscription.cancel();
  });

  test('app pause stops polling and app resume fetches immediately', () async {
    var requestCount = 0;
    final firstEmission = Completer<void>();
    final resumedEmission = Completer<void>();
    final lifecycle = _FakeLifecycle();
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        requestCount += 1;
        return {
          'rooms': [
            _room(id: 'room-1', preview: 'poll-$requestCount'),
          ],
          'nextCursor': null,
        };
      },
      pollInterval: const Duration(milliseconds: 50),
      lifecycleRegistrar: lifecycle.register,
    );

    final subscription = repository.watchMatches(_viewerUid).listen((rooms) {
      if (!firstEmission.isCompleted) {
        firstEmission.complete();
      } else if (!resumedEmission.isCompleted) {
        resumedEmission.complete();
      }
    });
    await firstEmission.future.timeout(const Duration(seconds: 1));

    lifecycle.emit(AppLifecycleState.paused);
    await Future<void>.delayed(const Duration(milliseconds: 120));
    expect(requestCount, 1);

    lifecycle.emit(AppLifecycleState.resumed);
    await resumedEmission.future.timeout(const Duration(seconds: 1));
    expect(requestCount, 2);
    await subscription.cancel();
    expect(lifecycle.disposeCount, 1);
  });

  test('an initially paused app waits for resume before the first fetch',
      () async {
    var requestCount = 0;
    final lifecycle = _FakeLifecycle(initialState: AppLifecycleState.paused);
    final repository = MatchesRepositoryImpl(
      pageLoader: ({required limit, cursor}) async {
        requestCount += 1;
        return {'rooms': const [], 'nextCursor': null};
      },
      pollInterval: const Duration(days: 1),
      lifecycleRegistrar: lifecycle.register,
    );

    final firstEmission = Completer<void>();
    final subscription = repository.watchMatches(_viewerUid).listen((_) {
      if (!firstEmission.isCompleted) firstEmission.complete();
    });
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(requestCount, 0);

    lifecycle.emit(AppLifecycleState.resumed);
    await firstEmission.future.timeout(const Duration(seconds: 1));
    expect(requestCount, 1);
    await subscription.cancel();
  });

  test('matches list source uses only the region-bound callable contract', () {
    final source = File(
      'lib/features/matches/data/matches_repository_impl.dart',
    ).readAsStringSync();

    expect(source, contains('FirebaseFunctions.instanceFor('));
    expect(source, contains('AppConfig.firebaseFunctionsRegion'));
    expect(source, contains("'listActiveChats'"));
    expect(source, contains("'limit': limit"));
    expect(source, contains("'cursor': cursor"));
    expect(source, contains('_pageSize = 20'));
    expect(source, contains('_maxPagesPerPoll = 5'));
    expect(source, contains('WidgetsBinding.instance'));
    expect(source, isNot(contains('FirebaseFirestore')));
    expect(source, isNot(contains("collection('matches')")));
    expect(source, isNot(contains('.snapshots()')));

    final providerSource = File(
      'lib/features/matches/presentation/matches_provider.dart',
    ).readAsStringSync();
    expect(providerSource, contains('StreamProvider.autoDispose<List<Match>>'));
  });
}

class _FakeLifecycle {
  _FakeLifecycle({this.initialState = AppLifecycleState.resumed});

  final AppLifecycleState? initialState;
  ValueChanged<AppLifecycleState>? _listener;
  int disposeCount = 0;

  ActiveChatsLifecycleRegistration register(
    ValueChanged<AppLifecycleState> listener,
  ) {
    expect(_listener, isNull);
    _listener = listener;
    return (
      initialState: initialState,
      dispose: () {
        disposeCount += 1;
        _listener = null;
      },
    );
  }

  void emit(AppLifecycleState state) {
    final listener = _listener;
    expect(listener, isNotNull);
    listener!(state);
  }
}

Map<String, Object?> _room({
  String id = 'room-1',
  bool favorite = false,
  int? createdAtMillis = 100,
  int? lastMessageAtMillis,
  int unreadCount = 0,
  String? preview,
}) {
  return {
    'matchId': id,
    'userIds': [_viewerUid, _partnerUid],
    'createdAtMillis': createdAtMillis,
    'lastMessageAtMillis': lastMessageAtMillis,
    'lastMessagePreview': preview,
    'unreadCount': unreadCount,
    'favorite': favorite,
    'partner': _partner(),
  };
}

Map<String, Object?> _partner() {
  return {
    'uid': _partnerUid,
    'displayName': 'Hana',
    'photoUrl': 'users/partner-uid/profile/main.jpg',
    'nationality': 'JP',
    'gender': 'female',
  };
}
