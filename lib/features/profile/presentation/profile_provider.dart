import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/profile_repository_impl.dart';
import '../domain/profile_repository.dart';

final profileRepositoryProvider = Provider<ProfileRepository>((ref) {
  return ProfileRepositoryImpl();
});
