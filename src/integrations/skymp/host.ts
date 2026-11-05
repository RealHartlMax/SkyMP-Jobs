import type { JobsHostControlsV1 } from '../../api/contracts';
import type { CorePermissionsAdapterV1 } from '../../core/permissions';
import type { JobsPersistenceV1 } from '../../persistence/contract';
import type { EconomyAdapterV1 } from '../economy/contract';
import type { FactionsAdapterV1 } from '../factions/contract';
import type { CharacterIdentityAdapterV1 } from './native';

/** Jobs integration contract, NOT an API already supplied by SkyMP Core. Installed by trusted bootstrap. */
export interface JobsHostAdapterV1 {
  readonly apiVersion: 1;
  identity?: CharacterIdentityAdapterV1;
  persistence?: JobsPersistenceV1;
  permissions?: CorePermissionsAdapterV1;
  economy?: EconomyAdapterV1;
  factions?: FactionsAdapterV1;
  /** Capability handoff to trusted resources. Never expose controls through client packets. */
  onReady?(controls: JobsHostControlsV1): void | (() => void);
}
declare global { var skympJobsHost: JobsHostAdapterV1 | undefined; }
