import type { EventListener, JobEvent } from '../../api/types';
import { ensure, snapshot } from '../validation';

export class JobsEvents {
  private readonly listeners = new Set<EventListener>();
  constructor(private readonly onError: (error: unknown) => void) {}
  subscribe(listener: EventListener): () => void {
    ensure(typeof listener === 'function' && this.listeners.size < 1024, 'Invalid/excessive event subscription');
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  emit(event: JobEvent): void {
    const copy = snapshot(event);
    for (const listener of [...this.listeners]) {
      try { const result: unknown = listener(copy); if (result && typeof (result as Promise<unknown>).then === 'function') void Promise.resolve(result).catch(this.onError); }
      catch (error) { this.onError(error); }
    }
  }
  clear(): void { this.listeners.clear(); }
}
