class Match {
  final String matchId;
  final List<String> userIds;
  final DateTime createdAt;
  final DateTime? lastMessageAt;
  final String? lastMessagePreview;
  final Map<String, int> unread;
  final bool isActive;
  final List<String> hiddenFor;
  final Map<String, bool> favoriteFor;

  // 채팅 목록 표시용 — uid별 상대방 정보
  // partnerFor[myUid] = {displayName, photoUrl, nationality, gender}
  final Map<String, Map<String, dynamic>> partnerFor;

  // 레거시 필드 (구 match doc 호환)
  // userIds[0]=initiator, userIds[1]=target
  // displayName/photoUrl/nationality/gender = target(userIds[1])의 정보
  // myDisplayName 등 = initiator(userIds[0])의 정보
  final String? displayName;
  final String? photoUrl;
  final String? otherNationality;
  final String? otherGender;
  final String? myDisplayName;
  final String? myPhotoUrl;
  final String? myNationality;
  final String? myGender;

  Match({
    required this.matchId,
    required this.userIds,
    required this.createdAt,
    this.lastMessageAt,
    this.lastMessagePreview,
    this.unread = const {},
    this.isActive = true,
    this.hiddenFor = const [],
    this.favoriteFor = const {},
    this.partnerFor = const {},
    this.displayName,
    this.photoUrl,
    this.otherNationality,
    this.otherGender,
    this.myDisplayName,
    this.myPhotoUrl,
    this.myNationality,
    this.myGender,
  });

  /// 내 uid를 넘기면 상대방 displayName 반환
  String partnerName(String myUid) {
    if (partnerFor.containsKey(myUid)) {
      return partnerFor[myUid]!['displayName'] as String? ?? '상대방';
    }
    // 레거시: userIds[0]=initiator가 보면 displayName(target 이름),
    //        userIds[1]=target이 보면 myDisplayName(initiator 이름)
    if (userIds.length == 2) {
      if (myUid == userIds[0]) return displayName ?? '상대방';
      if (myUid == userIds[1]) return myDisplayName ?? displayName ?? '상대방';
    }
    return displayName ?? '상대방';
  }

  String partnerPhoto(String myUid) {
    if (partnerFor.containsKey(myUid)) {
      return partnerFor[myUid]!['photoUrl'] as String? ?? '';
    }
    if (userIds.length == 2) {
      if (myUid == userIds[0]) return photoUrl ?? '';
      if (myUid == userIds[1]) return myPhotoUrl ?? photoUrl ?? '';
    }
    return photoUrl ?? '';
  }

  String partnerNationality(String myUid) {
    if (partnerFor.containsKey(myUid)) {
      return partnerFor[myUid]!['nationality'] as String? ?? 'JP';
    }
    if (userIds.length == 2) {
      if (myUid == userIds[0]) return otherNationality ?? 'JP';
      if (myUid == userIds[1]) return myNationality ?? otherNationality ?? 'JP';
    }
    return otherNationality ?? 'JP';
  }

  String partnerGender(String myUid) {
    if (partnerFor.containsKey(myUid)) {
      return partnerFor[myUid]!['gender'] as String? ?? 'female';
    }
    if (userIds.length == 2) {
      if (myUid == userIds[0]) return otherGender ?? 'female';
      if (myUid == userIds[1]) return myGender ?? otherGender ?? 'female';
    }
    return otherGender ?? 'female';
  }

  String get id => matchId;
  String? get lastMessage => lastMessagePreview;

  int unreadCountFor(String uid) => unread[uid] ?? 0;

  bool isHiddenFor(String uid) => hiddenFor.contains(uid);

  bool isFavoriteFor(String uid) => favoriteFor[uid] ?? false;

  static DateTime _toDateTime(dynamic value) {
    if (value == null) return DateTime.now();
    if (value is DateTime) return value;
    if (value.runtimeType.toString().contains('Timestamp')) {
      return (value as dynamic).toDate() as DateTime;
    }
    return DateTime.parse(value as String);
  }

  factory Match.fromMap(Map<String, dynamic> data) {
    Map<String, Map<String, dynamic>> partnerFor = {};
    if (data['partnerFor'] is Map) {
      final raw = data['partnerFor'] as Map;
      raw.forEach((k, v) {
        if (v is Map) {
          partnerFor[k as String] = Map<String, dynamic>.from(v);
        }
      });
    }
    return Match(
      matchId: data['matchId'] as String? ?? data['id'] as String? ?? '',
      userIds: List<String>.from(data['userIds'] as List? ?? []),
      createdAt: _toDateTime(data['createdAt']),
      lastMessageAt: data['lastMessageAt'] != null
          ? _toDateTime(data['lastMessageAt'])
          : null,
      lastMessagePreview: data['lastMessagePreview'] as String? ??
          data['lastMessage'] as String?,
      unread: Map<String, int>.from((data['unread'] as Map?) ?? {}),
      isActive: data['isActive'] as bool? ?? true,
      hiddenFor: List<String>.from(data['hiddenFor'] as List? ?? []),
      favoriteFor: Map<String, bool>.from((data['favoriteFor'] as Map?) ?? {}),
      partnerFor: partnerFor,
      displayName: data['displayName'] as String?,
      photoUrl: data['photoUrl'] as String?,
      otherNationality: data['otherNationality'] as String?,
      otherGender: data['otherGender'] as String?,
      myDisplayName: data['myDisplayName'] as String?,
      myPhotoUrl: data['myPhotoUrl'] as String?,
      myNationality: data['myNationality'] as String?,
      myGender: data['myGender'] as String?,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'matchId': matchId,
      'userIds': userIds,
      'createdAt': createdAt.toIso8601String(),
      'lastMessageAt': lastMessageAt?.toIso8601String(),
      'lastMessagePreview': lastMessagePreview,
      'unread': unread,
      'isActive': isActive,
      'hiddenFor': hiddenFor,
      'favoriteFor': favoriteFor,
      'displayName': displayName,
      'photoUrl': photoUrl,
      'otherNationality': otherNationality,
      'otherGender': otherGender,
    };
  }
}
