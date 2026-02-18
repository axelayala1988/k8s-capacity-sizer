# Project: K8s Capacity Sizer

> Central preferences: See `c:\Users\sonof\Development\CLAUDE.md`
> Project-specific notes below.

---

## Project Overview

Dynatrace AppEngine app that right-sizes Kubernetes workloads by comparing configured CPU/memory requests/limits against actual usage. Deployed to `yhu28601.apps.dynatrace.com` as `my.k8s.capacity.sizer`.

**GitHub**: https://github.com/axelayala1988/k8s-capacity-sizer

---

## Critical Architecture Decisions (Don't Re-Learn These)

### DQL timeseries Returns 0 in This Environment

**DO NOT** use DQL `timeseries` commands for metrics. They return 0 for all `builtin:containers.*` and `builtin:kubernetes.*` metrics in this environment. We tried every variation (`now()-24h`, backtick quoting, explicit metric keys). None worked.

**Use the classic Metrics API v2** (`@dynatrace-sdk/client-classic-environment-v2`) instead. This is implemented in `api/query-workload-metrics.function.ts`.

DQL entity queries (`fetch dt.entity.*`) work fine for clusters, namespaces, and workload entities.

### Metric Dimensions Are Entity IDs, Not K8s Labels

`builtin:containers.*` metrics have dimensions:
- `dt.entity.container_group_instance` (entity ID)
- `Container` (container name)

They do **NOT** have `k8s.namespace.name` or `k8s.workload.name` dimensions. You must:
1. `splitBy("dt.entity.container_group_instance")`
2. Resolve entity IDs to pod names via DQL
3. Extract workload names from pod names (strip ReplicaSet/pod hashes)
4. Map workloads to namespaces via entity relationships

### Entity Display Names Include Container Name

Container group instance entity display names have format: `"pod-name container-name"` (space-separated). Must split on space first to isolate the pod name before stripping hashes.

### Pod Name Hash Stripping

Kubernetes pod naming patterns:
- **Deployment**: `name-<rs-hash(6-10 chars)>-<pod-hash(5 chars)>` → strip both suffixes
- **StatefulSet**: `name-<ordinal>` → strip ordinal
- **DaemonSet/Job**: `name-<hash(5-10 chars)>` → strip hash
- Validate extracted names against known `cloud_application` entity names from DQL

### Memory Metric Matching

Search for byte-based metrics first (`residentSetBytes`, `workingSetBytes`, `usageBytes`). The pattern `memory.usage` matches `builtin:containers.memory.usagePercent` (0-100 range), NOT bytes. If only percentage available, convert: `bytes = (percent / 100) * memory_limit`.

### Namespace Resolution (4 Cascading Approaches)

| Priority | Method | Why It Might Fail |
|----------|--------|-------------------|
| A | `belongs_to` relationship expansion | Relationship may not exist |
| B | `contains` reverse relationship | Same |
| C | Raw field inspection | Entity model varies |
| D | Fallback to user-selected namespace | Always works but less accurate |

### CSV/File Export in AppEngine

Standard `document.createElement('a').click()` does NOT work in AppEngine's sandboxed iframe. Use:
1. `window.open(blobUrl, '_blank')` — primary method
2. `navigator.clipboard.writeText()` — fallback if popup blocked
3. Anchor appended to DOM — last resort

Reference: `activegate-capacity-planning` project uses same pattern.

---

## Recommendation Engine Thresholds

### Requests (ratio = peak / configured)
| Range | Severity | Status |
|-------|----------|--------|
| < 10% | RED | Extreme over-provisioning |
| 10-30% | RED | Significant over-provisioning |
| 30-50% | YELLOW | Slight over-provisioning |
| 50-85% | GREEN | Optimal |
| 85-100% | GREEN | Tightly sized |
| > 100% | RED | Under-provisioned |

### Limits (ratio = peak / configured)
| Range | Severity | Status |
|-------|----------|--------|
| < 15% | RED | Limit way too high |
| 15-40% | YELLOW | Generous |
| 40-80% | GREEN | Optimal |
| 80-95% | YELLOW | Tight |
| >= 95% | RED | Critical |

### Headroom & Floors
- Request suggestion: `peak × 1.20` (20% headroom)
- Limit suggestion: `peak × 1.50` (50% headroom)
- CPU floor: 10m
- Memory floor: 32Mi
- Bursty threshold: `peak / median > 5`

---

## Key Files

| File | Purpose |
|------|---------|
| `api/query-workload-metrics.function.ts` | **Core backend** — metric discovery, querying, entity resolution. Most complex file. |
| `ui/app/hooks/useK8sCapacityData.ts` | **Main hook** — state management, DQL entity queries, calls backend, runs recommendation engine |
| `ui/app/utils/recommendations.ts` | **Recommendation engine** — pure functions, all threshold logic |
| `ui/app/utils/exportWorkloads.ts` | CSV export with AppEngine-compatible download |
| `ui/app/components/WorkloadTable.tsx` | Sortable table with pagination, search, severity filter |
| `ui/app/components/WorkloadDetailPanel.tsx` | Side-panel with metric bars and recommendations |
| `ui/app/utils/formatters.ts` | `formatCpu()`, `formatMemory()`, `roundCpu()`, `roundMemory()` |
| `src/types/k8s.ts` | All TypeScript interfaces |
| `RECOMMENDATIONS_LOGIC.md` | 688-line comprehensive documentation of the engine |

---

## Strato Component Gotchas

- `Flex` component `gap` prop only accepts specific values: `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64`. Values like `10` will cause TypeScript build errors.
- Use `Container` for card-like boxes, `Flex` for layout.
- `Heading` levels: 1-6, same as HTML.

---

## Build & Deploy

```bash
npx dt-app build      # TypeScript check + bundle
npx dt-app deploy     # Build + upload to environment
```

- If deploy fails with "same version already installed with different checksum", bump the patch version in `app.config.json`.
- Node 22 recommended but 20+ works (with warning).

---

## Future Scaling Recommendations

For environments with hundreds of clusters and tens of thousands of workloads, the following improvements should be implemented. These are NOT yet built — they're here for reference when needed.

### 1. Backend Pagination by Namespace

**Problem**: The current backend queries ALL workloads in a namespace at once via `splitBy(entity)`. With 10k+ entities, the Metrics API will timeout or return truncated results.

**Solution**: Query one namespace at a time (or in small batches). The frontend already filters by namespace, but in "All namespaces" mode, iterate namespace-by-namespace:

```typescript
// In query-workload-metrics.function.ts
for (const ns of namespaces) {
  const nsResult = await queryMetricsForNamespace(ns, from);
  allResults.push(...nsResult);
}
```

**Estimated effort**: Medium — mainly backend changes to `query-workload-metrics.function.ts`.

### 2. Entity Query Pagination

**Problem**: DQL entity fetches are capped at 2000 for `container_group_instance`, 500 for `cloud_application`. Large environments will exceed these.

**Solution**: Use `nextPageKey` pagination in DQL queries or increase limits. The `runDQL()` helper needs to loop until no more pages:

```typescript
async function runDQLPaginated(query: string): Promise<any[]> {
  let allRecords: any[] = [];
  let requestToken: string | undefined;
  do {
    const result = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 30000 },
      ...(requestToken ? { requestToken } : {}),
    });
    allRecords.push(...(result.result?.records || []));
    requestToken = result.result?.nextPageKey;
  } while (requestToken);
  return allRecords;
}
```

**Estimated effort**: Small — utility function change.

### 3. Namespace-Level Summary View

**Problem**: Loading 10k workloads upfront is slow and overwhelming. Users don't need all details immediately.

**Solution**: Add a two-level drill-down:
1. **Level 1: Namespace summary** — Show per-namespace aggregates (total workloads, red/yellow/green counts, total waste). This is a lightweight query.
2. **Level 2: Workload detail** — Click a namespace to load its workloads.

This dramatically reduces initial data load and gives a better overview for large environments.

**Estimated effort**: Large — new component, modified hook, possibly a new backend function for namespace-level aggregation.

### 4. Virtual Scrolling

**Problem**: Even with pagination at 100 rows, rendering is fine. But if users want to see "all" without pagination, 10k DOM rows will lag.

**Solution**: Replace pagination with virtual scrolling using `react-window` or `@tanstack/react-virtual`. Only renders visible rows (~20-30) regardless of total count.

```bash
npm install react-window @types/react-window
```

**Trade-off**: Adds a dependency. Current pagination approach (25/50/100) is simpler and sufficient for most cases. Only add virtual scrolling if users specifically request "show all" for 1000+ workloads.

**Estimated effort**: Medium — replace the row rendering section in WorkloadTable.

### 5. Result Caching

**Problem**: Changing sort, filter, or page re-renders are fine (client-side). But switching namespace and coming back re-queries the backend.

**Solution**: Cache backend results by `(cluster, namespace, timeRange)` key. Show cached data immediately, then refresh in background:

```typescript
const cacheKey = `${selectedCluster}|${selectedNamespace}|${timeRange}`;
const cached = resultCache.get(cacheKey);
if (cached) setWorkloads(cached); // Show immediately
loadWorkloadData().then(fresh => {
  resultCache.set(cacheKey, fresh);
  setWorkloads(fresh);
});
```

**Estimated effort**: Small — add a `Map` or `useRef` cache in the hook.

### 6. "All Namespaces" Mode with Streaming

**Problem**: Querying all namespaces at once for a large cluster can be very slow (minutes).

**Solution**: Stream results namespace-by-namespace, updating the UI as each completes:

```typescript
for (const ns of namespaces) {
  const nsWorkloads = await queryWorkloadMetrics({ namespace: ns, from });
  setWorkloads(prev => [...prev, ...analyzeAll(nsWorkloads)]);
  // UI updates incrementally, user sees progress
}
```

Add a progress indicator: "Loading namespace 3 of 47..."

**Estimated effort**: Medium — requires streaming state updates in the hook.

### 7. Metrics API Query Optimization

**Problem**: Currently queries 6 metrics sequentially (CPU usage/req/lim + Mem usage/req/lim). For large environments, this means 6 API calls × entity resolution.

**Solution**:
- Query metrics in parallel (`Promise.all`)
- Use metric selector combinators if the API supports them
- Pre-filter entities by namespace before querying metrics (reduces splitBy cardinality)

Already partially implemented in the backend but could be optimized further.

**Estimated effort**: Small-Medium.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0-1.6 | Feb 2026 | Initial scaffolding, DQL-based approach (didn't work for metrics) |
| 1.7.0 | Feb 2026 | Migrated to Metrics API v2, first working data |
| 1.8.0 | Feb 2026 | Entity dimension fix, 76 workloads showing |
| 1.8.1 | Feb 2026 | Layout change: detail panel moved to right side |
| 1.9.0 | Feb 2026 | Fixed workload names, namespaces, memory values |
| 1.9.1 | Feb 2026 | Added collapsible reference guide footer |
| 1.10.0 | Feb 2026 | Added recommendation columns + CSV export |
| 1.10.1 | Feb 2026 | Fixed CSV export for AppEngine iframe, added README |
| 1.11.0 | Feb 2026 | Pagination, text search, severity filter |
