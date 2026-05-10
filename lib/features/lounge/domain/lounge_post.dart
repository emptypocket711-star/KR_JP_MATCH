import 'package:cloud_firestore/cloud_firestore.dart';

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

  factory LoungePost.fromDoc(DocumentSnapshot doc) {
    final raw = doc.data();
    final d = raw is Map<String, dynamic> ? raw : <String, dynamic>{};
    return LoungePost(
      id: doc.id,
      uid: d['uid'] as String? ?? '',
      authorName: d['authorName'] as String? ?? 'User',
      authorPhotoUrl: d['authorPhotoUrl'] as String? ?? '',
      authorNationality: d['authorNationality'] as String? ?? 'KR',
      authorGender: d['authorGender'] as String? ?? 'female',
      category: d['category'] as String? ?? '\uC77C\uC0C1',
      content: d['content'] as String? ?? '',
      imageUrls: List<String>.from(d['imageUrls'] as List? ?? const []),
      likeCount: (d['likeCount'] as num?)?.toInt() ?? 0,
      commentCount: (d['commentCount'] as num?)?.toInt() ?? 0,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      translatedKo: d['translatedKo'] as String?,
      translatedJa: d['translatedJa'] as String?,
      originalLang: d['originalLang'] as String?,
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

const loungeCategories = [
  LoungePost.allCategory,
  '\uC77C\uC0C1',
  '\uC5EC\uD589',
  '\uC5B8\uC5B4\uAD50\uD658',
  '\uB9DB\uC9D1',
  '\uC9C8\uBB38',
];
