import type { TrailmapDb } from '../db/db';
import { recordingState, siteKey, type RecordingSettings } from '../privacy/policy';
import type { Corrections } from './corrections';
import type { CorrectionRequest } from './messages';

type Deps = {
  db: TrailmapDb;
  corrections: Corrections;
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
export function createCorrectionService({ db, corrections, recorder, privacy }: Deps) {
  const forget = async (run: () => Promise<{ visitIds: string[] }>) => {
    await recorder.forgetVisits(async () => (await run()).visitIds);
    return true;
  };

  async function handle(request: CorrectionRequest): Promise<boolean | string | null> {
    switch (request.action) {
      case 'current-visit':
        await recorder.ready;
        return recorder.getCurrentVisit(request.tabId)?.id ?? null;
      case 'star': await corrections.star(request.visitId, request.starred); return true;
      case 'note': await corrections.note(request.nodeId, request.text); return true;
      case 'split': return (await corrections.split(request.visitId)) !== null;
      case 'rename': return corrections.rename(request.expeditionId, request.title);
      case 'field-notes': return corrections.editFieldNotes(request.expeditionId, request.text);
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
        await corrections.logSiteIgnored(host);
        return true;
      }
      case 'forget-page': return forget(() => corrections.forgetPage(request.canonicalUrl));
      case 'forget-expedition': return forget(() => corrections.forgetExpedition(request.expeditionId));
      case 'forget-site': return forget(() => corrections.forgetSite(request.host));
    }
  }

  return { handle };
}
