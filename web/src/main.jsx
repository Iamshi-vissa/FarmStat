import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// One typeface per job (variable, weight axis only; the browser downloads only the scripts it needs)
import '@fontsource-variable/archivo';                 // interface
import '@fontsource-variable/bricolage-grotesque';     // headlines
import '@fontsource-variable/big-shoulders-display';   // big numbers, rate board
import '@fontsource-variable/newsreader';              // paper slip and long reading
import rupeeFont from '@fontsource-variable/archivo/files/archivo-latin-ext-wght-normal.woff2?url';
import './styles.css';
import App from './App.jsx';

// The ₹ sign always comes from Archivo (the signage face for big numbers draws it in a stylised way).
// Same file Archivo already uses, so it costs no extra download.
if ('FontFace' in window) {
  document.fonts.add(new FontFace('FS Rupee', `url(${rupeeFont}) format('woff2')`, { unicodeRange: 'U+20B9', weight: '100 900' }));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
