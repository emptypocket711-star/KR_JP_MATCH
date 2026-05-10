import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

class FirebaseService {
  static final FirebaseService _instance = FirebaseService._internal();

  factory FirebaseService() {
    return _instance;
  }

  FirebaseService._internal();

  late FirebaseAuth _auth;
  late FirebaseFirestore _firestore;
  late FirebaseStorage _storage;
  late FirebaseFunctions _functions;
  late FirebaseMessaging _messaging;

  FirebaseAuth get auth => _auth;
  FirebaseFirestore get firestore => _firestore;
  FirebaseStorage get storage => _storage;
  FirebaseFunctions get functions => _functions;
  FirebaseMessaging get messaging => _messaging;

  void initialize() {
    _auth = FirebaseAuth.instance;
    _firestore = FirebaseFirestore.instance;
    _storage = FirebaseStorage.instance;
    _functions = FirebaseFunctions.instance;
    _messaging = FirebaseMessaging.instance;

    _firestore.settings = const Settings(
      persistenceEnabled: true,
      cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
    );

    // App Check 토큰 갱신 감지 — 토큰이 바뀔 때 Firestore/Storage/Auth 재연결 불필요
    // (SDK가 자동으로 새 토큰을 다음 요청에 첨부함)
    FirebaseAppCheck.instance.onTokenChange.listen((_) {});
  }
}
