import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/matches_repository_impl.dart';
import '../domain/matches_repository.dart';
import '../domain/match.dart';

final matchesRepositoryProvider = Provider<MatchesRepository>((ref) {
  return MatchesRepositoryImpl();
});

final matchesStreamProvider = StreamProvider<List<Match>>((ref) {
  final currentUser = FirebaseAuth.instance.currentUser;
  if (currentUser == null) {
    return Stream.value([]);
  }

  final repository = ref.watch(matchesRepositoryProvider);
  return repository.watchMatches(currentUser.uid);
});
