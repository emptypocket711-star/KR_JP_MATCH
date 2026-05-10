import 'candidate.dart';

abstract class DiscoveryRepository {
  /// 반대 국적 유저를 페이지 단위로 조회. reset=true 면 첫 페이지부터 다시 로드.
  Future<List<PublicProfile>> fetchUsers({bool reset = false});

  /// 다음 페이지가 있는지 여부.
  bool get hasMore;

  /// Cloud Function 기반 쿼터 추천 — 스와이프 기능 등 다른 용도로 유지.
  Future<Map<String, dynamic>> requestCandidates({int limit = 10});

  Future<Map<String, dynamic>> likeUser(String targetUid);

  Future<Map<String, dynamic>> passUser(String targetUid);

  /// 상대방과 즉시 1:1 채팅방 생성 — 매칭 없이도 가능. matchId 반환.
  Future<String> startDirectChat(String targetUid);
}
