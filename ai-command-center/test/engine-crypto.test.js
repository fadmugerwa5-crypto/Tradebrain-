'use strict';
const { test } = require('node:test'), assert = require('node:assert');
const mine = require('../mobile/engine/shim-crypto.js'), real = require('crypto');
test('shim crypto matches Node crypto (sha256, hmac, aes-256-gcm)', () => {
  for (const len of [0, 1, 15, 16, 17, 31, 32, 100, 1000]) {
    const key = real.randomBytes(32), iv = real.randomBytes(12), pt = real.randomBytes(len);
    const c = real.createCipheriv('aes-256-gcm', key, iv), ct = Buffer.concat([c.update(pt), c.final()]), tag = c.getAuthTag();
    const m = mine.createCipheriv('aes-256-gcm', key, iv), mct = Buffer.concat([Buffer.from(m.update(pt)), Buffer.from(m.final())]);
    assert.ok(ct.equals(mct) && tag.equals(Buffer.from(m.getAuthTag())), 'encrypt mismatch ' + len);
    const d = mine.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag); d.update(ct);
    assert.ok(Buffer.from(d.final()).equals(pt), 'decrypt mismatch ' + len);
    assert.equal(mine.createHash('sha256').update(pt).digest('hex'), real.createHash('sha256').update(pt).digest('hex'));
    const k2 = real.randomBytes((len % 70) + 1);
    assert.equal(mine.createHmac('sha256', k2).update(pt).digest('hex'), real.createHmac('sha256', k2).update(pt).digest('hex'));
  }
});
test('shim rejects tampered ciphertext', () => {
  const key = real.randomBytes(32), iv = real.randomBytes(12), c = real.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update('secret'), c.final()]); ct[0] ^= 1;
  const d = mine.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(c.getAuthTag()); d.update(ct);
  assert.throws(() => d.final());
});
