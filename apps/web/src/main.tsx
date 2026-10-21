import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { t } from './i18n';
import './style.css';
import './accessibility.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <main className="crash"><h1>{t('Let’s get you back in.')}</h1><p>{t('The screen ran into a problem. Your saved quizzes and private game credentials are still in this browser.')}</p><button className="btn white" onClick={() => location.reload()}>{t('Reload Tori')}</button></main> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
