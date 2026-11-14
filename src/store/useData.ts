import { useContext } from 'react';
import { DataContext, type DataValue } from './dataContext';

export function useData(): DataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}
