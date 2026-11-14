import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme/ThemeProvider';
import { DataProvider } from './store/DataProvider';
import { router } from './router';

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <DataProvider>
          <RouterProvider router={router} />
        </DataProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
