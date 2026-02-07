import { SqlEditor, type SqlEditorProps } from './SqlEditor';

export type EnhancedSqlEditorProps = Omit<SqlEditorProps, 'enhanced'>;

export function EnhancedSqlEditor(props: EnhancedSqlEditorProps) {
  return <SqlEditor {...props} enhanced />;
}
