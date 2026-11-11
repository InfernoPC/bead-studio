import { useCallback, type Dispatch } from 'react';
import type { StateSnapshot } from '../lib/api';
import type { EditorAction, EditorState, Tool } from '../lib/editorState';
import type { ConnState } from '../lib/serverState';
import { OfflineBanner } from './OfflineBanner';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { ToolRail } from './ToolRail';
import { TopBar } from './TopBar';

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

  return (
    <div className="shell">
      <TopBar designName={design?.name ?? null} />
      <OfflineBanner conn={conn} />
      <div className="workspace">
        <ToolRail tool={editor.tool} mirror={editor.mirror} disabled={!editable} onTool={setTool} onToggleMirror={toggleMirror} />
        <div className="stage-column">
          <main className="stage" aria-label="編輯區">
            {!design && snapshot && (
              <div className="empty-state">
                <p>還沒有作品。建立一個新作品，或把圖片拖進來。</p>
                {/* 行為在 Task 12 加入 */}
                <button type="button" className="btn-primary" disabled={!editable}>建立新作品</button>
              </div>
            )}
          </main>
          <StatusBar
            board={design?.board ?? null} cols={design?.cols ?? 0} rows={design?.rows ?? 0} zoom={editor.zoom}
            disabled={!editable} onZoom={(factor) => dispatch({ type: 'zoom', factor })}
          />
        </div>
        <SidePanel
          palette={note(snapshot ? `共 ${snapshot.palette.length} 種顏色` : '正在載入色票…')}
          usage={note(design ? '用量會在這裡統計。' : '開啟作品後顯示用量。')}
          checks={note(design ? '檢查結果會在這裡列出。' : '開啟作品後自動檢查。')}
          preview={note(design ? '3D 預覽會在這裡顯示。' : '開啟作品後顯示 3D 預覽。')}
        />
      </div>
    </div>
  );
}
