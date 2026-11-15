/**
 * "The contribution graph (Grass) is loading", shared between GrassApp and
 * UserAnalyticsApp on a profile page (decision G-7).
 *
 * Both apps share one rate limiter, so a report sync started while Grass is
 * still fetching makes both slow. Grass goes first: the report button
 * refuses to start a sync while this gate is on. The gate follows Grass's
 * own spinner — on when the current view starts loading, off when it ends
 * (painted, failed or errored) — and a view superseded by a newer one does
 * not touch it.
 */
export class GrassLoadGate {
  private loading = false;
  private loadingSince = 0;
  private readonly listeners = new Set<(loading: boolean) => void>();

  /** Turns the gate on or off; listeners hear only actual changes. */
  set(loading: boolean): void {
    if (loading === this.loading) return;
    this.loading = loading;
    if (loading) this.loadingSince = Date.now();
    for (const listener of this.listeners) listener(loading);
  }

  isLoading(): boolean {
    return this.loading;
  }

  /** ms the gate has been on (0 while off). */
  loadingForMs(now: number = Date.now()): number {
    return this.loading ? Math.max(0, now - this.loadingSince) : 0;
  }

  /** @return a function that removes the listener. */
  subscribe(listener: (loading: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
