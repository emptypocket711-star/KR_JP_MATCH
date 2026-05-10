import 'package:cloud_functions/cloud_functions.dart';
import '../domain/safety_repository.dart';

class SafetyRepositoryImpl implements SafetyRepository {
  final FirebaseFunctions _functions;

  SafetyRepositoryImpl({FirebaseFunctions? functions})
      : _functions = functions ?? FirebaseFunctions.instance;

  @override
  Future<void> blockUser(String targetUid, {String? reason}) async {
    try {
      await _functions.httpsCallable('blockUser').call({
        'targetUid': targetUid,
        'reason': reason ?? '',
      });
    } catch (e) {
      rethrow;
    }
  }

  @override
  Future<void> unblockUser(String targetUid) async {
    try {
      await _functions.httpsCallable('unblockUser').call({
        'targetUid': targetUid,
      });
    } catch (e) {
      rethrow;
    }
  }

  @override
  Future<String> reportUser(
    String targetUid,
    String reason, {
    String? note,
    String? matchId,
  }) async {
    try {
      final result = await _functions.httpsCallable('reportUser').call({
        'targetUid': targetUid,
        'reason': reason,
        'note': note ?? '',
        'matchId': matchId ?? '',
      });
      return result.data['reportId'] as String? ?? '';
    } catch (e) {
      rethrow;
    }
  }
}
