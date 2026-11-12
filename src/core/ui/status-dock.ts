/**
 * A small floating panel (bottom-right) where each feature can show one
 * status line with optional actions. Lives in a shadow root so GitHub's CSS
 * can't affect it and it doesn't depend on GitHub's DOM structure.
 */
export interface StatusAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface StatusLine {
  text: string;
  tone?: 'info' | 'error';
  actions?: StatusAction[];
}


const STYLE = `
  :host { all: initial; }
  .dock { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: flex;
    flex-direction: column; gap: 6px; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .line { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; border-radius: 8px;
    background: #1f2328; color: #f0f6fc; box-shadow: 0 4px 12px rgba(0,0,0,.25); max-width: 420px; }
  .line.error { background: #82071e; }
  .text { flex: 1; }
  button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,.12); }
  button:hover { background: rgba(255,255,255,.22); }
  button:disabled { opacity: .5; cursor: default; }
  .close { background: none; opacity: .6; padding: 2px 4px; }
`;

export class StatusDock {
  private host: HTMLElement | null = null;
  private dock: HTMLElement | null = null;
  private lines = new Map<string, HTMLElement>();

  private ensure(): HTMLElement {
    if (this.dock && this.host?.isConnected) return this.dock;
    this.host = document.createElement('pr-review-helper-dock');
    const root = this.host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div class="dock"></div>`;
    this.dock = root.querySelector('.dock')!;
    document.body.append(this.host);
    this.lines.clear();
    return this.dock;
  }

  set(id: string, line: StatusLine): void {
    const dock = this.ensure();
    let el = this.lines.get(id);
    if (!el) {
      el = document.createElement('div');
      dock.append(el);
      this.lines.set(id, el);
    }
    el.className = `line ${line.tone ?? 'info'}`;
    el.replaceChildren();
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = line.text;
    el.append(text);
    for (const action of line.actions ?? []) {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await action.onClick();
        } finally {
          btn.disabled = false;
        }
      });
      el.append(btn);
    }
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '✕';
    close.title = 'Dismiss';
    close.addEventListener('click', () => this.clear(id));
    el.append(close);
  }

  clear(id: string): void {
    this.lines.get(id)?.remove();
    this.lines.delete(id);
  }

  clearAll(): void {
    this.host?.remove();
    this.host = this.dock = null;
    this.lines.clear();
  }

  scope(id: string) {
    return { set: (line: StatusLine) => this.set(id, line), clear: () => this.clear(id) };
  }
}
