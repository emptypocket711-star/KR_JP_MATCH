import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/paywall_repository_impl.dart';
import '../domain/paywall_repository.dart';

final paywallRepositoryProvider = Provider<PaywallRepository>((ref) {
  return PaywallRepositoryImpl();
});

class _PurchaseNotifier extends Notifier<AsyncValue<void>> {
  @override
  AsyncValue<void> build() => const AsyncData(null);

  void setLoading() => state = const AsyncLoading();
  void setDone() => state = const AsyncData(null);
  void setError(Object e) => state = AsyncError(e, StackTrace.current);
}

final purchaseStateProvider =
    NotifierProvider<_PurchaseNotifier, AsyncValue<void>>(
  _PurchaseNotifier.new,
);
