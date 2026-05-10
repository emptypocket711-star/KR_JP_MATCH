import 'match.dart';

abstract class MatchesRepository {
  Stream<List<Match>> watchMatches(String currentUid);
}
