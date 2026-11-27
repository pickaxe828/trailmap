import type { Visit } from '@trailmap/shared';
import type { TrailmapDb } from '../db/db';
import { eligibleMetadata, recordingState, siteKey, type RecordingSettings } from '../privacy/policy';
import type { Corrections } from './corrections';
import type { CorrectionRequest } from './messages';

type Deps = {
  db: TrailmapDb;
  corrections: Corrections;
  isIncognitoTab(tabId: number): Promise<boolean>;
  recorder: {
    ready: Promise<void>;
    getCurrentVisit(tabId: number): { id: string } | undefined;
    forgetVisits(remove: () => Promise<readonly string[]>): Promise<readonly string[]>;
  };
  privacy: {
    getSettings(): RecordingSettings;
    /** The skip list from ticket 08. Corrections never keep a list of their own. */
    setSiteSkipped(host: string, skip: boolean): Promise<void>;
  };
};

/** Runs correction requests in the service worker. Replies are `true`/`false`, a Visit id or `null`. */
export function createCorrectionService({ db, corrections, isIncognitoTab, recorder, privacy }: Deps) {
  const forget = async (run: () => Promise<{ visitIds: string[] }>) => {
    await recorder.forgetVisits(async () => (await run()).visitIds);
    return true;
  };

  const allowVisit = (visit: Visit | undefined) => eligibleMetadata(visit, privacy.getSettings());

  async function handle(request: CorrectionRequest): Promise<boolean | string | null> {
    switch (request.action) {
      case 'current-visit': {
        if (await isIncognitoTab(request.tabId)) return null;
        await recorder.ready;
        const current = recorder.getCurrentVisit(request.tabId);
        const visit = current && await db.visits.get(current.id);
        return visit && allowVisit(visit) ? visit.id : null;
      }
      case 'star': await corrections.star(request.visitId, request.starred); return true;
      case 'note': return corrections.note(request.nodeId, request.text,
        request.sessionId ? { sessionId: request.sessionId, allowVisit } : undefined);
      case 'split': return (await corrections.split(request.visitId)) !== null;
      case 'rename': return corrections.rename(request.expeditionId, request.title);
      case 'my-notes': return corrections.editMyNotes(request.expeditionId, request.text,
        request.edit && { ...request.edit, allowVisit });
      case 'merge': return corrections.merge(request.intoId, request.fromId);
      case 'move': return corrections.move(request.visitId, request.toExpeditionId);
      case 'ignore-site': {
        const visit = await db.visits.get(request.visitId);
        const host = siteKey(visit?.url);
        if (!visit || !host) return false;
        const { skippedHosts } = privacy.getSettings();
        // Same rule as the side panel's "Record this site" switch: protected sites can't be edited.
        const withoutHost = skippedHosts.filter((entry) => entry !== host);
        if (skippedHosts.length !== withoutHost.length || recordingState(visit.url, { paused: false, skippedHosts: withoutHost }) !== 'recording') {
          return false;
        }
        await privacy.setSiteSkipped(host, true);
        await corrections.logSiteIgnored();
        return true;
      }
      case 'forget-page': return forget(() => corrections.forgetPage(request.canonicalUrl));
      case 'forget-expedition': return forget(() => corrections.forgetExpedition(request.expeditionId));
      case 'forget-site': return forget(() => corrections.forgetSite(request.host));
    }
  }

  return { handle };
}
