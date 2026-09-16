import '@fontsource/libre-franklin/300.css';
import '@fontsource/libre-franklin/400.css';
import '@fontsource/libre-franklin/700.css';
import '@fontsource/roboto-mono/400.css';
import '@fontsource/roboto-mono/500.css';
import './styles.css';

import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
