class LoungePost {
  static const allCategory = '\uC804\uCCB4';

  final String id;
  final String uid;
  final String authorName;
  final String authorPhotoUrl;
  final String authorNationality;
  final String authorGender;
  final String category;
  final String content;
  final List<String> imageUrls;
  final int likeCount;
  final int commentCount;
  final DateTime createdAt;
  final bool isLikedByMe;
  final String? translatedKo;
  final String? translatedJa;
  final String? originalLang;

  LoungePost({
    required this.id,
    required this.uid,
    required this.authorName,
    required this.authorPhotoUrl,
    required this.authorNationality,
    this.authorGender = 'female',
    required this.category,
    required this.content,
    required this.imageUrls,
    required this.likeCount,
    required this.commentCount,
    required this.createdAt,
    this.isLikedByMe = false,
    this.translatedKo,
    this.translatedJa,
    this.originalLang,
  });

  factory LoungePost.fromMap(Map<String, dynamic> data) {
    return LoungePost(
      id: data['id'] as String? ?? '',
      uid: data['uid'] as String? ?? '',
      authorName: data['authorName'] as String? ?? 'User',
      authorPhotoUrl: data['authorPhotoUrl'] as String? ?? '',
      authorNationality: data['authorNationality'] as String? ?? 'KR',
      authorGender: data['authorGender'] as String? ?? 'female',
      category: data['category'] as String? ?? '\uC77C\uC0C1',
      content: data['content'] as String? ?? '',
      imageUrls: List<String>.from(data['imageUrls'] as List? ?? const []),
      likeCount: (data['likeCount'] as num?)?.toInt() ?? 0,
      commentCount: (data['commentCount'] as num?)?.toInt() ?? 0,
      createdAt: loungeDateTimeFromCallable(data['createdAt']),
      isLikedByMe: data['isLikedByMe'] as bool? ?? false,
      translatedKo: data['translatedKo'] as String?,
      translatedJa: data['translatedJa'] as String?,
      originalLang: data['originalLang'] as String?,
    );
  }

  LoungePost copyWith({bool? isLikedByMe, int? likeCount}) {
    return LoungePost(
      id: id,
      uid: uid,
      authorName: authorName,
      authorPhotoUrl: authorPhotoUrl,
      authorNationality: authorNationality,
      authorGender: authorGender,
      category: category,
      content: content,
      imageUrls: imageUrls,
      likeCount: likeCount ?? this.likeCount,
      commentCount: commentCount,
      createdAt: createdAt,
      isLikedByMe: isLikedByMe ?? this.isLikedByMe,
      translatedKo: translatedKo,
      translatedJa: translatedJa,
      originalLang: originalLang,
    );
  }

  String? translationFor(String myNationality) {
    if (myNationality == 'KR') return translatedKo;
    if (myNationality == 'JP') return translatedJa;
    return null;
  }

  bool needsTranslation(String myNationality) {
    final myLang = myNationality == 'KR' ? 'ko' : 'ja';
    if (originalLang != null) return originalLang != myLang;
    // originalLang 없는 구글 글은 nationality 기반 폴백
    return authorNationality != myNationality;
  }
}

DateTime loungeDateTimeFromCallable(Object? value) {
  if (value is DateTime) return value;
  if (value is String) {
    return DateTime.tryParse(value)?.toLocal() ??
        DateTime.fromMillisecondsSinceEpoch(0);
  }
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  }
  if (value is Map) {
    final seconds = value['_seconds'] ?? value['seconds'];
    final nanoseconds = value['_nanoseconds'] ?? value['nanoseconds'] ?? 0;
    if (seconds is num && nanoseconds is num) {
      return DateTime.fromMicrosecondsSinceEpoch(
        seconds.toInt() * Duration.microsecondsPerSecond +
            nanoseconds.toInt() ~/ 1000,
      );
    }
  }
  try {
    final date = (value as dynamic).toDate();
    if (date is DateTime) return date;
  } catch (_) {
    // Unknown callable timestamp encodings remain safely parseable as epoch.
  }
  return DateTime.fromMillisecondsSinceEpoch(0);
}

const loungeCategories = [
  LoungePost.allCategory,
  '\uC77C\uC0C1',
  '\uC5EC\uD589',
  '\uC5B8\uC5B4\uAD50\uD658',
  '\uB9DB\uC9D1',
  '\uC9C8\uBB38',
];
