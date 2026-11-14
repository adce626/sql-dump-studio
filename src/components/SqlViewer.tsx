import { useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';

interface SqlViewerProps {
  code: string;
  className?: string;
  maxHeight?: string;
}

export function SqlViewer({ code, className, maxHeight }: SqlViewerProps) {
  const html = useMemo(() => {
    try {
      return Prism.highlight(code, Prism.languages.sql, 'sql');
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }
  }, [code]);

  return (
    <pre
      dir="ltr"
      className={['sql-code overflow-auto p-4 text-start', className ?? ''].join(' ')}
      style={maxHeight ? { maxHeight } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
