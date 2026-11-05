/** Handwritten consumer subset of SkyMP-UI-Core/shared/contracts.ts, API/protocol 1. */
export type UiTarget = { userId: number } | { actorId: number };
export type Tone = 'info' | 'success' | 'warning' | 'error';
export interface UiActionContext {
  readonly userId: number; readonly actorId: number | null;
  readonly widgetId: string; readonly actionId: string; readonly payload: unknown;
  readonly requestId: string; readonly signal: AbortSignal;
}
export interface UiApi {
  readonly apiVersion: 1;
  registerWidget(def: { id: string; owner: string; kind: 'text' | 'status' | 'progress' | 'icon-list' | 'custom-template'; schemaVersion: number; defaultPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; defaultVisible?: boolean; templateId?: string }): void;
  unregisterWidget(owner: string, id: string): void;
  updateWidget(target: UiTarget, id: string, state: unknown): void;
  setWidgetVisible(target: UiTarget, id: string, visible: boolean): void;
  registerMenu(def: { id: string; owner: string; title: string; schemaVersion: number; layoutId: 'core:dialog-v1' | 'core:form-v1' | 'core:panel-v1'; modal?: boolean; priority?: number }): void;
  unregisterMenu(owner: string, id: string): void;
  openMenu(target: UiTarget, id: string, state: unknown): void;
  closeMenu(target: UiTarget, id: string): void;
  notify(target: UiTarget, message: string, options?: { tone?: Tone; durationMs?: number }): void;
  onAction(owner: string, id: string, actionId: string, handler: (ctx: UiActionContext) => void | Promise<void>, options?: { authorize: (ctx: UiActionContext) => boolean }): void;
  getStatus(): { ready: boolean; apiVersion: number; frontendProtocol: number; sessions: number; locale: string };
  readonly framework?: {
    readonly version: 1;
    clientStatus(target: UiTarget): { ready: boolean; frameworkVersion: 0 | 1 };
    unregisterOwner(owner: string): void;
    offAction(owner: string, id: string, actionId: string): void;
  };
}
