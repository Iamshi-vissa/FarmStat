import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// One family, Archivo, with its width axis: wide for headings, normal for text, condensed for the big numbers.
// One variable file (the browser downloads only the scripts a page uses; the ₹ sign comes from latin-ext).
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
