import type { CharacterIdentityAdapterV1, JobsPersistenceV1, ResourceAdministrationV1 } from '../src/library';
import type { JobsHostAdapterV1 } from '../src/integrations/skymp/host';

/** Host proposal, not an existing Core service. Install before Jobs, hand the handle only to trusted server code. */
export function configureJobsHost(identity: CharacterIdentityAdapterV1, persistence: JobsPersistenceV1,
  deliverToTrustedServerResource: (handle: ResourceAdministrationV1) => void): JobsHostAdapterV1 {
  const adapter: JobsHostAdapterV1 = {
    apiVersion: 1, identity, persistence,
    onReady(controls) {
      const controller = controls.provisionResource('example-job-controller', {
        manageJobs: ['example-worker'], manageProfessions: ['example-trade'],
        experience: [{ professionId: 'example-trade', sources: ['verified-task'] }], payments: ['example-worker'],
      });
      deliverToTrustedServerResource(controller);
      // Core has no awaitable unload hook. An orderly host must await controls.shutdown().
      return () => { void controller.dispose().catch(error => console.error(error)); };
    },
  };
  globalThis.skympJobsHost = adapter;
  return adapter;
}
