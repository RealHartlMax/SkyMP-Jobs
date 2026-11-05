/** Audited subset, not a complete native API. See docs/API.md for source locations. */
export interface CoreEvents {
  connect: [userId: number];
  disconnect: [userId: number];
  customPacket: [userId: number, raw: string];
}
export interface CoreApi {
  on<E extends keyof CoreEvents>(event: E, handler: (...args: CoreEvents[E]) => void): void;
  isConnected(userId: number): boolean;
  getUserActor(userId: number): number;
  getUserByActor(actorId: number): number;
  get(actorId: number, property: string): unknown;
  set(actorId: number, property: string, value: unknown): void;
  getDescFromId(actorId: number): string;
  getServerSettings(): { maxPlayers?: number };
  sendCustomPacket(userId: number, raw: string): void;
  writeLogs(level: string, message: string): void;
}
export interface PermissionApi {
  readonly apiVersion: 1;
  hasPermission(userId: number, permission: string): boolean;
}
/** These are SINGLE native callback properties. Do not assign them from a consumer plugin. */
export interface NativeGameplayCallbacksReference {
  onEatItem?(actorId: number, baseId: number): boolean | void;
  onActivate?(targetId: number, casterId: number): boolean | void;
  'onPapyrusEvent:OnObjectEquipped'?(actorId: number, base: unknown, reference: unknown): boolean | void;
}
export interface RuntimeClientApi {
  readonly apiVersion: 1;
  readonly pluginId: string;
  controller: { emitter: { on(event: string, fn: (...args: unknown[]) => void): void; off(event: string, fn: (...args: unknown[]) => void): void } };
  send(payload: unknown): void;
  onDispose(cleanup: () => void): void;
}
