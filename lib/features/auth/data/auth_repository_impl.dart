import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../domain/auth_repository.dart';
import '../../../core/services/firebase_service.dart';

class AuthRepositoryImpl implements AuthRepository {
  final FirebaseService _firebaseService;
  final GoogleSignIn _googleSignIn;

  AuthRepositoryImpl({
    FirebaseService? firebaseService,
    GoogleSignIn? googleSignIn,
  })  : _firebaseService = firebaseService ?? FirebaseService(),
        _googleSignIn = googleSignIn ?? GoogleSignIn();

  @override
  Future<UserCredential> signInWithGoogle() async {
    final googleUser = await _googleSignIn.signIn();
    if (googleUser == null) {
      throw Exception('Google Sign-In cancelled');
    }

    final googleAuth = await googleUser.authentication;
    final credential = GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );

    return await _firebaseService.auth.signInWithCredential(credential);
  }

  @override
  Future<void> signInWithPhoneNumber(String phoneNumber) async {
    throw UnimplementedError('Phone authentication coming soon');
  }

  @override
  Future<void> signOut() async {
    await _firebaseService.auth.signOut();
    await _googleSignIn.signOut();
  }

  @override
  Stream<User?> authStateChanges() {
    return _firebaseService.auth.authStateChanges();
  }

  @override
  User? getCurrentUser() {
    return _firebaseService.auth.currentUser;
  }
}
