import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { projectRoot } from '../core/config.js';

test('all brand references use the supplied anchor-and-key emblem with cache invalidation', () => {
  const logo = readFileSync(resolve(projectRoot, 'frontend/shared/logo-ancora.png'));
  assert.equal(createHash('sha256').update(logo).digest('hex'), 'ac594dec1ba065791d0334370b472cebe0cfd8a5614ddda577408b8d581291c3');
  for (const path of ['hosted-login/index.html', 'hosted-login/message.html', 'portal/home.html', 'portal/index.html']) {
    const html = readFileSync(resolve(projectRoot, 'frontend', path), 'utf8');
    const references = [...html.matchAll(/(?:src|href)="([^" ]*logo[^" ]*)"/g)].map(match => match[1]);
    assert.ok(references.length > 0, path);
    assert.ok(references.every(value => value === '/assets/logo-ancora.png?v=ac594dec1ba0'), path);
    assert.ok(html.includes('/assets/main.css?v=ac594dec1ba0'), path);
  }
});
