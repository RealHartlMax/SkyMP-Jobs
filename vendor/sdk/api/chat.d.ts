export type ChatCategory = 'system' | 'player' | 'error' | 'command';
export interface ChatPlayerIdentity {
  readonly userId: number;
  readonly actorId: number;
  /** Native authenticated profile; null only on older forks without mp.get. */
  readonly profileId: number | null;
  /** Supplied only by a trusted identity adapter, never inferred from a name. */
  readonly accountId: string | null;
  readonly characterId: string | null;
  /** Opaque generation, renewed at every binding or connection change. */
  readonly sessionId: string;
  readonly playerName: string;
}
export type ChatNativeIdentity = Pick<ChatPlayerIdentity, 'userId' | 'actorId' | 'profileId' | 'playerName'>;
export interface ChatIdentityBinding {
  accountId: string | null;
  characterId: string;
  /** Must change even when the same character/actor is reactivated. */
  revision: string;
}
export interface ChatRateLimit { burst: number; refillMs: number; }
export interface ChatParameterDefinition {
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean';
  optional?: boolean;
  choices?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
}
export interface ChatCommandContext extends ChatPlayerIdentity {
  readonly identity: ChatPlayerIdentity;
  readonly locale: string;
  readonly rawInput: string;
  readonly commandId: string;
  readonly commandName: string;
  readonly args: readonly string[];
  readonly argsText: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly signal: AbortSignal;
  /** Check immediately before gameplay effects after every await. */
  isCurrent(): boolean;
  reply(message: string): void;
  error(message: string): void;
  sendToChannel(channelId: string, text: string): number;
}
export interface ChatCommandDefinition {
  /** Defaults to owner:canonical-name. */
  id?: string;
  name: string;
  aliases?: readonly string[];
  description: string;
  usage?: string;
  permission?: string | null;
  owner: string;
  /** Omit for legacy parsing; [] requires zero arguments. */
  parameters?: readonly ChatParameterDefinition[];
  rateLimit?: ChatRateLimit;
  execute(context: ChatCommandContext): void | Promise<void>;
}
export interface ChatCommandMetadata {
  id: string; owner: string; name: string; aliases: string[];
  description: string; usage?: string; parameters?: readonly ChatParameterDefinition[];
}
export interface ChatChannelDefinition {
  id: string;
  owner: string;
  description: string;
  permission?: string | null;
  receivePermission?: string | null;
  rateLimit?: ChatRateLimit;
  canSend?(sender: ChatPlayerIdentity): boolean;
  canReceive?(recipient: ChatPlayerIdentity, sender: ChatPlayerIdentity): boolean;
  selectRecipients(context: Readonly<{ sender: ChatPlayerIdentity; players: readonly ChatPlayerIdentity[] }>): readonly number[];
}
export interface ChatChannelMetadata { id: string; owner: string; description: string; }
export interface StructuredChatMessage { text: string; category?: ChatCategory; }
export type ChatMessageTarget = { userId: number; sessionId?: string } |
  { channelId: string; senderUserId: number; sessionId?: string };
export type ChatPermissionResolver = (userId: number, permission: string, identity: ChatPlayerIdentity) => boolean;
export interface SkyMPChatAPI {
  readonly apiVersion: 1;
  /** Probe with optional chaining when supporting pre-extension bundles. */
  readonly extensions: Readonly<{ commands: 1; channels: 1; identity: 1 }>;
  registerCommand(definition: ChatCommandDefinition): void;
  unregisterCommand(owner: string, name: string): void;
  getCommandsForPlayer(userId: number): ChatCommandMetadata[];
  setPermissionResolver(owner: string, resolver: ChatPermissionResolver | null): void;
  sendToPlayer(userId: number, message: string, category?: ChatCategory): void;
  broadcast(message: string, category?: ChatCategory): void;
  registerChannel(definition: ChatChannelDefinition): void;
  unregisterChannel(owner: string, id: string): void;
  getChannelsForPlayer(userId: number): ChatChannelMetadata[];
  /** Native send count, not a recipient acknowledgement; zero on denial/offline/no recipients. */
  sendToChannel(channelId: string, senderUserId: number, text: string): number;
  sendMessage(target: ChatMessageTarget, message: StructuredChatMessage): number;
  getPlayerIdentity(userId: number): ChatPlayerIdentity | null;
  setIdentityResolver(owner: string, resolver: ((native: ChatNativeIdentity) => ChatIdentityBinding | null) | null): void;
  invalidatePlayer(userId: number): void;
  refreshPlayer(userId: number): boolean;
  unregisterOwner(owner: string): void;
}
declare global {
  var skympChat: SkyMPChatAPI | undefined;
  var skympChatReady: Array<(chat: SkyMPChatAPI) => void> | undefined;
}
