import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalUsers } from '../core/apps/demo/users.js';
const identity = { issuer: 'http://localhost:4400', sub: 'eip155:1:0x' + 'a'.repeat(40), address: '0x' + 'a'.repeat(40), chainId: 1 };
test('local user linkage is idempotent, scoped by issuer and persists on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ancora-users-')); const file = join(directory, 'users.sqlite');
  let users = new LocalUsers(file);
  try {
    const first = users.findOrCreate(identity); assert.equal(users.findOrCreate(identity).id, first.id);
    assert.notEqual(users.findOrCreate({ ...identity, issuer: 'https://other.example' }).id, first.id);
    users.close(); users = new LocalUsers(file); assert.equal(users.findOrCreate(identity).id, first.id);
  } finally { users.close(); rmSync(directory, { recursive: true, force: true }); }
});
