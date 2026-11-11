import { useCallback, useEffect, useState, type Dispatch } from 'react';
import type { StateSnapshot } from '../lib/api';
import type { EditorAction, EditorState, Tool } from '../lib/editorState';
import type { ConnState } from '../lib/serverState';
import { getVariant } from '../../core/model';
import { displayDesign } from '../lib/clientCore';
import { BeadTray } from './BeadTray';
import { Editor } from './Editor';
import { OfflineBanner } from './OfflineBanner';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { ToolRail } from './ToolRail';
import { TopBar } from './TopBar';
import { UsagePanel, usageTotal } from './UsagePanel';

type Props = {
  conn: ConnState; snapshot: StateSnapshot | null;
  editor: EditorState; dispatch: Dispatch<EditorAction>;
};

/** 版面：上方工具列／左側工具列＋舞台＋狀態列／右側面板（窄螢幕移到下方） */
export function AppShell({ conn, snapshot, editor, dispatch }: Props) {
  const design = snapshot?.current ?? null;
  const editable = conn === 'online';
  const setTool = useCallback((tool: Tool) => dispatch({ type: 'setTool', tool }), [dispatch]);
  const toggleMirror = useCallback(() => dispatch({ type: 'toggleMirror' }), [dispatch]);
  const note = (text: string) => <p className="panel-note">{text}</p>;
  // 狀態列的提示（例如伺服器拒絕修改的原因）；換作品時清掉
  const [notice, setNotice] = useState<string | null>(null);
  const designId = design?.id;
  useEffect(() => setNotice(null), [designId]);
  // 用量跟著畫面走：筆畫送出、伺服器還沒回應前也算進去
  const shown = displayDesign(design, editor.pending);
  const variant = shown ? getVariant(shown) : null;

  return (
    <div className="shell">
      <TopBar designName={design?.name ?? null} />
      <OfflineBanner conn={conn} />
      <div className="workspace">
        <ToolRail tool={editor.tool} mirror={editor.mirror} disabled={!editable} onTool={setTool} onToggleMirror={toggleMirror} />
        <div className="stage-column">
          <main className="stage" aria-label="編輯區">
            {design && snapshot && (
              <Editor snapshot={snapshot} design={design} editor={editor} dispatch={dispatch} editable={editable} onNotice={setNotice} />
            )}
            {!design && snapshot && (
              <div className="empty-state">
                <p>還沒有作品。建立一個新作品，或把圖片拖進來。</p>
                {/* 行為在 Task 12 加入 */}
                <button type="button" className="btn-primary" disabled={!editable}>建立新作品</button>
              </div>
            )}
          </main>
          <StatusBar
            board={design?.board ?? null} cols={design?.cols ?? 0} rows={design?.rows ?? 0} zoom={editor.zoom} notice={notice}
            disabled={!editable} onZoom={(factor) => dispatch({ type: 'zoom', factor })}
          />
        </div>
        <SidePanel
          titles={variant ? { usage: `用量（${variant.name}）` } : undefined}
          meta={variant ? { usage: <span className="num">共 {usageTotal(variant.cells)} 顆</span> } : undefined}
          palette={snapshot
            ? <BeadTray palette={snapshot.palette} inventory={snapshot.inventory} color={editor.color} recent={editor.recent} dispatch={dispatch} />
            : note('正在載入色票…')}
          usage={variant && snapshot
            ? <UsagePanel cells={variant.cells} palette={snapshot.palette} inventory={snapshot.inventory}
                color={editor.color} highlightCode={editor.highlightCode} dispatch={dispatch} />
            : note('開啟作品後顯示用量。')}
          checks={note(design ? '檢查結果會在這裡列出。' : '開啟作品後自動檢查。')}
          preview={note(design ? '3D 預覽會在這裡顯示。' : '開啟作品後顯示 3D 預覽。')}
        />
      </div>
    </div>
  );
}
