import { createHashRouter } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { HomePage } from './pages/HomePage';
import { TablesPage } from './pages/TablesPage';
import { TablePage } from './pages/TablePage';
import { SearchPage } from './pages/SearchPage';
import { RelationsPage } from './pages/RelationsPage';
import { EditorPage } from './pages/EditorPage';
import { ComparePage } from './pages/ComparePage';
import { StatsPage } from './pages/StatsPage';

export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'tables', element: <TablesPage /> },
      { path: 'tables/:tableId', element: <TablePage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'relations', element: <RelationsPage /> },
      { path: 'editor', element: <EditorPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: '*', element: <HomePage /> },
    ],
  },
]);
