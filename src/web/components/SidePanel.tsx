import type { ReactNode } from 'react';

/** 右側面板的四個區塊，依序：色票豆盒、用量、檢查器、3D 預覽；內容由 Task 9–11 填入 */
export type SideSlots = { palette: ReactNode; usage: ReactNode; checks: ReactNode; preview: ReactNode };

const SECTIONS: { key: keyof SideSlots; title: string }[] = [
  { key: 'palette', title: '色票' },
  { key: 'usage', title: '用量' },
  { key: 'checks', title: '檢查器' },
  { key: 'preview', title: '實體預覽' },
];

export function SidePanel(slots: SideSlots) {
  return (
    <aside className="side" aria-label="色票與作品資訊">
      {SECTIONS.map(({ key, title }) => (
        <section key={key} className="panel" aria-labelledby={`panel-${key}`}>
          <h2 id={`panel-${key}`} className="panel-title">{title}</h2>
          {slots[key]}
        </section>
      ))}
    </aside>
  );
}
