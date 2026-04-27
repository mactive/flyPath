export interface WorkerBindings {
  ASSETS: Fetcher;
  FLIGHT_CACHE: KVNamespace;
  SNAPSHOT_ARCHIVE: R2Bucket;
  UPSTREAM_BASE_URL: string;
  UPSTREAM_PROXY_BASE_URL: string;
  SNAPSHOT_TTL_SECONDS?: string;
  DETAIL_TTL_SECONDS?: string;
  SEARCH_TTL_SECONDS?: string;
  AIRPORT_BOARD_TTL_SECONDS?: string;
  TOP_AIRPORT_CODES?: string;
  ENABLE_SNAPSHOT_ARCHIVE?: string;
}

export type WorkerEnv = {
  Bindings: WorkerBindings;
};
