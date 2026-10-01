import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A screen that fails to draw shows a message with a way out instead of
 * blanking the whole app, and the error is sent to the server log. Keyed by
 * the path, so moving to another screen starts fresh.
 */
export class ScreenBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch('/api/client-error', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-kks': '1', 'content-type': 'application/json' },
      body: JSON.stringify({
        path: location.pathname.slice(0, 300),
        message: String(error?.message ?? error).slice(0, 500),
        stack: `${error?.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 2000),
      }),
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <Icon name="alert" />
        <div className="big">המסך לא נטען</div>
        <div className="small">אירעה תקלה בהצגת המסך. התקלה נרשמה. אפשר לנסות שוב או לחזור לדף הבית.</div>
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            נסה שוב
          </button>
          <a className="btn" href="/">
            לדף הבית
          </a>
        </div>
      </div>
    );
  }
}
