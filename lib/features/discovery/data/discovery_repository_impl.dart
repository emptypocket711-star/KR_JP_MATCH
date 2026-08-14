import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

import '../../../app/config/app_config.dart';
import '../domain/candidate.dart';
import '../domain/discovery_repository.dart';

class DiscoveryRepositoryImpl implements DiscoveryRepository {
  DiscoveryRepositoryImpl({FirebaseFunctions? functions})
      : _functions = functions ??
            FirebaseFunctions.instanceFor(
              region: AppConfig.firebaseFunctionsRegion,
            );

  static const int _pageSize = 20;

  final FirebaseFunctions _functions;
  final Set<String> _loadedUids = <String>{};
  final Set<String> _passedUids = <String>{};
  bool _hasMore = true;

  @override
  bool get hasMore => _hasMore;

  @override
  Future<List<PublicProfile>> fetchUsers({bool reset = false}) async {
    if (reset) {
      _loadedUids.clear();
      _hasMore = true;
    }
    if (!_hasMore) return const [];
    final excludedUids = <String>{..._loadedUids, ..._passedUids};

    final result = await _functions
        .httpsCallable(
      'listDiscoveryProfiles',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 35),
      ),
    )
        .call({
      'limit': _pageSize,
      'excludeUids': excludedUids.toList(growable: false),
    });
    final page = parseDiscoveryProfilesCallableData(result.data);
    _hasMore = page.hasMore;
    _loadedUids.addAll(page.profiles.map((profile) => profile.uid));
    return page.profiles;
  }

  @override
  Future<Map<String, dynamic>> requestCandidates({int limit = 10}) async {
    final result = await _functions
        .httpsCallable(
      'requestCandidates',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 15),
      ),
    )
        .call({'limit': limit});
    return _stringMap(result.data, 'Invalid candidate response');
  }

  @override
  Future<Map<String, dynamic>> likeUser(String targetUid) async {
    final result = await _functions
        .httpsCallable(
      'likeUser',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 15),
      ),
    )
        .call({'targetUid': targetUid});
    return _stringMap(result.data, 'Invalid like response');
  }

  @override
  Future<Map<String, dynamic>> passUser(String targetUid) async {
    final result = await _functions
        .httpsCallable(
      'passUser',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 15),
      ),
    )
        .call({'targetUid': targetUid});
    final data = _stringMap(result.data, 'Invalid pass response');
    if (data['ok'] != true) {
      throw const FormatException('Invalid pass response');
    }
    _passedUids.add(targetUid);
    return data;
  }

  @override
  Future<ProfileDetailResult> getProfileDetail(String targetUid) async {
    final result = await _functions
        .httpsCallable(
      'getProfileDetail',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 30),
      ),
    )
        .call({'uid': targetUid});
    return parseProfileDetailCallableData(result.data);
  }

  @override
  Future<String> startDirectChat(String targetUid) async {
    final result = await _functions
        .httpsCallable(
      'startChat',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 30),
      ),
    )
        .call({'targetUid': targetUid});
    final data = _stringMap(result.data, 'Invalid start-chat response');
    final matchId = data['matchId'];
    if (matchId is! String || matchId.isEmpty) {
      throw const FormatException('Invalid start-chat response');
    }
    return matchId;
  }

  @override
  Future<void> submitRating({
    required String ratedUid,
    required int stars,
    required List<String> tags,
  }) async {
    final result = await _functions
        .httpsCallable(
      'submitRating',
      options: HttpsCallableOptions(
        timeout: const Duration(seconds: 20),
      ),
    )
        .call({
      'ratedUid': ratedUid,
      'stars': stars,
      'tags': tags,
    });
    final data = _stringMap(result.data, 'Invalid rating response');
    if (data['ok'] != true) {
      throw const FormatException('Invalid rating response');
    }
  }
}

@immutable
class DiscoveryProfilesPage {
  const DiscoveryProfilesPage({
    required this.profiles,
    required this.hasMore,
  });

  final List<PublicProfile> profiles;
  final bool hasMore;
}

@visibleForTesting
DiscoveryProfilesPage parseDiscoveryProfilesCallableData(Object? value) {
  final data = _stringMap(value, 'Invalid discovery response');
  final rawProfiles = data['profiles'];
  final hasMore = data['hasMore'];
  if (rawProfiles is! List || hasMore is! bool) {
    throw const FormatException('Invalid discovery response');
  }
  final profiles = rawProfiles.map((raw) {
    final profile = _stringMap(raw, 'Invalid discovery profile');
    final uid = profile['uid'];
    if (uid is! String || uid.isEmpty) {
      throw const FormatException('Invalid discovery profile');
    }
    return PublicProfile.fromMap(profile);
  }).toList(growable: false);
  return DiscoveryProfilesPage(profiles: profiles, hasMore: hasMore);
}

@visibleForTesting
ProfileDetailResult parseProfileDetailCallableData(Object? value) {
  final data = _stringMap(value, 'Invalid profile-detail response');
  final profileData = data['profile'];
  final isOwnProfile = data['isOwnProfile'];
  final hasActiveChat = data['hasActiveChat'];
  final hasAlreadyRated = data['hasAlreadyRated'];
  if (profileData is! Map ||
      isOwnProfile is! bool ||
      hasActiveChat is! bool ||
      hasAlreadyRated is! bool) {
    throw const FormatException('Invalid profile-detail response');
  }
  final profile = PublicProfile.fromMap(
    _stringMap(profileData, 'Invalid profile-detail response'),
  );
  if (profile.uid.isEmpty) {
    throw const FormatException('Invalid profile-detail response');
  }
  return ProfileDetailResult(
    profile: profile,
    isOwnProfile: isOwnProfile,
    hasActiveChat: hasActiveChat,
    hasAlreadyRated: hasAlreadyRated,
  );
}

Map<String, dynamic> _stringMap(Object? value, String message) {
  if (value is! Map) throw FormatException(message);
  try {
    return Map<String, dynamic>.from(value);
  } catch (_) {
    throw FormatException(message);
  }
}
