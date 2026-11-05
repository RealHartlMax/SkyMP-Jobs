/** No faction memberships or ranks are copied into Jobs. */
export interface FactionsAdapterV1 {
  readonly apiVersion: 1;
  isMember(characterId: string, factionId: string): Promise<boolean>;
}
