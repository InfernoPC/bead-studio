import { useCallback, useEffect, useState, type Dispatch } from 'react';
import type { StateSnapshot } from '../lib/api';
import type { EditorAction, EditorState, Tool } from '../lib/editorState';
import type { ConnState } from '../lib/serverState';
import { getVariant } from '../../core/model';
import { displayDesign } from '../lib/clientCore';
import { ChecksPanel, useIssues } from './ChecksPanel';
import { BeadTray } from './BeadTray';
import { BoardDialog } from './BoardDialog';
import { Editor } from './Editor';
import { NewDesignDialog } from './NewDesignDialog';
import { OfflineBanner } from './OfflineBanner';
import { Preview3D } from './Preview3D';
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
  // 換作品或換配色版本時，畫布上的檢查器標示就不再對得上，清掉
  const variantId = design?.activeVariant;
  useEffect(() => dispatch({ type: 'highlightCells', cells: null }), [designId, variantId, dispatch]);
  // 用量跟著畫面走：筆畫送出、伺服器還沒回應前也算進去
  const shown = displayDesign(design, editor.pending);
  const variant = shown ? getVariant(shown) : null;
  const issues = useIssues(shown, snapshot?.palette, snapshot?.inventory, snapshot?.checks);
  // 建立新作品（作品選單、空狀態）與面板設定（狀態列的尺寸）對話框
  const [dialog, setDialog] = useState<'new' | 'board' | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  // 離線時不能改，開著的對話框也一併關掉
  useEffect(() => { if (!editable) setDialog(null); }, [editable]);
  // 換作品（或作品不見了）時，開著的面板設定已經對不上，一併關掉；建立新作品的表單與目前作品無關，保留
  useEffect(() => setDialog((d) => (d === 'board' ? null : d)), [designId]);

  return (
    <div className="shell">
      <TopBar design={design} designs={snapshot?.designs ?? []} history={snapshot?.history ?? null} editable={editable} onNewDesign={() => setDialog('new')} />
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
                <button type="button" className="btn-primary" disabled={!editable} onClick={() => setDialog('new')}>建立新作品</button>
              </div>
            )}
          </main>
          <StatusBar
            board={design?.board ?? null} cols={design?.cols ?? 0} rows={design?.rows ?? 0} zoom={editor.zoom} notice={notice}
            disabled={!editable} onZoom={(factor) => dispatch({ type: 'zoom', factor })} onBoardSettings={() => setDialog('board')}
          />
        </div>
        <SidePanel
          titles={variant ? { usage: `用量（${variant.name}）` } : undefined}
          liveMeta={{ checks: true }}
          meta={variant ? {
            usage: <span className="num">共 {usageTotal(variant.cells)} 顆</span>,
            checks: <span className={`num${issues.length ? ' is-short' : ''}`}>{issues.length ? `${issues.length} 個問題` : '沒有問題'}</span>,
          } : undefined}
          palette={snapshot
            ? <BeadTray palette={snapshot.palette} inventory={snapshot.inventory} color={editor.color} recent={editor.recent} dispatch={dispatch} />
            : note('正在載入色票…')}
          usage={variant && snapshot
            ? <UsagePanel cells={variant.cells} palette={snapshot.palette} inventory={snapshot.inventory}
                color={editor.color} highlightCode={editor.highlightCode} dispatch={dispatch} />
            : note('開啟作品後顯示用量。')}
          checks={design && snapshot
            ? <ChecksPanel issues={issues} palette={snapshot.palette} highlightCells={editor.highlightCells} dispatch={dispatch} />
            : note('開啟作品後自動檢查。')}
          // 預覽跟著伺服器上的作品走，不跟每一格筆畫預覽重畫，畫筆才保持順暢
          preview={design && snapshot
            ? <Preview3D design={design} palette={snapshot.palette} />
            : note('開啟作品後顯示 3D 預覽。')}
        />
      </div>
      <NewDesignDialog open={dialog === 'new'} onClose={closeDialog} />
      {design && <BoardDialog open={dialog === 'board'} design={design} onClose={closeDialog} />}
    </div>
  );
}
