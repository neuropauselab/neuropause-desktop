import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { ThemeProvider } from '@renderer/providers/ThemeProvider';
import { AuthProvider } from '@renderer/providers/AuthProvider';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { TRANSITION } from '@renderer/lib/motion';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary name="app">
      {/*
        Motion policy, set once for the whole renderer.

        `reducedMotion="user"` makes framer-motion read the OS setting and drop
        transform/layout animation for users who asked for that, while keeping
        opacity — so the interface still communicates state change without
        moving. Setting it here rather than per-component means a new animated
        surface inherits the right behaviour instead of having to remember it;
        accessibility that depends on every future author opting in is
        accessibility that decays.

        The default transition matches the token scale, so a `motion.*` element
        with no explicit transition still moves like the rest of the app.
      */}
      <MotionConfig reducedMotion="user" transition={TRANSITION.quick}>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
