class PublicProfile {
  final String uid;
  final String displayName;
  final int birthYear;
  final String gender;
  final String nationality;
  final String residingCountry;
  final String city;
  final String nativeLanguage;
  final String learningLanguage;
  final String bio;
  final String occupation;
  final List<String> photoUrls;
  final List<String> keywords;
  final String relationshipType;
  final bool isOnline;
  final bool canTranslate;
  final int? affinityScore;
  final List<Map<String, String>> qaItems;
  final int likeCount;
  final double avgRating;
  final int ratingCount;
  final DateTime? lastSeenAt;

  PublicProfile({
    required this.uid,
    required this.displayName,
    required this.birthYear,
    required this.gender,
    required this.nationality,
    required this.residingCountry,
    this.city = '',
    required this.nativeLanguage,
    required this.learningLanguage,
    required this.bio,
    this.occupation = '',
    required this.photoUrls,
    this.keywords = const [],
    this.relationshipType = '',
    this.isOnline = false,
    this.canTranslate = true,
    this.affinityScore,
    this.qaItems = const [],
    this.likeCount = 0,
    this.avgRating = 0.0,
    this.ratingCount = 0,
    this.lastSeenAt,
  });

  int get age => DateTime.now().year - birthYear;
  bool get isOnlineNow =>
      lastSeenAt != null &&
      DateTime.now().difference(lastSeenAt!).inMinutes < 5;
  bool get isRecentlyActive =>
      lastSeenAt != null && DateTime.now().difference(lastSeenAt!).inHours < 1;

  factory PublicProfile.fromMap(Map<String, dynamic> data) {
    return PublicProfile(
      uid: data['uid'] as String? ?? '',
      displayName: data['displayName'] as String? ?? 'User',
      birthYear: (data['birthYear'] as num?)?.toInt() ?? 2000,
      gender: data['gender'] as String? ?? 'female',
      nationality: data['nationality'] as String? ?? 'KR',
      residingCountry: data['residingCountry'] as String? ?? 'KR',
      city: data['city'] as String? ?? '',
      nativeLanguage: data['nativeLanguage'] as String? ?? '',
      learningLanguage: data['learningLanguage'] as String? ?? '',
      bio: data['bio'] as String? ?? '',
      occupation: data['occupation'] as String? ?? '',
      photoUrls: List<String>.from(data['photoUrls'] as List? ?? const []),
      keywords: List<String>.from(data['keywords'] as List? ?? const []),
      relationshipType: data['relationshipType'] as String? ?? '',
      isOnline: data['isOnline'] as bool? ?? false,
      canTranslate: data['canTranslate'] as bool? ?? true,
      affinityScore: data['affinityScore'] as int?,
      qaItems: (data['qaItems'] as List?)
              ?.map((e) => Map<String, String>.from(e as Map))
              .toList() ??
          const [],
      likeCount: (data['likeCount'] as num?)?.toInt() ?? 0,
      avgRating: (data['avgRating'] as num?)?.toDouble() ?? 0.0,
      ratingCount: (data['ratingCount'] as num?)?.toInt() ?? 0,
      lastSeenAt: data['lastSeenAt'] as DateTime?,
    );
  }
}

class DiscoveryFilter {
  static const all = '\uC804\uCCB4';

  final String region;
  final String relationship;
  final String ageRange;
  final String gender;

  const DiscoveryFilter({
    this.region = all,
    this.relationship = all,
    this.ageRange = all,
    this.gender = all,
  });

  bool get isDefault =>
      region == all && relationship == all && ageRange == all && gender == all;

  DiscoveryFilter copyWith({
    String? region,
    String? relationship,
    String? ageRange,
    String? gender,
  }) {
    return DiscoveryFilter(
      region: region ?? this.region,
      relationship: relationship ?? this.relationship,
      ageRange: ageRange ?? this.ageRange,
      gender: gender ?? this.gender,
    );
  }

  bool matches(PublicProfile p) {
    if (!_isAllRegion && p.nationality != region) return false;
    if (!_isAllRelationship && p.relationshipType != relationship) {
      return false;
    }
    if (!_isAllGender && p.gender != gender) return false;
    if (!_isAllAgeRange) {
      final a = p.age;
      switch (ageRange) {
        case '20-25':
          if (a < 20 || a > 25) return false;
          break;
        case '26-30':
          if (a < 26 || a > 30) return false;
          break;
        case '31-35':
          if (a < 31 || a > 35) return false;
          break;
        case '36+':
          if (a < 36) return false;
          break;
      }
    }
    return true;
  }

  bool get _isAllRegion => region == all || (region != 'KR' && region != 'JP');

  bool get _isAllRelationship =>
      relationship == all ||
      !const {
        '\uCE5C\uAD6C',
        '\uC5B8\uC5B4\uAD50\uD658',
        '\uC5F0\uC560',
        '\uACB0\uD63C',
      }.contains(relationship);

  bool get _isAllGender =>
      gender == all || (gender != 'male' && gender != 'female');

  bool get _isAllAgeRange =>
      ageRange == all ||
      !const {'20-25', '26-30', '31-35', '36+'}.contains(ageRange);
}

class DiscoveryState {
  final List<PublicProfile> candidates;
  final Set<String> likedUids;
  final int quotaRemaining;
  final DateTime? quotaResetAt;
  final bool isLoading;
  final bool isLoadingMore;
  final bool hasMore;
  final String? error;
  final PublicProfile? matchedUser;
  final String? matchId;
  final DiscoveryFilter filter;

  DiscoveryState({
    this.candidates = const [],
    this.likedUids = const {},
    this.quotaRemaining = 0,
    this.quotaResetAt,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.hasMore = true,
    this.error,
    this.matchedUser,
    this.matchId,
    this.filter = const DiscoveryFilter(),
  });

  DiscoveryState copyWith({
    List<PublicProfile>? candidates,
    Set<String>? likedUids,
    int? quotaRemaining,
    DateTime? quotaResetAt,
    bool? isLoading,
    bool? isLoadingMore,
    bool? hasMore,
    String? error,
    PublicProfile? matchedUser,
    String? matchId,
    DiscoveryFilter? filter,
    bool clearMatch = false,
  }) {
    return DiscoveryState(
      candidates: candidates ?? this.candidates,
      likedUids: likedUids ?? this.likedUids,
      quotaRemaining: quotaRemaining ?? this.quotaRemaining,
      quotaResetAt: quotaResetAt ?? this.quotaResetAt,
      isLoading: isLoading ?? this.isLoading,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      hasMore: hasMore ?? this.hasMore,
      error: error,
      matchedUser: clearMatch ? null : (matchedUser ?? this.matchedUser),
      matchId: clearMatch ? null : (matchId ?? this.matchId),
      filter: filter ?? this.filter,
    );
  }

  List<PublicProfile> get filteredCandidates {
    final filtered = candidates.where(filter.matches).toList();
    final result = filtered.isEmpty && filter.isDefault
        ? List<PublicProfile>.from(candidates)
        : filtered;
    result.sort((a, b) {
      if (a.lastSeenAt == null && b.lastSeenAt == null) return 0;
      if (a.lastSeenAt == null) return 1;
      if (b.lastSeenAt == null) return -1;
      return b.lastSeenAt!.compareTo(a.lastSeenAt!);
    });
    return result;
  }
}
