import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = '.claude/skills/bead-design';
const TOOLS = ['get_design', 'describe_design', 'render_preview', 'get_palette', 'run_checks', 'apply_ops',
  'snapshot', 'set_board', 'import_image'];

describe('bead-design skill', () => {
  const skill = readFileSync(`${ROOT}/SKILL.md`, 'utf8');
  it('has frontmatter with name and description', () => {
    expect(skill).toMatch(/^---\nname: bead-design\ndescription: .+\n---/);
  });
  it('references the MCP tools it relies on', () => {
    for (const t of TOOLS) expect(skill).toContain(t);
  });
  it('does not mention removed variant tools', () => {
    for (const t of ['create_variant', 'set_variant_mode', 'select_variant', 'set_shape_lock']) expect(skill).not.toContain(t);
  });
  it('asks the two inventory questions before designing', () => {
    expect(skill).toMatch(/只用有的顏色/);
    expect(skill).toMatch(/只用有的數量/);
  });
  it('links knowledge files that exist', () => {
    for (const f of ['color', 'shading', 'outline', 'structure', 'scale']) {
      expect(skill).toContain(`knowledge/${f}.md`);
      expect(existsSync(`${ROOT}/knowledge/${f}.md`)).toBe(true);
    }
    expect(existsSync(`${ROOT}/CHANGELOG.md`)).toBe(true);
  });
  it('recipes use paste-compatible rows', () => {
    for (const r of ['eyes', 'cheeks', 'sparkle']) {
      const md = readFileSync(`${ROOT}/recipes/${r}.md`, 'utf8');
      expect(md).toMatch(/"op": "paste"/);
    }
  });
});
