/**
 * Watch time for a video page: the time the video was playing while the tab was visible. The content script feeds it
 * one tick a second; the background scores it with `scoreVideoEngagement`.
 */
const MAX_CREDITED_GAP_MS = 5_000;

export class WatchClock {
  watchMs = 0;
  private last: number | null = null;

  /** `playing` is the state now, which is credited for the interval since the previous tick. */
  tick(now: number, playing: boolean) {
    const gap = this.last === null ? 0 : now - this.last;
    this.last = now;
    // A suspended tab wakes up with one huge gap; that time was not watched.
    if (playing && gap > 0 && gap <= MAX_CREDITED_GAP_MS) this.watchMs += gap;
  }

  reset() {
    this.watchMs = 0;
    this.last = null;
  }
}
