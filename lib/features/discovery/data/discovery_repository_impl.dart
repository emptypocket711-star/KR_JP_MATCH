import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../domain/candidate.dart';
import '../domain/discovery_repository.dart';
import '../../../core/services/firebase_service.dart';

class DiscoveryRepositoryImpl implements DiscoveryRepository {
  final FirebaseService _firebaseService;
  final _firestore = FirebaseFirestore.instance;
  final _auth = FirebaseAuth.instance;

  static const int _pageSize = 50;
  DocumentSnapshot? _lastDoc;
  bool _hasMore = true;
  String? _cachedUid;
  String? _cachedOpposite;
  Set<String> _cachedBlockedUids = {};

  DiscoveryRepositoryImpl({FirebaseService? firebaseService})
      : _firebaseService = firebaseService ?? FirebaseService();

  @override
  bool get hasMore => _hasMore;

  @override
  Future<List<PublicProfile>> fetchUsers({bool reset = false}) async {
    final currentUser = _auth.currentUser;
    if (currentUser == null) throw Exception('Login is required');
    final uid = currentUser.uid;

    if (reset || _cachedUid != uid) {
      _lastDoc = null;
      _hasMore = true;
      _cachedUid = uid;

      final results = await Future.wait([
        _firestore.collection('users').doc(uid).get(),
        _firestore.collection('users').doc(uid).collection('blocks').get(),
      ]).timeout(const Duration(seconds: 10));
      final myDoc = results[0] as DocumentSnapshot;
      final blocksSnap = results[1] as QuerySnapshot;

      final myNationality = ((myDoc.data()
              as Map<String, dynamic>?)?['nationality'] as String?) ??
          'KR';
      _cachedOpposite = myNationality == 'KR' ? 'JP' : 'KR';
      _cachedBlockedUids = blocksSnap.docs.map((d) => d.id).toSet();
    }

    if (!_hasMore) return [];

    var query = _firestore
        .collection('users')
        .where('nationality', isEqualTo: _cachedOpposite)
        .where('onboardingCompleted', isEqualTo: true)
        .limit(_pageSize);

    if (_lastDoc != null) {
      query = query.startAfterDocument(_lastDoc!);
    }

    final snap = await query.get().timeout(const Duration(seconds: 10));

    _hasMore = snap.docs.length == _pageSize;
    if (snap.docs.isNotEmpty) _lastDoc = snap.docs.last;

    return snap.docs
        .where((doc) => doc.id != uid && !_cachedBlockedUids.contains(doc.id))
        .map((doc) {
      final data = Map<String, dynamic>.from(doc.data());
      data['uid'] = doc.id;
      final ts = data['lastSeenAt'];
      if (ts != null) {
        try {
          data['lastSeenAt'] = (ts as dynamic).toDate() as DateTime;
        } catch (_) {}
      }
      return PublicProfile.fromMap(data);
    }).toList();
  }

  @override
  Future<Map<String, dynamic>> requestCandidates({int limit = 10}) async {
    try {
      final callable = _firebaseService.functions.httpsCallable(
        'requestCandidates',
      );
      final result = await callable.call({'limit': limit});
      return Map<String, dynamic>.from(result.data);
    } catch (e) {
      throw Exception('Failed to request candidates: $e');
    }
  }

  @override
  Future<Map<String, dynamic>> likeUser(String targetUid) async {
    final currentUser = _auth.currentUser;
    if (currentUser == null) throw Exception('로그인이 필요합니다.');

    final likeDocId = '${currentUser.uid}_$targetUid';
    final existingLike =
        await _firestore.collection('likes').doc(likeDocId).get();
    if (existingLike.exists) {
      return {'liked': false, 'alreadyLiked': true};
    }

    await _firestore.collection('likes').doc(likeDocId).set({
      'fromUid': currentUser.uid,
      'toUid': targetUid,
      'createdAt': FieldValue.serverTimestamp(),
    });

    try {
      await _firestore
          .collection('users')
          .doc(targetUid)
          .update({'likeCount': FieldValue.increment(1)});
    } catch (_) {}

    return {'liked': true, 'isMatch': false};
  }

  @override
  Future<String> startDirectChat(String targetUid) async {
    final callable = _firebaseService.functions.httpsCallable('startChat');
    final result = await callable.call({'targetUid': targetUid});
    final data = Map<String, dynamic>.from(result.data as Map);
    return data['matchId'] as String;
  }

  @override
  Future<Map<String, dynamic>> passUser(String targetUid) async {
    try {
      final callable = _firebaseService.functions.httpsCallable('passUser');
      final result = await callable.call({'targetUid': targetUid});
      return Map<String, dynamic>.from(result.data);
    } catch (e) {
      return {'passed': true};
    }
  }
}
