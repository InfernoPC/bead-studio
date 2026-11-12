import { useCallback, useEffect, useMemo, useState, type Dispatch } from 'react';
import type { StateSnapshot } from '../lib/api';
import type { EditorAction, EditorState, Tool } from '../lib/editorState';
import type { ConnState } from '../lib/serverState';
import { useBoardLook } from '../lib/boardLook';
import { displayDesign, makeCtx } from '../lib/clientCore';
import { ChecksPanel, useIssues } from './ChecksPanel';
import { BeadTray } from './BeadTray';
import { BoardDialog } from './BoardDialog';
import { DeductDialog } from './DeductDialog';
import { Editor } from './Editor';
import { ImportOverlay, type Notice } from './ImportOverlay';
import { LookToggle } from './LookToggle';
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
  /** 工具列下方提示條的內容（導入圖片、扣庫存、庫存頁沒存到的修改）；放在 App 層，離開庫存頁後也收得到 */
  notice: Notice | null; onNotice(n: Notice | null): void;
};

/** 版面：上方工具列／左側工具列＋舞台＋狀態列／右側面板（窄螢幕移到下方） */
export function AppShell({ conn, snapshot, editor, dispatch, notice: importNotice, onNotice: setImportNotice }: Props) {
  const design = snapshot?.current ?? null;
  const editable = conn === 'online';
  const setTool = useCallback((tool: Tool) => dispatch({ type: 'setTool', tool }), [dispatch]);
  const toggleMirror = useCallback(() => dispatch({ type: 'toggleMirror' }), [dispatch]);
  const note = (text: string) => <p className="panel-note">{text}</p>;
  // 燙前／燙後、有／無釘板：編輯區與實體預覽一起切換
  const [look, setLook] = useBoardLook();
  // 狀態列的提示（例如伺服器拒絕修改的原因）；換作品時清掉
  const [notice, setNotice] = useState<string | null>(null);
  const designId = design?.id;
  useEffect(() => setNotice(null), [designId]);
  // 換作品時，畫布上的檢查器標示就不再對得上，清掉
  useEffect(() => dispatch({ type: 'highlightCells', cells: null }), [designId, dispatch]);
  // 用量跟著畫面走：筆畫送出、伺服器還沒回應前也算進去
  const opCtx = useMemo(() => (snapshot ? makeCtx(snapshot) : undefined), [snapshot?.palette, snapshot?.inventory]);
  const shown = useMemo(() => displayDesign(design, editor.pending, opCtx), [design, editor.pending, opCtx]);
  const issues = useIssues(shown, snapshot?.palette, snapshot?.inventory, snapshot?.checks);
  // 建立新作品（作品選單、空狀態）與面板設定（狀態列的尺寸）對話框
  // 導入圖片的結果，顯示在工具列下方的提示條
  const closeImportNotice = useCallback(() => setImportNotice(null), [setImportNotice]);
  const [dialog, setDialog] = useState<'new' | 'board' | 'deduct' | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  // 離線時不能改，開著的對話框也一併關掉
  useEffect(() => { if (!editable) setDialog(null); }, [editable]);
  // 換作品（或作品不見了）時，開著的面板設定已經對不上，一併關掉；建立新作品的表單與目前作品無關，保留
  useEffect(() => setDialog((d) => (d === 'board' || d === 'deduct' ? null : d)), [designId]);
  // 用量面板底部：做完作品後扣庫存（先確認）。元素固定下來，用量面板的 memo 才不會每次重畫
  const deductButton = useMemo(() => (
    <button type="button" className="btn-quiet usage-deduct" disabled={!editable} onClick={() => setDialog('deduct')}>做完了，扣庫存</button>
  ), [editable]);

  return (
    <div className="shell">
      <TopBar design={design} designs={snapshot?.designs ?? []} history={snapshot?.history ?? null} editable={editable}
        conn={conn} mcpUrl={snapshot?.mcpUrl ?? null} notice={importNotice} onCloseNotice={closeImportNotice}
        onNewDesign={() => setDialog('new')}
      />
      <OfflineBanner conn={conn} />
      <div className="workspace">
        <ToolRail tool={editor.tool} mirror={editor.mirror} disabled={!editable} onTool={setTool} onToggleMirror={toggleMirror} />
        <div className="stage-column">
          <LookToggle look={look} onLook={setLook} />
          <main className={`stage${look.board ? '' : ' no-board'}`} aria-label="編輯區">
            {design && snapshot && (
              <Editor snapshot={snapshot} design={design} editor={editor} dispatch={dispatch} editable={editable} onNotice={setNotice} look={look} />
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
          liveMeta={{ checks: true }}
          meta={shown ? {
            usage: <span className="num">共 {usageTotal(shown.cells)} 顆</span>,
            checks: <span className={`num${issues.length ? ' is-short' : ''}`}>{issues.length ? `${issues.length} 個問題` : '沒有問題'}</span>,
          } : undefined}
          palette={snapshot
            ? <BeadTray palette={snapshot.palette} inventory={snapshot.inventory} color={editor.color} recent={editor.recent} dispatch={dispatch} />
            : note('正在載入色票…')}
          usage={shown && snapshot
            ? <UsagePanel cells={shown.cells} palette={snapshot.palette} inventory={snapshot.inventory}
                color={editor.color} highlightCode={editor.highlightCode} dispatch={dispatch} footer={deductButton} />
            : note('開啟作品後顯示用量。')}
          checks={design && snapshot
            ? <ChecksPanel issues={issues} palette={snapshot.palette} highlightCells={editor.highlightCells} dispatch={dispatch} />
            : note('開啟作品後自動檢查。')}
          // 預覽跟著伺服器上的作品走，不跟每一格筆畫預覽重畫，畫筆才保持順暢
          preview={design && snapshot
            ? <Preview3D design={design} palette={snapshot.palette} look={look} onLook={setLook} />
            : note('開啟作品後顯示 3D 預覽。')}
        />
      </div>
      <NewDesignDialog open={dialog === 'new'} onClose={closeDialog} />
      <ImportOverlay design={design} editable={editable} onNotice={setImportNotice} />
      {design && <BoardDialog open={dialog === 'board'} design={design} onClose={closeDialog} />}
      {design && snapshot && (
        <DeductDialog open={dialog === 'deduct'} design={design} palette={snapshot.palette} inventory={snapshot.inventory}
          onClose={closeDialog} onDone={setImportNotice} />
      )}
    </div>
  );
}
