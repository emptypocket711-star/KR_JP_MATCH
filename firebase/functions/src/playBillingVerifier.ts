import { google } from 'googleapis';
import { androidPackageName, VerifiedPlayProductPurchase } from './pointPolicy';

export async function verifyGooglePlayProductPurchase(
  productId: string,
  purchaseToken: string
): Promise<VerifiedPlayProductPurchase> {
  const auth = await google.auth.getClient({
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const androidpublisher = google.androidpublisher({
    version: 'v3',
    auth,
  });

  const response = await androidpublisher.purchases.products.get({
    packageName: androidPackageName,
    productId,
    token: purchaseToken,
  });

  return {
    purchaseState: response.data.purchaseState,
    consumptionState: response.data.consumptionState,
    acknowledgementState: response.data.acknowledgementState,
    orderId: response.data.orderId,
    purchaseTimeMillis: response.data.purchaseTimeMillis,
    productId: response.data.productId,
    quantity: response.data.quantity,
    obfuscatedExternalAccountId:
      response.data.obfuscatedExternalAccountId,
  };
}
