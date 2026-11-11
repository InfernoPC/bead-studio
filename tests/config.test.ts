import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/server/config';

describe('parseEnv', () => {
  it('uses defaults', () => {
    expect(parseEnv({})).toEqual({ port: 5174, host: '127.0.0.1', vision: 'auto', allowedHosts: [], dataDir: 'data', configDir: 'config', filesDir: undefined, homeDir: undefined });
  });
  it('reads valid values', () => {
    const c = parseEnv({
      PORT: '8080', BEADS_HOST: '0.0.0.0', BEADS_VISION: 'off', BEADS_ALLOWED_HOSTS: 'a.lan:8080, b:1 ,', BEADS_DATA_DIR: 'd', BEADS_CONFIG_DIR: 'c',
      BEADS_FILES_DIR: '/Users/x/BeadStudio', BEADS_HOME_DIR: '/Users/x',
    });
    expect(c).toEqual({
      port: 8080, host: '0.0.0.0', vision: 'off', allowedHosts: ['a.lan:8080', 'b:1'], dataDir: 'd', configDir: 'c',
      filesDir: '/Users/x/BeadStudio', homeDir: '/Users/x',
    });
  });
  it.each(['0', '65536', 'abc', '80.5', ''])('rejects PORT=%j', (PORT) => {
    expect(() => parseEnv({ PORT })).toThrow(/PORT/);
  });
  it('requires absolute BEADS_FILES_DIR / BEADS_HOME_DIR', () => {
    expect(() => parseEnv({ BEADS_FILES_DIR: 'rel/dir' })).toThrow(/BEADS_FILES_DIR/);
    expect(() => parseEnv({ BEADS_HOME_DIR: 'rel' })).toThrow(/BEADS_HOME_DIR/);
  });
  it('rejects unknown BEADS_VISION', () => {
    expect(() => parseEnv({ BEADS_VISION: 'yes' })).toThrow(/BEADS_VISION/);
  });
});
