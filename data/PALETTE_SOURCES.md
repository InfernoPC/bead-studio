# MARD palette sources

Retrieved 2026-11-11. Hex values are on-screen approximations; real beads vary.

Sources (GitHub repos, cross-checked):
1. https://github.com/Apollohzl/PinDou_Apollo (src/lib/palettes/mard.ts) - 221 colors with codes, Chinese series-style names, hex. Used as primary (names + hex).
2. https://github.com/Maons666/Maons_Beading (src/palettes-mard.js) - 291 colors, code + hex; cites https://www.pixel-beads.com/zh/mard-bead-color-chart (2026-08).
3. https://github.com/LunarXuan/Pindo (lib/data/palettes/mard.json) - 291 colors, code + hex (codes zero-padded, e.g. A01).

Cross-check: all 221 hex values in source 1 are identical in sources 2 and 3. Sources 2 and 3 differ only on R11 (#FFEBFA vs #FFEBFB; not in this palette).

Scope: palette.json contains the 221-color standard set (series A-H, M) with source names (series name + number, converted to Traditional Chinese, e.g. 黃橙1) plus T1 (transparent; code from source 3, hex replaced by #DDEBEE). The extra series P, Q, R, Y, ZG (70 colors in sources 2/3) are not included because no names are available; they can be added later.

Needs calibration (待校正): none flagged by source disagreement. Note T1 is transparent so its hex is only a display placeholder; sources 1/2 treat pure white as H2.

Transparent bead T1: sources give #FFFFFF, which is indistinguishable from white (H1/H2, deltaE00 < 1). T1 uses #DDEBEE, a light cyan-grey display colour, not a real colour. Automatic color matching skips transparent entries (enforced in later tasks).
