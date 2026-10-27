import { createHmac, createHash, randomBytes } from 'node:crypto';
import { makeRng } from '../../shared/fair.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newServerSeed = () => randomBytes(32).toString('hex');
export const newClientSeed = () => randomBytes(8).toString('hex');

export function rngFor(serverSeed, clientSeed, nonce) {
  return makeRng((r) => createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${r}`).digest());
}
