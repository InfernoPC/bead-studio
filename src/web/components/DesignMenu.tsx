// 作品選單：工具列上的作品名稱就是按鈕；列出所有作品（目前作品打勾）與「建立新作品」
import type { DesignSummary, ToolResult } from '../lib/api';
import { Popover, usePopover } from './Popover';

type Props = {
  name: string | null; currentId: string | null; designs: DesignSummary[]; disabled: boolean;
  act(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  onNewDesign(): void;
};

export function DesignMenu({ name, currentId, designs, disabled, act, onNewDesign }: Props) {
  const pop = usePopover();
  return (
    <>
      <h1 className="design-name">
        <button
          ref={pop.trigger} type="button" className="design-btn" aria-haspopup="menu" aria-expanded={pop.open}
          aria-label={`作品：${name ?? '沒有開啟的作品'}`} disabled={disabled} onClick={pop.toggle}
        >
          {name ? <span data-testid="design-name" className="design-btn-text">{name}</span>
            : <span className="design-btn-text muted">沒有開啟的作品</span>}
          <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
      </h1>
      {pop.open && (
        <Popover kind="menu" label="作品" anchor={pop.trigger} onClose={pop.close} className="design-menu">
          {designs.length > 0 && (
            <div role="group" aria-label="所有作品" className="menu-group menu-scroll">
              {designs.map((d) => (
                <button
                  key={d.id} type="button" role="menuitemradio" aria-checked={d.id === currentId} className="menu-item" tabIndex={-1}
                  onClick={() => { pop.close(true); if (d.id !== currentId) void act('open_design', { id: d.id }); }}
                >
                  <svg className="menu-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
                  <span className="menu-item-text">{d.name}</span>
                </button>
              ))}
            </div>
          )}
          {designs.length > 0 && <div role="separator" className="menu-sep" />}
          <button
            type="button" role="menuitem" className="menu-item" tabIndex={-1}
            onClick={() => { pop.close(true); onNewDesign(); }}
          >
            <svg className="menu-check is-plain" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
            <span className="menu-item-text">建立新作品</span>
          </button>
        </Popover>
      )}
    </>
  );
}
