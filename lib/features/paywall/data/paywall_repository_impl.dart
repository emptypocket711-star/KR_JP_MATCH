import 'package:cloud_functions/cloud_functions.dart';
import '../domain/paywall_repository.dart';

class PaywallRepositoryImpl implements PaywallRepository {
  final FirebaseFunctions _functions;

  PaywallRepositoryImpl({FirebaseFunctions? functions})
      : _functions = functions ?? FirebaseFunctions.instance;

  @override
  Future<int> purchaseExtraQuota() async {
    try {
      final result = await _functions.httpsCallable('purchaseExtraQuota').call({
        'receipt': 'stub_receipt_mvp',
        'platform': 'android',
      });
      return result.data['extraQuotaGranted'] as int? ?? 10;
    } catch (e) {
      rethrow;
    }
  }
}
