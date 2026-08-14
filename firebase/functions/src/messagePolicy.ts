import { parseMediaUploadObjectPath } from './mediaUploadPolicy';

export const MAX_CHAT_MESSAGE_LENGTH = 1000;

export const STICKER_PACKS = ['mogu', 'damong', 'mongle'] as const;

export const DEFAULT_STICKER_IDS = [
  'bored',
  'fighting',
  'goodmorning',
  'goodnight',
  'heartflutter',
  'hello',
  'laugh',
  'love',
  'missyou',
  'nice',
  'shy',
  'sorry',
  'thanks',
  'waitaminute',
  'waiting',
  'whatareyoudoing',
] as const;

export const MONGLE_STICKER_IDS = [
  'hello',
  'nice_to_meet_you',
  'thanks',
  'sorry',
  'like',
  'ohyeah',
  'haha',
  'yes_yes',
  'no',
  'waitaminute',
  'waiting',
  'whatareyoudoing',
  'goodnight',
  'goodmorning',
  'hungry',
  'nyamnyam',
  'bored',
  'missyou',
  'love',
  'shy',
  'heartflutter',
  'touched',
  'sigh',
  'blank',
  'hmm',
  'serious',
  'angry',
  'what_are_you_saying',
  'small',
  'dizzy',
  'panic',
  'unfair',
] as const;

export const STICKER_IDS_BY_PACK = {
  mogu: DEFAULT_STICKER_IDS,
  damong: DEFAULT_STICKER_IDS,
  mongle: MONGLE_STICKER_IDS,
} as const;

export type MessageTextValidation =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'invalid-type' };

export type StickerPack = (typeof STICKER_PACKS)[number];
export type DefaultStickerId = (typeof DEFAULT_STICKER_IDS)[number];
export type MongleStickerId = (typeof MONGLE_STICKER_IDS)[number];
export type StickerId = DefaultStickerId | MongleStickerId;

export function stickerAssetFolder(stickerPack: StickerPack): string {
  return stickerPack === 'damong' ? 'Damong' : stickerPack;
}

export function stickerAssetExtension(stickerPack: StickerPack): string {
  return stickerPack === 'mongle' ? 'png' : 'webp';
}

export function isValidStickerIdForPack(
  stickerPack: StickerPack,
  stickerId: string
): stickerId is StickerId {
  return (STICKER_IDS_BY_PACK[stickerPack] as readonly string[]).includes(stickerId);
}

export type MessageKindValidation =
  | { ok: true; kind: 'text'; originalText: string }
  | {
      ok: true;
      kind: 'sticker';
      stickerPack: StickerPack;
      stickerId: StickerId;
      stickerAsset: string;
      originalText: string;
    }
  | {
      ok: true;
      kind: 'image';
      imagePath: string;
      originalText: string;
    }
  | {
      ok: false;
      reason:
        | 'empty'
        | 'too-long'
        | 'invalid-type'
        | 'invalid-message-type'
        | 'invalid-sticker-pack'
        | 'invalid-sticker-id'
        | 'invalid-image-url'
        | 'invalid-image-path';
    };

export function validateMessageText(value: unknown): MessageTextValidation {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'invalid-type' };
  }

  const text = value.trim();
  if (text.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }

  return { ok: true, text };
}

export function validateMessageKind(
  data: any,
  expectedImageOwner?: { matchId: unknown; uid: string }
): MessageKindValidation {
  const rawMessageType = data?.messageType ?? 'text';
  if (typeof rawMessageType !== 'string') {
    return { ok: false, reason: 'invalid-message-type' };
  }

  const messageType = rawMessageType.trim().toLowerCase();
  if (
    messageType !== 'text' &&
    messageType !== 'sticker' &&
    messageType !== 'image'
  ) {
    return { ok: false, reason: 'invalid-message-type' };
  }

  if (messageType === 'text') {
    const textValidation = validateMessageText(data?.originalText);
    if (!textValidation.ok) return textValidation;
    return {
      ok: true,
      kind: 'text',
      originalText: textValidation.text,
    };
  }

  if (messageType === 'image') {
    const imagePath = String(data?.imagePath ?? '').trim();
    const parsedPath = parseMediaUploadObjectPath(imagePath);
    if (parsedPath == null || parsedPath.kind !== 'chat') {
      return { ok: false, reason: 'invalid-image-path' };
    }
    if (
      expectedImageOwner != null &&
      (typeof expectedImageOwner.matchId !== 'string' ||
        parsedPath.matchId !== expectedImageOwner.matchId ||
        parsedPath.uid !== expectedImageOwner.uid)
    ) {
      return { ok: false, reason: 'invalid-image-path' };
    }
    // Permanent Firebase download URLs are bearer credentials and are no
    // longer accepted from a new client write. Legacy message documents remain
    // readable by the Flutter compatibility renderer, but may not be replayed
    // into this callable.
    if (Object.prototype.hasOwnProperty.call(data, 'imageUrl')) {
      return { ok: false, reason: 'invalid-image-url' };
    }
    return {
      ok: true,
      kind: 'image',
      imagePath,
      originalText: '[image]',
    };
  }

  const stickerPack = String(data?.stickerPack ?? '').trim().toLowerCase();
  const stickerId = String(data?.stickerId ?? '').trim().toLowerCase();

  if (!STICKER_PACKS.includes(stickerPack as StickerPack)) {
    return { ok: false, reason: 'invalid-sticker-pack' };
  }

  if (!isValidStickerIdForPack(stickerPack as StickerPack, stickerId)) {
    return { ok: false, reason: 'invalid-sticker-id' };
  }

  const assetFolder = stickerAssetFolder(stickerPack as StickerPack);
  const assetExtension = stickerAssetExtension(stickerPack as StickerPack);

  return {
    ok: true,
    kind: 'sticker',
    stickerPack: stickerPack as StickerPack,
    stickerId: stickerId as StickerId,
    stickerAsset: `assets/stickers/${assetFolder}/${stickerId}.${assetExtension}`,
    originalText: `[sticker:${stickerPack}:${stickerId}]`,
  };
}
