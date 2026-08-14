import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/widgets.dart';

import '../../../app/config/app_config.dart';
import '../domain/match.dart';
import '../domain/matches_repository.dart';

typedef ActiveChatsPageLoader = Future<Object?> Function({
  required int limit,
  String? cursor,
});

typedef ActiveChatsLifecycleRegistration = ({
  AppLifecycleState? initialState,
  VoidCallback dispose,
});

typedef ActiveChatsLifecycleRegistrar = ActiveChatsLifecycleRegistration
    Function(ValueChanged<AppLifecycleState> onStateChanged);

class MatchesRepositoryImpl implements MatchesRepository {
  MatchesRepositoryImpl({
    FirebaseFunctions? functions,
    @visibleForTesting ActiveChatsPageLoader? pageLoader,
    @visibleForTesting Duration pollInterval = const Duration(seconds: 10),
    @visibleForTesting ActiveChatsLifecycleRegistrar? lifecycleRegistrar,
  })  : _functions = pageLoader == null
            ? functions ??
                FirebaseFunctions.instanceFor(
                  region: AppConfig.firebaseFunctionsRegion,
                )
            : functions,
        _pageLoader = pageLoader,
        _pollInterval = pollInterval,
        _lifecycleRegistrar =
            lifecycleRegistrar ?? _registerActiveChatsLifecycleObserver;

  static const int _pageSize = 20;
  static const int _maxPagesPerPoll = 5;

  final FirebaseFunctions? _functions;
  final ActiveChatsPageLoader? _pageLoader;
  final Duration _pollInterval;
  final ActiveChatsLifecycleRegistrar _lifecycleRegistrar;

  @override
  Stream<List<Match>> watchMatches(String currentUid) {
    if (currentUid.isEmpty) {
      return Stream<List<Match>>.error(
        ArgumentError.value(currentUid, 'currentUid', 'must not be empty'),
      );
    }

    late final StreamController<List<Match>> controller;
    Timer? nextPoll;
    VoidCallback? disposeLifecycleObserver;
    var isCancelled = false;
    var isSubscriptionPaused = false;
    var isAppPaused = false;
    var isPolling = false;
    var pollWhenIdle = false;
    var lifecycleGeneration = 0;

    bool pollingIsSuspended() => isSubscriptionPaused || isAppPaused;

    Future<void> poll() async {
      if (isCancelled || pollingIsSuspended() || controller.isClosed) return;
      if (isPolling) {
        pollWhenIdle = true;
        return;
      }
      isPolling = true;
      final pollGeneration = lifecycleGeneration;
      try {
        final matches = await _loadAllActiveChats(
          currentUid,
          isCancelled: () =>
              isCancelled ||
              pollingIsSuspended() ||
              pollGeneration != lifecycleGeneration,
        );
        if (!isCancelled &&
            !pollingIsSuspended() &&
            pollGeneration == lifecycleGeneration &&
            !controller.isClosed) {
          controller.add(matches);
        }
      } catch (error, stackTrace) {
        if (!isCancelled &&
            !pollingIsSuspended() &&
            pollGeneration == lifecycleGeneration &&
            !controller.isClosed) {
          controller.addError(error, stackTrace);
        }
      } finally {
        isPolling = false;
        if (!isCancelled && !pollingIsSuspended() && !controller.isClosed) {
          if (pollWhenIdle) {
            pollWhenIdle = false;
            unawaited(poll());
          } else {
            nextPoll = Timer(_pollInterval, () {
              nextPoll = null;
              unawaited(poll());
            });
          }
        }
      }
    }

    void suspendPolling() {
      lifecycleGeneration += 1;
      pollWhenIdle = false;
      nextPoll?.cancel();
      nextPoll = null;
    }

    void resumePolling() {
      lifecycleGeneration += 1;
      nextPoll?.cancel();
      nextPoll = null;
      if (!isCancelled && !pollingIsSuspended()) {
        unawaited(poll());
      }
    }

    void handleAppLifecycleState(AppLifecycleState state) {
      final nextIsPaused = state != AppLifecycleState.resumed;
      if (nextIsPaused == isAppPaused) return;
      isAppPaused = nextIsPaused;
      if (isAppPaused) {
        suspendPolling();
      } else {
        resumePolling();
      }
    }

    controller = StreamController<List<Match>>(
      onListen: () {
        final registration = _lifecycleRegistrar(handleAppLifecycleState);
        disposeLifecycleObserver = registration.dispose;
        isAppPaused = registration.initialState != null &&
            registration.initialState != AppLifecycleState.resumed;
        if (!isAppPaused) unawaited(poll());
      },
      onPause: () {
        if (isSubscriptionPaused) return;
        isSubscriptionPaused = true;
        suspendPolling();
      },
      onResume: () {
        if (isCancelled || !isSubscriptionPaused) return;
        isSubscriptionPaused = false;
        resumePolling();
      },
      onCancel: () {
        isCancelled = true;
        lifecycleGeneration += 1;
        pollWhenIdle = false;
        nextPoll?.cancel();
        nextPoll = null;
        disposeLifecycleObserver?.call();
        disposeLifecycleObserver = null;
      },
    );
    return controller.stream;
  }

  Future<List<Match>> _loadAllActiveChats(
    String currentUid, {
    required bool Function() isCancelled,
  }) async {
    final matchesById = <String, Match>{};
    final seenCursors = <String>{};
    String? cursor;

    for (var pageIndex = 0;
        pageIndex < _maxPagesPerPoll && !isCancelled();
        pageIndex += 1) {
      final rawPage = await _loadPage(limit: _pageSize, cursor: cursor);
      if (isCancelled()) return const <Match>[];

      final page = parseActiveChatsCallableData(rawPage, currentUid);
      for (final match in page.rooms) {
        if (matchesById.containsKey(match.matchId)) {
          throw const FormatException('Duplicate active chat room');
        }
        matchesById[match.matchId] = match;
      }

      final nextCursor = page.nextCursor;
      if (nextCursor == null) break;
      if (pageIndex == _maxPagesPerPoll - 1) {
        throw const FormatException('Active chat page limit exceeded');
      }
      if (nextCursor == cursor || !seenCursors.add(nextCursor)) {
        throw const FormatException('Invalid active chat cursor sequence');
      }
      cursor = nextCursor;
    }

    final matches = matchesById.values.toList(growable: false);
    matches.sort((a, b) => _compareMatches(a, b, currentUid));
    return List<Match>.unmodifiable(matches);
  }

  Future<Object?> _loadPage({required int limit, String? cursor}) async {
    final pageLoader = _pageLoader;
    if (pageLoader != null) {
      return pageLoader(limit: limit, cursor: cursor);
    }
    final result = await _functions!
        .httpsCallable(
      'listActiveChats',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 20),
      ),
    )
        .call({'limit': limit, 'cursor': cursor});
    return result.data;
  }
}

ActiveChatsLifecycleRegistration _registerActiveChatsLifecycleObserver(
  ValueChanged<AppLifecycleState> onStateChanged,
) {
  final binding = WidgetsBinding.instance;
  final observer = _ActiveChatsLifecycleObserver(onStateChanged);
  binding.addObserver(observer);
  return (
    initialState: binding.lifecycleState,
    dispose: () => binding.removeObserver(observer),
  );
}

class _ActiveChatsLifecycleObserver extends WidgetsBindingObserver {
  _ActiveChatsLifecycleObserver(this.onStateChanged);

  final ValueChanged<AppLifecycleState> onStateChanged;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    onStateChanged(state);
  }
}

int _compareMatches(Match a, Match b, String currentUid) {
  final aFavorite = a.isFavoriteFor(currentUid);
  final bFavorite = b.isFavoriteFor(currentUid);
  if (aFavorite != bFavorite) return aFavorite ? -1 : 1;

  final aTime = a.lastMessageAt ?? a.createdAt;
  final bTime = b.lastMessageAt ?? b.createdAt;
  final newestFirst = bTime.compareTo(aTime);
  if (newestFirst != 0) return newestFirst;
  return a.matchId.compareTo(b.matchId);
}

@immutable
class ActiveChatsCallablePage {
  const ActiveChatsCallablePage({
    required this.rooms,
    required this.nextCursor,
  });

  final List<Match> rooms;
  final String? nextCursor;
}

@visibleForTesting
ActiveChatsCallablePage parseActiveChatsCallableData(
  Object? value,
  String currentUid,
) {
  if (currentUid.isEmpty) {
    throw const FormatException('Invalid active chats viewer');
  }
  final data = _stringMap(value, 'Invalid active chats response');
  final rawRooms = data['rooms'];
  if (rawRooms is! List || rawRooms.length > MatchesRepositoryImpl._pageSize) {
    throw const FormatException('Invalid active chats response');
  }

  final rawCursor = data['nextCursor'];
  final nextCursor = rawCursor == null
      ? null
      : _roomId(rawCursor, 'Invalid active chats cursor');
  final rooms = rawRooms.map((rawRoom) {
    final room = _stringMap(rawRoom, 'Invalid active chat room');
    final matchId = _roomId(room['matchId'], 'Invalid active chat room');
    final userIds = _participantUids(room['userIds'], currentUid);

    final rawPartner = _stringMap(
      room['partner'],
      'Invalid active chat partner',
    );
    final partnerUid = _requiredString(
      rawPartner['uid'],
      'Invalid active chat partner',
    );
    final otherUid = userIds.firstWhere((uid) => uid != currentUid);
    if (partnerUid != otherUid) {
      throw const FormatException('Invalid active chat partner');
    }
    final partner = <String, dynamic>{
      'uid': partnerUid,
      'displayName': _requiredString(
        rawPartner['displayName'],
        'Invalid active chat partner',
        allowEmpty: true,
      ),
      'photoUrl': _requiredString(
        rawPartner['photoUrl'],
        'Invalid active chat partner',
        allowEmpty: true,
      ),
      'nationality': _requiredString(
        rawPartner['nationality'],
        'Invalid active chat partner',
        allowEmpty: true,
      ),
      'gender': _requiredString(
        rawPartner['gender'],
        'Invalid active chat partner',
        allowEmpty: true,
      ),
    };

    final rawUnreadCount = room['unreadCount'];
    final rawFavorite = room['favorite'];
    final rawPreview = room['lastMessagePreview'];
    if (rawUnreadCount is! int ||
        rawUnreadCount < 0 ||
        rawFavorite is! bool ||
        (rawPreview != null && rawPreview is! String)) {
      throw const FormatException('Invalid active chat room');
    }

    return Match(
      matchId: matchId,
      userIds: userIds,
      createdAt: _dateTimeFromMillis(
            room['createdAtMillis'],
            allowNull: true,
          ) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      lastMessageAt: _dateTimeFromMillis(
        room['lastMessageAtMillis'],
        allowNull: true,
      ),
      lastMessagePreview: rawPreview as String?,
      unread: {currentUid: rawUnreadCount},
      favoriteFor: {currentUid: rawFavorite},
      partnerFor: {currentUid: partner},
    );
  }).toList(growable: false);

  return ActiveChatsCallablePage(rooms: rooms, nextCursor: nextCursor);
}

Map<String, dynamic> _stringMap(Object? value, String message) {
  if (value is! Map) throw FormatException(message);
  try {
    return Map<String, dynamic>.from(value);
  } catch (_) {
    throw FormatException(message);
  }
}

String _roomId(Object? value, String message) {
  final id = _requiredString(value, message);
  if (id.length > 128 || id.contains('/')) throw FormatException(message);
  return id;
}

String _requiredString(
  Object? value,
  String message, {
  bool allowEmpty = false,
}) {
  if (value is! String || (!allowEmpty && value.isEmpty)) {
    throw FormatException(message);
  }
  return value;
}

List<String> _participantUids(Object? value, String currentUid) {
  if (value is! List || value.length != 2) {
    throw const FormatException('Invalid active chat participants');
  }
  final userIds = value.whereType<String>().toList(growable: false);
  if (userIds.length != 2 ||
      userIds.any((uid) => uid.isEmpty) ||
      userIds.toSet().length != 2 ||
      !userIds.contains(currentUid)) {
    throw const FormatException('Invalid active chat participants');
  }
  return userIds;
}

DateTime? _dateTimeFromMillis(Object? value, {required bool allowNull}) {
  if (value == null && allowNull) return null;
  if (value is! int || value < 0) {
    throw const FormatException('Invalid active chat timestamp');
  }
  try {
    return DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
  } on ArgumentError {
    throw const FormatException('Invalid active chat timestamp');
  }
}
