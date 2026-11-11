import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/server/config';

describe('parseEnv', () => {
  it('uses defaults', () => {
    expect(parseEnv({})).toEqual({ port: 5174, vision: 'auto', allowedHosts: [], dataDir: 'data', configDir: 'config' });
  });
  it('reads valid values', () => {
    const c = parseEnv({ PORT: '8080', BEADS_VISION: 'off', BEADS_ALLOWED_HOSTS: 'a.lan:8080, b:1 ,', BEADS_DATA_DIR: 'd', BEADS_CONFIG_DIR: 'c' });
    expect(c).toEqual({ port: 8080, vision: 'off', allowedHosts: ['a.lan:8080', 'b:1'], dataDir: 'd', configDir: 'c' });
  });
  it.each(['0', '65536', 'abc', '80.5', ''])('rejects PORT=%j', (PORT) => {
    expect(() => parseEnv({ PORT })).toThrow(/PORT/);
  });
  it('rejects unknown BEADS_VISION', () => {
    expect(() => parseEnv({ BEADS_VISION: 'yes' })).toThrow(/BEADS_VISION/);
  });
});
