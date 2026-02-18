import React from 'react';
import ReactDOM from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { App } from './App';
import './styles.css';

/**
 * Application Entry Point
 * Renders the main App component into the DOM
 */
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find the root element');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <IntlProvider locale="en" messages={{}}>
      <App />
    </IntlProvider>
  </React.StrictMode>
);
