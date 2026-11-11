import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CHECKS, type ChecksConfig } from '../core/checks';
import { parseDesign } from '../core/designSchema';
import { OpError } from '../core/errors';
import { coreOf, createDesign, type Board, type Design, type DesignCore, type Snapshot } from '../core/model';
import { Palette, validatePalette, type Inventory, type PaletteColor } from '../core/palette';

export type StoreOpts = { dataDir: string; configDir: string; historyLimit?: number };

function writeJsonAtomic(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class DesignStore extends EventEmitter {
  palette!: Palette;
  inventory: Inventory = {};
  checks: ChecksConfig = DEFAULT_CHECKS;
  currentId: string | null = null;
  private designs = new Map<string, Design>();
  private history = new Map<string, { undo: DesignCore[]; redo: DesignCore[] }>();

  constructor(private opts: StoreOpts) { super(); }

  private get designDir() { return join(this.opts.dataDir, 'designs'); }
  private get statePath() { return join(this.opts.dataDir, 'state.json'); }

  load(): void {
    mkdirSync(this.designDir, { recursive: true });
    const colors: PaletteColor[] = JSON.parse(readFileSync(join(this.opts.dataDir, 'palette.json'), 'utf8'));
    const errs = validatePalette(colors);
    if (errs.length) throw new Error(`palette.json 有誤：\n${errs.join('\n')}`);
    this.palette = new Palette(colors);
    const invPath = join(this.opts.dataDir, 'inventory.json');
    this.inventory = existsSync(invPath) ? JSON.parse(readFileSync(invPath, 'utf8')) : {};
    const chkPath = join(this.opts.configDir, 'checks.json');
    this.checks = existsSync(chkPath) ? { ...DEFAULT_CHECKS, ...JSON.parse(readFileSync(chkPath, 'utf8')) } : DEFAULT_CHECKS;
    this.designs.clear();
    for (const f of readdirSync(this.designDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const d = parseDesign(JSON.parse(readFileSync(join(this.designDir, f), 'utf8')));
        if (!d) throw new Error('格式不符');
        this.designs.set(d.id, d);
      } catch (e) {
        console.warn(`略過無法讀取的設計檔 ${f}：${(e as Error).message}`);
      }
    }
    const state = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) : {};
    this.currentId = state.currentId && this.designs.has(state.currentId) ? state.currentId : null;
  }

  ctx() { return { palette: this.palette, inventory: this.inventory }; }

  list() {
    return [...this.designs.values()].map((d) => ({ id: d.id, name: d.name, version: d.version, current: d.id === this.currentId }));
  }

  get(id?: string): Design {
    const want = id ?? this.currentId;
    if (!want) throw new OpError('no_design', '沒有開啟中的作品，請先 new_design 或 open_design');
    const d = this.designs.get(want);
    if (!d) throw new OpError('no_design', `找不到作品 ${want}`);
    return d;
  }

  private save(d: Design) {
    this.designs.set(d.id, d);
    writeJsonAtomic(join(this.designDir, `${d.id}.json`), d);
  }

  private setCurrent(id: string) {
    this.currentId = id;
    writeJsonAtomic(this.statePath, { currentId: id });
  }

  open(id: string): Design {
    const d = this.get(id);
    this.setCurrent(id);
    this.emit('change', d);
    return d;
  }

  create(name: string, board: Board): Design {
    const d = createDesign({ id: newId('d'), name, board });
    this.save(d);
    this.setCurrent(d.id);
    this.emit('change', d);
    return d;
  }

  importDesign(src: Design): Design {
    const d: Design = { ...structuredClone(src), id: newId('d'), version: 0 };
    this.save(d);
    this.setCurrent(d.id);
    this.emit('change', d);
    return d;
  }

  private hist(id: string) {
    let h = this.history.get(id);
    if (!h) { h = { undo: [], redo: [] }; this.history.set(id, h); }
    return h;
  }

  private commit(prev: Design, next: Design): Design {
    const d: Design = { ...next, id: prev.id, version: prev.version + 1 };
    this.save(d);
    this.emit('change', d);
    return d;
  }

  update(id: string | undefined, fn: (d: Design) => Design): Design {
    const prev = this.get(id);
    const next = fn(prev);
    const h = this.hist(prev.id);
    h.undo.push(coreOf(prev));
    if (h.undo.length > (this.opts.historyLimit ?? 200)) h.undo.shift();
    h.redo = [];
    return this.commit(prev, next);
  }

  undo(id?: string): Design {
    const cur = this.get(id);
    const h = this.hist(cur.id);
    const core = h.undo.pop();
    if (!core) throw new OpError('no_history', '沒有可以復原的步驟');
    h.redo.push(coreOf(cur));
    return this.commit(cur, { ...core, snapshots: cur.snapshots });
  }

  redo(id?: string): Design {
    const cur = this.get(id);
    const h = this.hist(cur.id);
    const core = h.redo.pop();
    if (!core) throw new OpError('no_history', '沒有可以重做的步驟');
    h.undo.push(coreOf(cur));
    return this.commit(cur, { ...core, snapshots: cur.snapshots });
  }

  snapshot(id: string | undefined, name: string): Snapshot {
    const cur = this.get(id);
    const snap: Snapshot = { id: newId('s'), name, at: new Date().toISOString(), design: coreOf(cur) };
    this.save({ ...cur, snapshots: [...cur.snapshots, snap] });
    return snap;
  }

  restoreSnapshot(id: string | undefined, snapId: string): Design {
    const cur = this.get(id);
    const snap = cur.snapshots.find((s) => s.id === snapId);
    if (!snap) throw new OpError('no_snapshot', `找不到快照 ${snapId}`);
    return this.update(cur.id, (d) => ({ ...structuredClone(snap.design), snapshots: d.snapshots }));
  }

  setInventory(items: { code: string; owned?: boolean; count?: number }[]): Inventory {
    for (const it of items) if (!this.palette.has(it.code)) throw new OpError('unknown_color', `未知色號 ${it.code}`);
    const inv = structuredClone(this.inventory);
    for (const it of items) {
      const prev = inv[it.code] ?? { owned: false, count: 0 };
      inv[it.code] = { owned: it.owned ?? prev.owned, count: it.count ?? prev.count };
    }
    this.inventory = inv;
    writeJsonAtomic(join(this.opts.dataDir, 'inventory.json'), inv);
    return inv;
  }
}
