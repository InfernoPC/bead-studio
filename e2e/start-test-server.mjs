// e2e 用的伺服器：每次啟動都用全新的暫存資料夾，不碰 data/ 與 config/
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'bead-e2e-'));
const dataDir = join(tmp, 'data');
const configDir = join(tmp, 'config');
mkdirSync(dataDir, { recursive: true });
mkdirSync(configDir, { recursive: true });
copyFileSync('data/palette.json', join(dataDir, 'palette.json'));

const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '5175', BEADS_DATA_DIR: dataDir, BEADS_CONFIG_DIR: configDir },
});

const cleanup = () => rmSync(tmp, { recursive: true, force: true });
child.on('exit', (code) => { cleanup(); process.exit(code ?? 0); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
