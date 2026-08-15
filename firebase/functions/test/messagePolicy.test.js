const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CHAT_MESSAGE_LENGTH,
  validateMessageKind,
  validateMessageText,
} = require('../lib/messagePolicy');

test('accepts and trims valid message text', () => {
  assert.deepEqual(validateMessageText('  안녕하세요  '), {
    ok: true,
    text: '안녕하세요',
  });
});

test('rejects empty message text', () => {
  assert.deepEqual(validateMessageText('   '), {
    ok: false,
    reason: 'empty',
  });
});

test('rejects non-string message text', () => {
  assert.deepEqual(validateMessageText(null), {
    ok: false,
    reason: 'invalid-type',
  });
});

test('rejects overlong message text', () => {
  assert.deepEqual(validateMessageText('a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1)), {
    ok: false,
    reason: 'too-long',
  });
});

test('accepts message text at the maximum length', () => {
  const text = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH);
  assert.deepEqual(validateMessageText(text), {
    ok: true,
    text,
  });
});

test('validates text message kind by default', () => {
  assert.deepEqual(validateMessageKind({ originalText: '  안녕  ' }), {
    ok: true,
    kind: 'text',
    originalText: '안녕',
  });
});

test('rejects unknown message kind', () => {
  assert.deepEqual(validateMessageKind({
    messageType: 'voice',
    originalText: 'hello',
  }), {
    ok: false,
    reason: 'invalid-message-type',
  });
});

test('validates image message kind', () => {
  assert.deepEqual(validateMessageKind({
    messageType: 'image',
    imagePath: 'chat_images/room/user/auth-1/image.jpg',
  }, {
    matchId: 'room',
    uid: 'user',
  }), {
    ok: true,
    kind: 'image',
    imagePath: 'chat_images/room/user/auth-1/image.jpg',
    originalText: '[image]',
  });
});

test('rejects every new bearer URL and image path ownership mismatch', () => {
  const expected = { matchId: 'room', uid: 'user' };
  assert.deepEqual(validateMessageKind({
    messageType: 'image',
    imageUrl: 'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/chat_images%2Froom%2Fuser%2Fauth-1%2Fimage.jpg?alt=media&token=secret',
    imagePath: 'chat_images/room/user/auth-1/image.jpg',
  }, expected), { ok: false, reason: 'invalid-image-url' });
  assert.deepEqual(validateMessageKind({
    messageType: 'image',
    imageUrl: '',
    imagePath: 'chat_images/room/user/auth-1/image.jpg',
  }, expected), { ok: false, reason: 'invalid-image-url' });
  assert.deepEqual(validateMessageKind({
    messageType: 'image',
    imagePath: 'chat_images/room/other/auth-1/image.jpg',
  }, expected), { ok: false, reason: 'invalid-image-path' });
  assert.deepEqual(validateMessageKind({
    messageType: 'image',
    imagePath: 'chat_images/other-room/user/auth-1/image.jpg',
  }, expected), { ok: false, reason: 'invalid-image-path' });
});

test('validates sticker message kind', () => {
  assert.deepEqual(validateMessageKind({
    messageType: 'sticker',
    stickerPack: 'mogu',
    stickerId: 'hello',
  }), {
    ok: true,
    kind: 'sticker',
    stickerPack: 'mogu',
    stickerId: 'hello',
    stickerAsset: 'assets/stickers/mogu/hello.webp',
    originalText: '[sticker:mogu:hello]',
  });

  assert.deepEqual(validateMessageKind({
    messageType: 'sticker',
    stickerPack: 'damong',
    stickerId: 'hello',
  }), {
    ok: true,
    kind: 'sticker',
    stickerPack: 'damong',
    stickerId: 'hello',
    stickerAsset: 'assets/stickers/Damong/hello.webp',
    originalText: '[sticker:damong:hello]',
  });

  assert.deepEqual(validateMessageKind({
    messageType: 'sticker',
    stickerPack: 'mongle',
    stickerId: 'nice_to_meet_you',
  }), {
    ok: true,
    kind: 'sticker',
    stickerPack: 'mongle',
    stickerId: 'nice_to_meet_you',
    stickerAsset: 'assets/stickers/mongle/nice_to_meet_you.png',
    originalText: '[sticker:mongle:nice_to_meet_you]',
  });
});

test('rejects unknown sticker packs and ids', () => {
  assert.deepEqual(validateMessageKind({
    messageType: 'sticker',
    stickerPack: 'unknown',
    stickerId: 'hello',
  }), {
    ok: false,
    reason: 'invalid-sticker-pack',
  });

  assert.deepEqual(validateMessageKind({
    messageType: 'sticker',
    stickerPack: 'damong',
    stickerId: 'hungry',
  }), {
    ok: false,
    reason: 'invalid-sticker-id',
  });
});
