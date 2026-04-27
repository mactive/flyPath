export const KV_KEYS = {
  latestSnapshot: "snapshot:latest",
  latestSnapshotMeta: "snapshot:latest-meta",
  topAirportBoards: "airport-boards:top",
  detail: (flightId: string, version: string) => `flight-detail:${flightId}:${version}`,
  search: (query: string, limit: number) => `flight-search:${query}:${limit}`
};

export function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function envFlag(value: string | undefined, fallback = false): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
