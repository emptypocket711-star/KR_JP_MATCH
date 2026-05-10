import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/safety_repository_impl.dart';
import '../domain/safety_repository.dart';

final safetyRepositoryProvider = Provider<SafetyRepository>((ref) {
  return SafetyRepositoryImpl();
});
