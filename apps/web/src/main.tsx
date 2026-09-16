import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { healthSchema, versionSchema } from '@quadrant/protocol';
import styles from './App.module.css';

function App() {
  const [status, setStatus] = useState('Checking service…');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    setStatus('Checking service…');
    async function check() {
      try {
        const [health, version] = await Promise.all([
          fetch('/health/ready', { signal: controller.signal }),
          fetch('/api/version', { signal: controller.signal }),
        ]);
        if (!health.ok || !version.ok) throw new Error('Unavailable');
        const parsedHealth = healthSchema.parse(await health.json());
        versionSchema.parse(await version.json());
        if (parsedHealth.status !== 'ok') throw new Error('Unavailable');
        if (active) setStatus('Service connected');
      } catch {
        if (active) setStatus('Service unavailable. Please try again.');
      } finally {
        clearTimeout(timeout);
      }
    }
    void check();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  return (
    <main className={styles.shell}>
      <div className={styles.emblem} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className={styles.eyebrow}>Four quadrants. One shared battlefield.</p>
      <h1>Quadrant Towers</h1>
      <p className={styles.description}>
        Build your towers. Explore the unknown. Outlast your rivals.
      </p>
      <section className={styles.status} aria-label="Service connection">
        <p role="status">{status}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Check connection
        </button>
      </section>
      <p className={styles.note}>
        The foundation is ready. Multiplayer gameplay is coming next.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
