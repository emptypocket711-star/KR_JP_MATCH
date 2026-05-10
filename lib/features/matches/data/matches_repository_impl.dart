import 'package:cloud_firestore/cloud_firestore.dart';
import '../domain/matches_repository.dart';
import '../domain/match.dart';

class MatchesRepositoryImpl implements MatchesRepository {
  final _firestore = FirebaseFirestore.instance;

  @override
  Stream<List<Match>> watchMatches(String currentUid) {
    return _firestore
        .collection('matches')
        .where('userIds', arrayContains: currentUid)
        .where('isActive', isEqualTo: true)
        .snapshots()
        .map((snapshot) {
      final list = snapshot.docs
          .map((doc) {
            final data = Map<String, dynamic>.from(doc.data());
            data['matchId'] = doc.id;

            // userIds[0] = fromUid(좋아요 누른 사람), userIds[1] = targetUid
            // 현재 유저가 fromUid면 → 상대방은 target 정보
            // 현재 유저가 targetUid면 → 상대방은 my(from) 정보
            final userIds = List<String>.from(data['userIds'] as List? ?? []);
            final iAmFrom = userIds.isNotEmpty && userIds[0] == currentUid;

            if (iAmFrom) {
              // displayName/photoUrl이 이미 상대방(target) 정보
            } else {
              // 내가 target이면 from(상대방) 정보로 교체
              data['displayName'] = data['myDisplayName'];
              data['photoUrl'] = data['myPhotoUrl'];
              data['otherNationality'] = data['myNationality'];
              data['otherGender'] = data['myGender'];
            }

            return Match.fromMap(data);
          })
          .where((match) => !match.isHiddenFor(currentUid))
          .toList();

      list.sort((a, b) {
        final aFavorite = a.isFavoriteFor(currentUid);
        final bFavorite = b.isFavoriteFor(currentUid);
        if (aFavorite != bFavorite) {
          return aFavorite ? -1 : 1;
        }
        final aTime = a.lastMessageAt ?? a.createdAt;
        final bTime = b.lastMessageAt ?? b.createdAt;
        return bTime.compareTo(aTime);
      });
      return list;
    });
  }
}
