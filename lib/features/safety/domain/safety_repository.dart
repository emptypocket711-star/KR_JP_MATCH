abstract class SafetyRepository {
  Future<void> blockUser(String targetUid, {String? reason});

  Future<void> unblockUser(String targetUid);

  Future<String> reportUser(
    String targetUid,
    String reason, {
    String? note,
    String? matchId,
  });
}
