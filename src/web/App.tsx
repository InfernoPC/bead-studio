import { useReducer } from 'react';
import { AppShell } from './components/AppShell';
import { initialEditor, reduceEditor } from './lib/editorState';
import { useServer } from './lib/useServer';

export function App() {
  const { state } = useServer();
  const [editor, dispatch] = useReducer(reduceEditor, initialEditor);
  return <AppShell conn={state.conn} snapshot={state.snapshot} editor={editor} dispatch={dispatch} />;
}
