import React from 'react';
import { createRoot } from 'react-dom/client';
import './theme';
import { App } from './App';
import './styles.css';

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
