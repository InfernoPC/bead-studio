import type { ReactNode } from 'react';

/** 右側面板的四個區塊，依序：色票豆盒、用量、檢查器、3D 預覽；內容由 Task 9–11 填入 */
export type SideSlots = { palette: ReactNode; usage: ReactNode; checks: ReactNode; preview: ReactNode };
type Key = keyof SideSlots;
/** 標題可以覆寫（例如「用量（理想版）」），meta 是標題列右側的小字（例如「共 312 顆」） */
type Props = SideSlots & { titles?: Partial<Record<Key, string>>; meta?: Partial<Record<Key, ReactNode>>;
  /** 哪些標題旁的字要讓螢幕閱讀器播報（只給低頻變動的，例如檢查器的問題數） */
  liveMeta?: Partial<Record<Key, boolean>>;
};

const SECTIONS: { key: Key; title: string }[] = [
  { key: 'palette', title: '色票' },
  { key: 'usage', title: '用量' },
  { key: 'checks', title: '檢查器' },
  { key: 'preview', title: '實體預覽' },
];

export function SidePanel({ titles, meta, liveMeta, ...slots }: Props) {
  return (
    <aside className="side" aria-label="色票與作品資訊">
      {SECTIONS.map(({ key, title }) => (
        <section key={key} className="panel" aria-labelledby={`panel-${key}`}>
          <div className="panel-head">
            <h2 id={`panel-${key}`} className="panel-title">{titles?.[key] ?? title}</h2>
            {meta?.[key] && <span className="panel-meta" aria-live={liveMeta?.[key] ? 'polite' : undefined}>{meta[key]}</span>}
          </div>
          {slots[key]}
        </section>
      ))}
    </aside>
  );
}
