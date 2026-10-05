import type { AdapterPayload } from 'oidc-provider';
import { SqliteStore } from '../../packages/node-sdk/src/storage.js';
import type { ClientRegistry } from './registry.js';

export function sqliteAdapter(store: SqliteStore, registry?: ClientRegistry) {
  return class OidcAdapter {
    constructor(private name: string) {}
    async upsert(id: string, payload: AdapterPayload, expiresIn: number) { store.put(this.name, id, payload, expiresIn); }
    async find(id: string) {
      if (this.name === 'Client' && registry) return registry.findEnabled(id) as unknown as AdapterPayload | undefined;
      return store.get<AdapterPayload>(this.name, id);
    }
    async findByUid(uid: string) { return store.findBy<AdapterPayload>(this.name, 'uid', uid); }
    async findByUserCode(code: string) { return store.findBy<AdapterPayload>(this.name, 'userCode', code); }
    async destroy(id: string) { store.delete(this.name, id); }
    async consume(id: string) { store.consume(this.name, id); }
    async revokeByGrantId(id: string) { store.revokeGrant(id); }
  };
}
