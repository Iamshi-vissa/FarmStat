import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Two families: Bricolage Grotesque (weight and width axes) for headings, reading and the interface, and Big Shoulders,
// a condensed signage face, for the big figures on the rate boards. The browser downloads only the scripts a page uses;
// the ₹ sign comes from each family's latin-ext file.
import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource-variable/big-shoulders/wght.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
