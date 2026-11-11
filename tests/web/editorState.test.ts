import { describe, it, expect } from 'vitest';
import { reduceEditor, initialEditor } from '../../src/web/lib/editorState';
import { displayDesign, previewOps } from '../../src/web/lib/clientCore';
import { smallDesign, ctxAll } from '../fixtures';

describe('editor reducer', () => {
  it('keeps the 8 most recent distinct colors, newest first', () => {
    let s = initialEditor;
    for (const c of ['A1', 'B1', 'A1', 'C1', 'H1', 'H2', 'H3', 'A2', 'A3', 'A4']) s = reduceEditor(s, { type: 'pickColor', code: c });
    expect(s.recent).toEqual(['A4', 'A3', 'A2', 'H3', 'H2', 'H1', 'C1', 'A1']);
    expect(s.color).toBe('A4');
  });
  it('clamps zoom', () => {
    expect(reduceEditor(initialEditor, { type: 'zoom', factor: 100 }).zoom).toBe(8);
    expect(reduceEditor(initialEditor, { type: 'zoom', factor: 0.001 }).zoom).toBe(0.25);
  });
  it('handles tool, mirror, highlight and preview actions', () => {
    let s = reduceEditor(initialEditor, { type: 'setTool', tool: 'fill' });
    expect(s.tool).toBe('fill');
    s = reduceEditor(s, { type: 'toggleMirror' });
    expect(s.mirror).toBe(true);
    s = reduceEditor(s, { type: 'highlightCode', code: 'A1' });
    expect(s.highlightCode).toBe('A1');
    s = reduceEditor(s, { type: 'highlightCells', cells: [[1, 2]] });
    expect(s.highlightCells).toEqual([[1, 2]]);
    expect(s.highlightCode).toBeNull(); // 兩種高亮互斥
    s = reduceEditor(s, { type: 'highlightCode', code: 'B2' });
    expect(s.highlightCells).toBeNull();
    const pending = { baseVersion: 1, design: smallDesign() };
    s = reduceEditor(s, { type: 'preview', pending });
    expect(s.pending).toBe(pending);
    expect(reduceEditor(s, { type: 'clearPreview' }).pending).toBeNull();
  });
});

describe('optimistic preview', () => {
  it('shows pending until the server catches up', () => {
    const server = { ...smallDesign(), version: 5 };
    const pending = { baseVersion: 5, design: { ...server, name: 'preview' } };
    expect(displayDesign(server, pending)!.name).toBe('preview');
    expect(displayDesign({ ...server, version: 6 }, pending)!.name).toBe(server.name);
  });
  it('re-applies the stroke onto a newer server version (an AI edit) instead of dropping it', () => {
    const base = { ...smallDesign(), version: 5 };
    const ops = [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }];
    const pending = { baseVersion: 5, design: previewOps(base, ops, ctxAll) as typeof base, ops, variant: base.activeVariant };
    const ai = previewOps({ ...base, version: 6 }, [{ op: 'rect', x: 1, y: 1, w: 1, h: 1, color: 'H2' }], ctxAll) as typeof base;
    const shown = displayDesign({ ...ai, version: 6 }, pending, ctxAll)!;
    const cells = shown.variants.find((v) => v.id === shown.activeVariant)!.cells;
    expect(cells[0]).toBe('A1'); // 自己的這一筆還在
    expect(cells[1 * shown.cols + 1]).toBe('H2'); // AI 的修改也在
  });
  it('shows the server design once it reaches the committed version', () => {
    const base = { ...smallDesign(), version: 5 };
    const ops = [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'A1' }];
    const pending = { baseVersion: 5, design: previewOps(base, ops, ctxAll) as typeof base, ops, variant: base.activeVariant, commitVersion: 7 };
    const server7 = { ...base, version: 7, name: 'server' };
    expect(displayDesign(server7, pending, ctxAll)!.name).toBe('server');
    expect(displayDesign({ ...base, version: 6, name: 'ai' }, pending, ctxAll)!.variants[0].cells[0]).toBe('A1');
  });
  it('previewOps returns an Error instead of throwing', () => {
    expect(previewOps(smallDesign(), [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'NOPE' }], ctxAll)).toBeInstanceOf(Error);
  });
});
