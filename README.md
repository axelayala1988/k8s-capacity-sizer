# K8s Capacity Sizer

A Dynatrace AppEngine application that helps right-size Kubernetes workloads by comparing configured requests and limits against actual CPU and memory usage. It provides actionable, color-coded recommendations with suggested values based on peak usage analysis.

---

## Problem

Kubernetes resource management is hard to get right:

- **Over-provisioned requests** make your cluster appear "full" while actual usage is low. Pods become unschedulable and you pay for idle capacity.
- **Under-provisioned requests** mean your pods lose CPU time under contention and are first to be evicted under memory pressure.
- **Over-provisioned limits** create noisy neighbor risk — one pod can burst and starve co-located pods.
- **Under-provisioned limits** cause CPU throttling (latency spikes) and memory OOMKills (container restarts).
- **No requests or limits** (BestEffort QoS) means the pod is first to be evicted and the scheduler has no capacity awareness.

Most teams set these values once at deployment and never revisit them. This app continuously compares what you configured against what your workloads actually use, then tells you exactly what to change.

---

## Features

- **Cluster and namespace filtering** — Select your target environment from auto-discovered entities
- **Time range selection** — Analyze usage over 1 hour to 30 days
- **Sortable workload table** — View all workloads with current config, actual usage, and recommended values
- **Recommendation columns** — See suggested CPU and memory values directly in the table
- **Side-panel detail view** — Click any workload for metric bars comparing request/limit/median/peak visually
- **Color-coded severity** — Green (optimal), Yellow (review), Red (action needed), Gray (no data)
- **CSV export** — Download full report with all 22 columns for offline analysis or sharing
- **QoS class detection** — Identifies Guaranteed, Burstable, and BestEffort workloads
- **Bursty workload detection** — Flags workloads where peak usage is 5x+ the median
- **Collapsible reference guide** — In-app explanation of all thresholds and logic in plain language

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Dynatrace AppEngine                │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              Frontend (React/TS)              │   │
│  │                                               │   │
│  │  CapacitySizer Page                           │   │
│  │  ├── ClusterSelector (entity query)           │   │
│  │  ├── NamespaceSelector (entity query)         │   │
│  │  ├── TimeRangeSelector                        │   │
│  │  ├── SummaryCards (counts + waste)            │   │
│  │  ├── WorkloadTable (sortable, 9 columns)      │   │
│  │  ├── WorkloadDetailPanel (metric bars)        │   │
│  │  └── Reference Guide (collapsible)            │   │
│  │                                               │   │
│  │  useK8sCapacityData Hook                      │   │
│  │  ├── DQL entity queries (clusters/namespaces) │   │
│  │  ├── Backend function call (workload metrics) │   │
│  │  └── Recommendation engine (pure functions)   │   │
│  └──────────────────────┬───────────────────────┘   │
│                         │ functions.call()            │
│  ┌──────────────────────▼───────────────────────┐   │
│  │           Backend (AppEngine Functions)        │   │
│  │                                               │   │
│  │  query-workload-metrics.function.ts           │   │
│  │  ├── Metric discovery (Metrics API v2)        │   │
│  │  ├── Metric querying (splitBy entity dim)     │   │
│  │  ├── Entity resolution (DQL)                  │   │
│  │  │   ├── container_group_instance → pod name  │   │
│  │  │   ├── cloud_application → workload name    │   │
│  │  │   └── cloud_application_namespace → ns     │   │
│  │  └── Pod name → workload name extraction      │   │
│  └──────────────────────────────────────────────┘   │
│                         │                            │
│              ┌──────────▼──────────┐                │
│              │  Dynatrace APIs     │                │
│              │  • Metrics API v2   │                │
│              │  • Grail (DQL)      │                │
│              └─────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

### Data Flow

1. **Filter loading** — DQL entity queries discover available clusters and namespaces
2. **Metric discovery** — Backend discovers available `builtin:containers.*` metrics via Metrics API v2
3. **Metric querying** — Each metric is queried with `splitBy(dt.entity.container_group_instance)` and folded with `avg`/`max` aggregations
4. **Entity resolution** — Container group instance IDs are resolved to pod names, then to workload names (stripping ReplicaSet/pod hashes), then to namespaces via 4 cascading DQL approaches
5. **Recommendation analysis** — Each workload's peak usage is compared against configured requests/limits using ratio-based thresholds
6. **Display** — Results sorted by severity (red first), rendered in sortable table with optional detail panel

---

## Recommendation Engine

### Core Formula

```
ratio = peak_usage / configured_value
```

We use **peak usage** (not median) because both requests and limits must cover worst-case demand:
- Requests guarantee minimum resources under contention
- Limits are the hard ceiling where throttling/OOMKill occurs

### Request Thresholds

| Ratio | Severity | Meaning |
|-------|----------|---------|
| < 10% | RED | Extremely over-provisioned (10x+ what's needed) |
| 10-30% | RED | Significantly over-provisioned |
| 30-50% | YELLOW | Slightly over-provisioned, could reclaim capacity |
| 50-85% | GREEN | Well-sized — good balance of headroom and efficiency |
| 85-100% | GREEN | Tightly sized — monitor for growth |
| > 100% | RED | Under-provisioned — usage exceeds reservation |

### Limit Thresholds

| Ratio | Severity | Meaning |
|-------|----------|---------|
| < 15% | RED | Limit way too high, no meaningful protection |
| 15-40% | YELLOW | Generous limit, consider tightening |
| 40-80% | GREEN | Well-sized — good headroom for spikes |
| 80-95% | YELLOW | Approaching limit, risk of throttling/OOMKill |
| >= 95% | RED | Critical — active throttling or OOMKill imminent |

### Suggested Values

| Resource | Formula | Rationale |
|----------|---------|-----------|
| **Request** | `peak × 1.20` | 20% headroom covers measurement variance and minor growth |
| **Limit** | `peak × 1.50` | 50% headroom because hitting limits has severe consequences |

**Minimum floors**: CPU never below 10m, Memory never below 32Mi

### Edge Cases Handled

- **No request/limit set** — Flags as RED with suggested values based on peak usage
- **Request > Limit** — Detected as misconfiguration (Kubernetes will reject this)
- **Guaranteed QoS** (request == limit) — Warns that changing one independently downgrades QoS
- **BestEffort QoS** (nothing set) — Flags all dimensions as RED
- **Zero/near-zero usage** — Still flags over-provisioning but adds safety note
- **Bursty workloads** (peak/median > 5x) — Special advisory about HPA and burst handling

### QoS Classes

| Class | Configuration | Eviction Priority |
|-------|--------------|-------------------|
| **Guaranteed** | request == limit for all resources | Last to be evicted (highest) |
| **Burstable** | request < limit, or partial config | Middle |
| **BestEffort** | No requests or limits | First to be evicted (lowest) |

---

## Metrics Used

| Metric | Key Pattern | Unit | Source |
|--------|------------|------|--------|
| CPU Usage | `builtin:containers.cpu.usageMilliCores` | millicores | Metrics API v2 |
| CPU Request | `builtin:containers.cpu.requestMilliCores` | millicores | Metrics API v2 |
| CPU Limit | `builtin:containers.cpu.limitMilliCores` | millicores | Metrics API v2 |
| Memory Usage | `builtin:containers.memory.residentSetBytes` | bytes | Metrics API v2 |
| Memory Request | `builtin:containers.memory.requestBytes` | bytes | Metrics API v2 |
| Memory Limit | `builtin:containers.memory.limitBytes` | bytes | Metrics API v2 |

**Note**: Metric keys are discovered dynamically. The app searches for `containers.cpu` and `containers.memory` patterns and selects the best match. Memory prefers byte-based metrics over percentage-based ones.

### Entity Queries (DQL)

| Entity | Query |
|--------|-------|
| Clusters | `fetch dt.entity.kubernetes_cluster` |
| Namespaces | `fetch dt.entity.cloud_application_namespace` |
| Workloads | `fetch dt.entity.cloud_application` |
| Pods/Containers | `fetch dt.entity.container_group_instance` |

---

## Project Structure

```
k8s-capacity-sizer/
├── app.config.json                          # Dynatrace app manifest
├── package.json                             # Dependencies
├── tsconfig.json                            # TypeScript config
├── main.tsx                                 # dt-app entry shim
├── RECOMMENDATIONS_LOGIC.md                 # Detailed recommendation engine documentation
├── api/
│   ├── tsconfig.json                        # Backend TypeScript config
│   ├── query-grail.function.ts              # Generic DQL query executor
│   ├── discover-metrics.function.ts         # Metric key discovery
│   └── query-workload-metrics.function.ts   # Core: metric query + entity resolution
├── src/
│   ├── assets/
│   │   └── app_icon.png
│   └── types/
│       └── k8s.ts                           # All TypeScript interfaces
└── ui/
    ├── index.html
    └── app/
        ├── index.tsx                        # React root
        ├── App.tsx                          # App wrapper
        ├── styles.css                       # Dark theme styles
        ├── pages/
        │   └── CapacitySizer.tsx             # Main page (filters + table + panel)
        ├── components/
        │   ├── ClusterSelector.tsx           # Cluster dropdown
        │   ├── NamespaceSelector.tsx         # Namespace dropdown
        │   ├── TimeRangeSelector.tsx         # Time range presets
        │   ├── SummaryCards.tsx              # Summary statistics cards
        │   ├── WorkloadTable.tsx             # Sortable workload table (9 columns)
        │   ├── WorkloadDetailPanel.tsx       # Side-panel with metric bars
        │   ├── RecommendationBadge.tsx       # Color-coded status pill
        │   └── MetricBar.tsx                # Visual bar chart component
        ├── hooks/
        │   └── useK8sCapacityData.ts        # Main data hook (state + queries)
        └── utils/
            ├── appFunctions.ts              # Backend function call wrappers
            ├── recommendations.ts           # Recommendation engine (pure functions)
            ├── formatters.ts                # CPU/memory/percentage formatters
            └── exportWorkloads.ts           # CSV export utility
```

---

## Prerequisites

- **Dynatrace environment** with Kubernetes monitoring enabled
- **Dynatrace AppEngine** access
- **Node.js** >= 20 (22 recommended)
- **dt-app CLI** (`npm install -g dt-app` or use `npx`)

### Required Scopes

| Scope | Purpose |
|-------|---------|
| `storage:metrics:read` | Read container metrics from Grail |
| `storage:entities:read` | Read Kubernetes entity data |
| `environment-api:metrics:read` | Read metrics via classic Metrics API v2 |

---

## Setup & Deployment

### 1. Clone the repository

```bash
git clone https://github.com/axelayala1988/k8s-capacity-sizer.git
cd k8s-capacity-sizer
```

### 2. Configure your environment

Edit `app.config.json` and set your Dynatrace environment URL:

```json
{
  "environmentUrl": "https://YOUR_ENVIRONMENT.apps.dynatrace.com"
}
```

### 3. Install dependencies

```bash
npm install
```

### 4. Development

```bash
npm run dev
```

Opens a local dev server at `http://127.0.0.1:3000` proxied to your Dynatrace environment.

### 5. Build

```bash
npm run build
```

### 6. Deploy

```bash
npm run deploy
```

The app will be available at:
```
https://YOUR_ENVIRONMENT.apps.dynatrace.com/ui/apps/my.k8s.capacity.sizer
```

---

## CSV Export

The export includes 22 columns:

| Column | Description |
|--------|-------------|
| Workload | Workload name (deployment/statefulset/daemonset) |
| Namespace | Kubernetes namespace |
| Status | Overall sizing status |
| Overall Severity | green / yellow / red / gray |
| CPU Request (m) | Current CPU request in millicores |
| CPU Limit (m) | Current CPU limit in millicores |
| CPU Median Usage (m) | Average CPU usage over time window |
| CPU Peak Usage (m) | Maximum CPU usage over time window |
| Rec. CPU Request (m) | Suggested CPU request (peak × 1.2) |
| Rec. CPU Limit (m) | Suggested CPU limit (peak × 1.5) |
| CPU Request Status | Request sizing assessment |
| CPU Limit Status | Limit sizing assessment |
| Memory Request (Mi) | Current memory request in MiB |
| Memory Limit (Mi) | Current memory limit in MiB |
| Memory Median Usage (Mi) | Average memory usage in MiB |
| Memory Peak Usage (Mi) | Peak memory usage in MiB |
| Rec. Memory Request (Mi) | Suggested memory request |
| Rec. Memory Limit (Mi) | Suggested memory limit |
| Memory Request Status | Request sizing assessment |
| Memory Limit Status | Limit sizing assessment |
| QoS Class | Guaranteed / Burstable / BestEffort |
| Bursty | Yes / No (peak > 5x median) |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18, TypeScript 5.4 |
| UI Framework | Dynatrace Strato Design System |
| Backend | Dynatrace AppEngine Functions |
| Metrics | `@dynatrace-sdk/client-classic-environment-v2` (Metrics API v2) |
| Entities | `@dynatrace-sdk/client-query` (DQL via Grail) |
| App Utils | `@dynatrace-sdk/app-utils` (functions.call) |

---

## Workload Name Resolution

Container metrics report at the pod level (`dt.entity.container_group_instance`), not the workload level. The app resolves pod names to workload names by:

1. **Splitting entity display names** — Pod entity names have format `"pod-name container-name"` (space-separated). The container suffix is stripped first.
2. **Hash stripping** — Kubernetes pod naming patterns are reverse-engineered:
   - **Deployment**: `name-<replicaset-hash>-<pod-hash>` → `name`
   - **StatefulSet**: `name-<ordinal>` → `name`
   - **DaemonSet/Job**: `name-<hash>` → `name`
3. **Validation** — Extracted names are validated against known `cloud_application` entity names from DQL

### Namespace Resolution (4 cascading approaches)

| Priority | Method | DQL Pattern |
|----------|--------|-------------|
| A | `belongs_to` relationship | `cloud_application | expand belongs_to[cloud_application_namespace]` |
| B | `contains` relationship | `cloud_application_namespace | expand contains[cloud_application]` |
| C | Raw field inspection | Inspect entity fields for namespace references |
| D | Fallback | Use user-selected namespace filter value |

---

## License

MIT
