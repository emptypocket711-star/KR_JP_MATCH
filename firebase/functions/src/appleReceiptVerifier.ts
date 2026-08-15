import {
  JWSTransactionDecodedPayload,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library';
import { loadPinnedAppleRootCertificates } from './appleRootCertificates';
import {
  AppleStoreVerificationConfig,
  appleTransactionClaimIssue,
} from './storePurchasePolicy';

export interface VerifiedAppleProductPurchase {
  transactionId: string;
  originalTransactionId: string | null;
  productId: string;
  quantity: 1;
  appAccountToken: string;
  environment: string;
  purchaseDate: number | null;
  signedDate: number | null;
}

export interface AppleSignedTransactionVerifier {
  verifyAndDecodeTransaction(
    signedTransactionInfo: string
  ): Promise<JWSTransactionDecodedPayload>;
}

export class ApplePurchaseVerificationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly supportCode: string
  ) {
    super(message);
    this.name = 'ApplePurchaseVerificationError';
  }
}

export interface VerifyApplePurchaseInput {
  signedTransaction: string;
  productId: string;
  transactionId: string;
  appAccountToken: string;
  config: AppleStoreVerificationConfig;
  verifier?: AppleSignedTransactionVerifier;
}

function createVerifier(
  config: AppleStoreVerificationConfig
): AppleSignedTransactionVerifier {
  return new SignedDataVerifier(
    loadPinnedAppleRootCertificates(),
    config.enableOnlineChecks,
    config.environment,
    config.bundleId,
    config.appAppleId
  );
}

/**
 * Verifies the StoreKit 2 transaction JWS with Apple's official library and
 * pinned Apple roots, then applies Hana's consumable point-package contract.
 */
export async function verifyAppleAppStoreProductPurchase(
  input: VerifyApplePurchaseInput
): Promise<VerifiedAppleProductPurchase> {
  let transaction: JWSTransactionDecodedPayload;
  try {
    transaction = await (input.verifier ?? createVerifier(input.config))
      .verifyAndDecodeTransaction(input.signedTransaction);
  } catch (error) {
    const retryable =
      error instanceof VerificationException &&
      error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;
    throw new ApplePurchaseVerificationError(
      'App Store signed transaction verification failed',
      retryable,
      retryable ? 'apple_verification_retryable' : 'apple_signature_invalid'
    );
  }

  const issue = appleTransactionClaimIssue(transaction, {
    productId: input.productId,
    transactionId: input.transactionId,
    appAccountToken: input.appAccountToken,
    environment: input.config.environment,
    bundleId: input.config.bundleId,
  });
  if (issue != null) {
    throw new ApplePurchaseVerificationError(
      'App Store transaction claims do not match the purchase request',
      false,
      issue
    );
  }

  return {
    transactionId: transaction.transactionId!,
    originalTransactionId: transaction.originalTransactionId ?? null,
    productId: transaction.productId!,
    quantity: 1,
    appAccountToken: transaction.appAccountToken!,
    environment: transaction.environment!,
    purchaseDate: transaction.purchaseDate ?? null,
    signedDate: transaction.signedDate ?? null,
  };
}
