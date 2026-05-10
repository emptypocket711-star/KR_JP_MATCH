import 'package:firebase_auth/firebase_auth.dart';

abstract class AuthRepository {
  Future<UserCredential> signInWithGoogle();

  Future<void> signInWithPhoneNumber(String phoneNumber);

  Future<void> signOut();

  Stream<User?> authStateChanges();

  User? getCurrentUser();
}
