# K8s Capacity Sizer - Recommendations Logic

This document explains the complete recommendation engine logic used by the K8s Capacity Sizer app. It covers how sizing assessments are made, how edge cases are handled, and provides detailed examples for every scenario.

---

## Table of Contents

1. [Core Concepts](#1-core-concepts)
2. [What We Measure](#2-what-we-measure)
3. [Recommendation Algorithm](#3-recommendation-algorithm)
4. [Request Sizing Rules](#4-request-sizing-rules)
5. [Limit Sizing Rules](#5-limit-sizing-rules)
6. [Suggested Value Calculations](#6-suggested-value-calculations)
7. [Edge Cases & Special Scenarios](#7-edge-cases--special-scenarios)
8. [Overall Workload Status](#8-overall-workload-status)
9. [Waste Estimation](#9-waste-estimation)
10. [Detailed Examples](#10-detailed-examples)
11. [Severity Color Reference](#11-severity-color-reference)

---

## 1. Core Concepts

### What are Requests and Limits?

**Requests** are the *guaranteed minimum* resources for a container. The Kubernetes scheduler uses requests to decide which node a pod lands on. If a node doesn't have enough unreserved capacity to satisfy a pod's requests, the pod won't be scheduled there.

- **CPU Request**: Translates to `cpu.shares` in Linux cgroups. It's a proportional weight, not a hard cap. Under contention, a container with a 500m request gets twice the CPU time as one with 250m.
- **Memory Request**: The kubelet uses this to decide eviction order. When a node runs low on memory, pods using more than their memory request are evicted first (OOM killed).

**Limits** are the *hard ceiling* a container cannot exceed.

- **CPU Limit**: Translates to `cpu.cfs_quota_us` / `cpu.cfs_period_us` in cgroups. When a container hits its CPU limit, it gets **throttled** (slowed down), not killed. This causes latency spikes.
- **Memory Limit**: When a container tries to allocate memory beyond its limit, the kernel immediately **OOM kills** the container. This causes restarts and dropped connections.

### QoS Classes (Determined by Request/Limit Configuration)

| QoS Class | Configuration | Eviction Priority |
|-----------|--------------|-------------------|
| **Guaranteed** | requests == limits for ALL containers in pod | Last to be evicted (highest priority) |
| **Burstable** | requests < limits, or limits set for some but not all resources | Middle priority |
| **BestEffort** | No requests and no limits set at all | First to be evicted (lowest priority) |

### Why Right-Sizing Matters

| Problem | Impact |
|---------|--------|
| Over-provisioned requests | Cluster appears "full" but actual usage is low. Pods become unschedulable. You're paying for idle capacity. |
| Under-provisioned requests | Pod gets scheduled but loses CPU time under node contention. For memory, pod is first to be evicted under pressure. |
| Over-provisioned limits | Noisy neighbor risk: one pod can burst and starve co-located pods. Also wastes "headroom budget" for the cluster. |
| Under-provisioned limits | CPU throttling causes latency spikes. Memory OOMKill causes restarts and service disruptions. |
| No requests set | Pod gets BestEffort QoS — first to be evicted. Scheduler has no capacity awareness. |
| No limits set | Unbounded resource consumption. A memory leak can take down the entire node. CPU burst can starve other pods. |

---

## 2. What We Measure

For each workload (deployment, statefulset, daemonset), we collect:

| Metric | Source | Unit | Description |
|--------|--------|------|-------------|
| **CPU Request** | `dt.kubernetes.container.cpu_requests` | millicores | Configured CPU request value |
| **CPU Limit** | `dt.kubernetes.container.cpu_limits` | millicores | Configured CPU limit value |
| **CPU Median Usage** | `avg(dt.kubernetes.container.cpu_usage)` | millicores | Average (median approximation) CPU usage over time window |
| **CPU Peak Usage** | `max(dt.kubernetes.container.cpu_usage)` | millicores | Maximum CPU usage observed in time window |
| **Memory Request** | `dt.kubernetes.container.memory_requests` | bytes | Configured memory request value |
| **Memory Limit** | `dt.kubernetes.container.memory_limits` | bytes | Configured memory limit value |
| **Memory Median Usage** | `avg(dt.kubernetes.container.memory_working_set)` | bytes | Average memory working set over time window |
| **Memory Peak Usage** | `max(dt.kubernetes.container.memory_working_set)` | bytes | Maximum memory working set observed in time window |

**Note on Median vs Average**: We use `avg()` as an approximation for median usage. In Dynatrace Grail, if `percentile(metric, 50)` is supported, we prefer that for a true p50. The UI labels reflect which approximation was used.

---

## 3. Recommendation Algorithm

For each workload, we evaluate **four dimensions** independently:

1. CPU Request vs Actual Usage
2. CPU Limit vs Actual Usage
3. Memory Request vs Actual Usage
4. Memory Limit vs Actual Usage

Each dimension produces a `Recommendation` object:

```
Recommendation {
  status:         'optimal' | 'over-provisioned' | 'under-provisioned' | 'no-data'
  severity:       'green' | 'yellow' | 'red' | 'gray'
  message:        Human-readable explanation
  ratio:          actual_peak / configured_value (e.g., 0.33 = using 33% of configured)
  suggestedValue: Recommended value with appropriate headroom (or null)
}
```

### The Core Ratio

```
ratio = peak_usage / configured_value
```

We use **peak usage** (not median) as the reference for recommendations because:
- **Requests** guarantee minimum resources — they must cover peak demand to avoid starvation/eviction
- **Limits** are the hard ceiling — they must cover peak demand to avoid throttling/OOMKill

The **median** is shown for informational purposes: it tells you what "normal" looks like vs what "worst case" looks like. A large gap between median and peak suggests bursty workloads.

---

## 4. Request Sizing Rules

Requests are about **capacity reservation**. The question is: "How much of what I reserved am I actually using?"

| Ratio Range | Severity | Status | Logic |
|-------------|----------|--------|-------|
| ratio < 0.10 | RED | over-provisioned | Using less than 10% of request. Extreme waste. Configured value is 10x+ what's needed. |
| 0.10 <= ratio < 0.30 | RED | over-provisioned | Using less than 30% of request. Significant waste. Resources are reserved but sitting idle. |
| 0.30 <= ratio < 0.50 | YELLOW | over-provisioned | Using 30-50% of request. Moderate over-provisioning. Could reclaim some capacity. |
| 0.50 <= ratio < 0.85 | GREEN | optimal | Sweet spot. Peak usage is 50-85% of request. Enough headroom for variance without waste. |
| 0.85 <= ratio <= 1.0 | GREEN | optimal | Tightly sized. Works well for stable workloads. May need monitoring for growth. |
| ratio > 1.0 | RED | under-provisioned | Peak usage EXCEEDS request. Pod will lose resources under node contention. Memory: risk of eviction. |

### Message Templates (Requests)

- **RED (over, <10%)**: `"CPU request is {1/ratio}x peak usage — extremely over-provisioned. Wasting {configured - suggested}m."`
- **RED (over, 10-30%)**: `"CPU request is {1/ratio}x peak usage — significantly over-provisioned. Consider reducing to ~{suggested}m."`
- **YELLOW (over, 30-50%)**: `"CPU request is {1/ratio}x peak usage — slightly over-provisioned. Could reduce to ~{suggested}m."`
- **GREEN (optimal, 50-85%)**: `"Well-sized — peak usage is {ratio*100}% of request."`
- **GREEN (optimal, 85-100%)**: `"Tightly sized — peak usage is {ratio*100}% of request. Monitor for growth."`
- **RED (under, >100%)**: `"UNDER-PROVISIONED — peak usage exceeds request by {(ratio-1)*100}%. Risk of starvation under contention. Increase to at least ~{suggested}m."`

---

## 5. Limit Sizing Rules

Limits are about **hard ceilings**. The question is: "How close is my actual usage to hitting the wall?"

| Ratio Range | Severity | Status | Logic |
|-------------|----------|--------|-------|
| ratio < 0.15 | RED | over-provisioned | Using less than 15% of limit. Limit is so high it provides no meaningful protection. Noisy neighbor risk. |
| 0.15 <= ratio < 0.40 | YELLOW | over-provisioned | Limit is generous. Consider tightening to reduce blast radius. |
| 0.40 <= ratio < 0.80 | GREEN | optimal | Good headroom. Peak usage is well below limit but limit still provides meaningful guardrails. |
| 0.80 <= ratio < 0.95 | YELLOW | under-provisioned | Getting close to the limit. CPU: throttling may occur during spikes. Memory: approaching OOMKill territory. |
| ratio >= 0.95 | RED | under-provisioned | CRITICAL proximity to limit. CPU: frequent throttling. Memory: high OOMKill risk. Increase immediately. |

### Message Templates (Limits)

- **RED (over, <15%)**: `"CPU limit is {1/ratio}x peak usage — provides no meaningful constraint. Consider reducing to ~{suggested}m."`
- **YELLOW (over, 15-40%)**: `"CPU limit is {1/ratio}x peak usage — generous. Could tighten to ~{suggested}m."`
- **GREEN (optimal, 40-80%)**: `"Well-sized — peak usage is {ratio*100}% of limit. Good headroom for bursts."`
- **YELLOW (under, 80-95%)**: `"Limit is tight — peak usage is {ratio*100}% of limit. CPU: risk of throttling. Memory: approaching OOMKill zone."`
- **RED (under, >=95%)**: `"CRITICAL — peak usage at {ratio*100}% of limit. CPU: active throttling likely. Memory: OOMKill imminent. Increase to at least ~{suggested}m."`

---

## 6. Suggested Value Calculations

### For Requests
```
suggested_request = peak_usage * 1.20
```
**Why 20% headroom**: Requests should cover your peak with a buffer for measurement variance, minor growth, and JVM/runtime overhead. 20% is a standard SRE practice for request headroom.

### For Limits
```
suggested_limit = peak_usage * 1.50
```
**Why 50% headroom**: Limits need more headroom than requests because hitting a limit has severe consequences (throttling or OOMKill). The extra buffer absorbs unexpected spikes, garbage collection pauses, and burst traffic.

### Rounding Rules
- **CPU**: Round up to nearest 10 millicores (e.g., 127m -> 130m)
- **Memory**: Round up to nearest 16 MiB (e.g., 200Mi -> 208Mi, i.e., 13 * 16Mi)

This avoids absurdly precise values like "127m" or "193Mi" that look generated rather than intentional.

### When Suggested Value is Null
- If there's no usage data, we can't suggest a value (`suggestedValue = null`)
- If there's no configured value, the suggested value is based purely on peak usage + headroom

---

## 7. Edge Cases & Special Scenarios

### Case A: No Request AND No Limit Set (BestEffort)

```
CPU Request: null    CPU Limit: null
Memory Request: null Memory Limit: null
Actual CPU Usage: 150m    Actual Memory Usage: 256Mi
```

**Handling**:
- All four recommendations return severity: **RED**
- Status: `under-provisioned` (for requests) / `over-provisioned` is wrong here — use a special status
- Messages:
  - Request: `"No CPU request configured — pod is BestEffort QoS. Will be first evicted under pressure. Suggest setting request to ~180m (peak + 20% headroom)."`
  - Limit: `"No CPU limit configured — unbounded resource usage. A memory leak or CPU spike can destabilize the entire node. Suggest setting limit to ~225m (peak + 50% headroom)."`
- The overall workload status should flag this as **RED** with a specific note about QoS class
- `ratio: null` (can't compute ratio without a configured value)
- `suggestedValue` is still calculated from peak usage

### Case B: Request Set, No Limit Set (Burstable - No Ceiling)

```
CPU Request: 500m    CPU Limit: null
Memory Request: 256Mi Memory Limit: null
```

**Handling**:
- Request recommendation: evaluated normally using the ratio formula
- Limit recommendation:
  - Severity: **YELLOW**
  - Message: `"No CPU limit configured — container can burst without constraint. Consider setting a limit to ~{suggested} to prevent noisy neighbor issues."`
  - `ratio: null`
  - `suggestedValue`: based on peak usage * 1.50

### Case C: Limit Set, No Request Set

```
CPU Request: null    CPU Limit: 1000m
Memory Request: null Memory Limit: 512Mi
```

**Handling**:
- Request recommendation:
  - Severity: **RED**
  - Message: `"No CPU request configured — scheduler has no capacity awareness for this pod. Under contention, it gets no guaranteed CPU time. Suggest setting request to ~{suggested}."`
  - `ratio: null`
  - `suggestedValue`: based on peak usage * 1.20
- Limit recommendation: evaluated normally using the ratio formula

### Case D: Request == Limit (Guaranteed QoS)

```
CPU Request: 500m    CPU Limit: 500m
Memory Request: 256Mi Memory Limit: 256Mi
```

**Handling**:
- Both request and limit recommendations use the same configured value
- The request recommendation evaluates peak vs 500m
- The limit recommendation evaluates peak vs 500m
- If peak is 150m (ratio = 0.30):
  - Request: YELLOW "over-provisioned" (0.30)
  - Limit: YELLOW "over-provisioned" (0.30)
- Special note in message: `"Workload is Guaranteed QoS (request == limit). Both must change together to maintain QoS class."`

### Case E: Request > Limit (Misconfiguration)

```
CPU Request: 1000m    CPU Limit: 500m
```

**Handling**:
- This is a **Kubernetes misconfiguration** — the pod will fail validation and won't be created in most cases
- If the data somehow shows this, flag it:
  - Severity: **RED**
  - Message: `"MISCONFIGURATION — CPU request (1000m) exceeds CPU limit (500m). Kubernetes will reject this pod spec. Fix immediately."`
  - Both request and limit recommendations should flag this

### Case F: No Usage Data Available

```
CPU Request: 500m    CPU Limit: 1000m
Actual CPU Usage: 0 or null
```

**Handling**:
- All recommendations return severity: **GRAY**
- Status: `no-data`
- Message: `"No CPU usage data available for this workload. It may be newly deployed, scaled to zero, or not emitting metrics. Check Dynatrace agent status."`
- `ratio: null`
- `suggestedValue: null`

### Case G: Very Low Usage (Near Zero)

```
CPU Request: 500m    CPU Limit: 1000m
Actual CPU Peak: 2m   Actual CPU Median: 0.5m
```

**Handling**:
- Ratio = 2/500 = 0.004 (0.4%)
- This is a real scenario for idle/low-traffic services
- Request recommendation: RED "extremely over-provisioned"
- BUT we add a safety note: `"Usage is near-zero (2m peak). Verify this workload is active and receiving traffic before downsizing. If it's intentionally idle, consider minimum viable requests (e.g., 10m CPU, 32Mi memory)."`
- Suggested values have a minimum floor:
  - CPU: never suggest less than **10m**
  - Memory: never suggest less than **32Mi**

### Case H: Extremely Bursty Workload (Large Gap Between Median and Peak)

```
CPU Request: 200m    CPU Limit: 500m
Actual CPU Median: 30m    Actual CPU Peak: 450m
```

**Handling**:
- Median-to-peak ratio: 450/30 = 15x burst factor
- Request ratio: 450/200 = 2.25 -> RED "under-provisioned"
- Limit ratio: 450/500 = 0.90 -> YELLOW "tight limit"
- Special burst detection: When `peak / median > 5`:
  - Add advisory message: `"Highly bursty workload detected (peak is {X}x median). Consider: (1) HPA to autoscale replicas during bursts, (2) Setting request based on median and limit based on peak, (3) Investigating if bursts are legitimate traffic or pathological behavior."`

### Case I: Memory-Only Configuration (CPU has no requests/limits)

```
CPU Request: null    CPU Limit: null
Memory Request: 256Mi Memory Limit: 512Mi
```

**Handling**:
- CPU evaluations follow Case A (no request/no limit)
- Memory evaluations follow normal ratio logic
- Overall status: worst of all four dimensions

### Case J: Request Set to 0 (Explicit Zero)

```
CPU Request: 0m    CPU Limit: 500m
```

**Handling**:
- Treat explicit 0 the same as null/not-set for request evaluation
- Severity: **RED**
- Message: `"CPU request is explicitly set to 0 — equivalent to no request. Pod gets no guaranteed CPU time under contention."`
- Division by zero safety: when configured value is 0, ratio = null (not Infinity)

---

## 8. Overall Workload Status

Each workload gets an `overallStatus` derived from the worst (highest severity) of its four recommendations:

```
overallStatus = worst(
  cpuRequestRecommendation.severity,
  cpuLimitRecommendation.severity,
  memoryRequestRecommendation.severity,
  memoryLimitRecommendation.severity
)
```

**Severity ranking** (worst to best):
1. **RED** — Immediate action needed
2. **YELLOW** — Improvement recommended
3. **GREEN** — Healthy
4. **GRAY** — Insufficient data

**Mapping to status**:
- Any RED -> `over-provisioned` or `under-provisioned` (whichever the RED recommendation indicates)
- All YELLOW, no RED -> `over-provisioned` or `under-provisioned`
- All GREEN -> `optimal`
- All GRAY -> `no-data`

---

## 9. Waste Estimation

For the summary cards, we calculate total estimated waste across all workloads:

### CPU Waste (millicores)
```
For each workload where cpuRequests > suggestedCpuRequest:
  cpuWaste += cpuRequests - suggestedCpuRequest

Only count over-provisioned workloads (status == 'over-provisioned').
Skip workloads with no data or under-provisioned workloads.
```

### Memory Waste (bytes)
```
For each workload where memoryRequests > suggestedMemoryRequest:
  memoryWaste += memoryRequests - suggestedMemoryRequest

Same filtering as CPU.
```

### Display
- CPU waste shown as: `"4,200m (~4.2 cores)"` — both millicores and core equivalent
- Memory waste shown as: `"2.5 Gi"` — human-readable byte format

---

## 10. Detailed Examples

### Example 1: Healthy, Well-Sized Workload

```
Workload: payment-service
Namespace: production

CPU Request: 250m     CPU Limit: 500m
Memory Request: 256Mi Memory Limit: 512Mi

CPU Median: 150m     CPU Peak: 200m
Memory Median: 180Mi Memory Peak: 220Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Message |
|-----------|-------|----------|---------|
| CPU Request | 200/250 = 0.80 | GREEN | Well-sized — peak usage is 80% of request. |
| CPU Limit | 200/500 = 0.40 | GREEN | Well-sized — peak usage is 40% of limit. Good headroom for bursts. |
| Memory Request | 220/256 = 0.86 | GREEN | Tightly sized — peak usage is 86% of request. Monitor for growth. |
| Memory Limit | 220/512 = 0.43 | GREEN | Well-sized — peak usage is 43% of limit. Good headroom for bursts. |

**Overall**: GREEN - optimal
**Waste**: None

---

### Example 2: Massively Over-Provisioned Workload

```
Workload: legacy-api
Namespace: production

CPU Request: 2000m (2 cores)   CPU Limit: 4000m (4 cores)
Memory Request: 2Gi            Memory Limit: 4Gi

CPU Median: 50m      CPU Peak: 120m
Memory Median: 150Mi Memory Peak: 200Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | 120/2000 = 0.06 | RED | 150m | CPU request is 16.7x peak usage — extremely over-provisioned. Wasting 1,850m. |
| CPU Limit | 120/4000 = 0.03 | RED | 180m | CPU limit is 33.3x peak usage — provides no meaningful constraint. Consider reducing to ~180m. |
| Memory Request | 200/2048 = 0.10 | RED | 240Mi | Memory request is 10.2x peak usage — extremely over-provisioned. Wasting ~1.8Gi. |
| Memory Limit | 200/4096 = 0.05 | RED | 304Mi | Memory limit is 20.5x peak usage — provides no meaningful constraint. Consider reducing to ~304Mi. |

**Overall**: RED - over-provisioned
**Waste**: CPU: 1,850m (~1.85 cores), Memory: ~1.8Gi

---

### Example 3: Under-Provisioned, Throttling Risk

```
Workload: api-gateway
Namespace: production

CPU Request: 100m    CPU Limit: 200m
Memory Request: 128Mi Memory Limit: 256Mi

CPU Median: 80m     CPU Peak: 190m
Memory Median: 100Mi Memory Peak: 240Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | 190/100 = 1.90 | RED | 230m | UNDER-PROVISIONED — peak usage exceeds request by 90%. Risk of CPU starvation under contention. Increase to at least ~230m. |
| CPU Limit | 190/200 = 0.95 | RED | 290m | CRITICAL — peak usage at 95% of limit. Active throttling likely. Increase to at least ~290m. |
| Memory Request | 240/128 = 1.88 | RED | 288Mi | UNDER-PROVISIONED — peak usage exceeds request by 88%. First to be evicted under node memory pressure. Increase to at least ~288Mi. |
| Memory Limit | 240/256 = 0.94 | RED | 368Mi | CRITICAL — peak usage at 94% of limit. OOMKill imminent on any spike. Increase to at least ~368Mi. |

**Overall**: RED - under-provisioned
**Waste**: None (under-provisioned, not wasting — but risking outages)

---

### Example 4: No Requests or Limits (BestEffort)

```
Workload: debug-tool
Namespace: development

CPU Request: null    CPU Limit: null
Memory Request: null Memory Limit: null

CPU Median: 20m     CPU Peak: 50m
Memory Median: 64Mi Memory Peak: 80Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | N/A | RED | 60m | No CPU request configured — pod is BestEffort QoS. Will be first evicted under pressure. Suggest setting request to ~60m. |
| CPU Limit | N/A | RED | 80m | No CPU limit configured — unbounded resource usage. Suggest setting limit to ~80m. |
| Memory Request | N/A | RED | 96Mi | No memory request configured — pod is BestEffort QoS. Will be first evicted under memory pressure. Suggest setting request to ~96Mi. |
| Memory Limit | N/A | RED | 128Mi | No memory limit configured — a memory leak can take down the node. Suggest setting limit to ~128Mi. |

**Overall**: RED - under-provisioned (BestEffort)
**Note**: QoS class = BestEffort. This workload has the lowest eviction priority in the cluster.

---

### Example 5: Bursty Workload (Large Median-to-Peak Gap)

```
Workload: batch-processor
Namespace: production

CPU Request: 200m    CPU Limit: 1000m
Memory Request: 512Mi Memory Limit: 1Gi

CPU Median: 30m     CPU Peak: 800m
Memory Median: 100Mi Memory Peak: 700Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | 800/200 = 4.0 | RED | 960m | UNDER-PROVISIONED — peak usage exceeds request by 300%. Under contention, this workload gets starved. Increase to at least ~960m. |
| CPU Limit | 800/1000 = 0.80 | YELLOW | 1200m | Limit is tight — peak usage is 80% of limit. Risk of throttling during bursts. |
| Memory Request | 700/512 = 1.37 | RED | 848Mi | UNDER-PROVISIONED — peak usage exceeds request by 37%. Risk of eviction under node memory pressure. Increase to at least ~848Mi. |
| Memory Limit | 700/1024 = 0.68 | GREEN | N/A | Well-sized — peak usage is 68% of limit. Good headroom for bursts. |

**Burst Advisory**: Highly bursty workload detected — CPU peak is 26.7x median, Memory peak is 7x median. Consider HPA autoscaling, or setting request closer to median and ensuring limit covers peak with headroom.

**Overall**: RED - under-provisioned

---

### Example 6: Guaranteed QoS (Request == Limit)

```
Workload: database-proxy
Namespace: production

CPU Request: 500m    CPU Limit: 500m
Memory Request: 1Gi  Memory Limit: 1Gi

CPU Median: 100m    CPU Peak: 150m
Memory Median: 400Mi Memory Peak: 600Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | 150/500 = 0.30 | YELLOW | 180m | CPU request is 3.3x peak usage — slightly over-provisioned. Could reduce to ~180m. |
| CPU Limit | 150/500 = 0.30 | YELLOW | 230m | CPU limit is 3.3x peak usage — generous. Could tighten to ~230m. |
| Memory Request | 600/1024 = 0.59 | GREEN | N/A | Well-sized — peak usage is 59% of request. |
| Memory Limit | 600/1024 = 0.59 | GREEN | N/A | Well-sized — peak usage is 59% of limit. Good headroom for bursts. |

**QoS Note**: This workload is Guaranteed QoS (request == limit). If you change request or limit independently, the QoS class will change to Burstable. To maintain Guaranteed QoS, change both values together.

**Overall**: YELLOW - over-provisioned (CPU)

---

### Example 7: Only Memory Configured, No CPU Config

```
Workload: sidecar-proxy
Namespace: istio-system

CPU Request: null    CPU Limit: null
Memory Request: 128Mi Memory Limit: 256Mi

CPU Median: 10m     CPU Peak: 25m
Memory Median: 80Mi Memory Peak: 100Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | N/A | RED | 30m | No CPU request configured. Suggest setting to ~30m. |
| CPU Limit | N/A | YELLOW | 40m | No CPU limit configured. Suggest setting to ~40m. |
| Memory Request | 100/128 = 0.78 | GREEN | N/A | Well-sized — peak usage is 78% of request. |
| Memory Limit | 100/256 = 0.39 | YELLOW | 150m | Memory limit is 2.6x peak usage — generous. Could tighten to ~150Mi. |

**Overall**: RED (due to missing CPU request)

---

### Example 8: Zero/Near-Zero Usage

```
Workload: canary-deploy
Namespace: staging

CPU Request: 500m    CPU Limit: 1000m
Memory Request: 512Mi Memory Limit: 1Gi

CPU Median: 0.5m    CPU Peak: 2m
Memory Median: 10Mi Memory Peak: 15Mi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | 2/500 = 0.004 | RED | 10m* | CPU request is 250x peak usage — extremely over-provisioned. |
| CPU Limit | 2/1000 = 0.002 | RED | 10m* | CPU limit is 500x peak usage — provides no meaningful constraint. |
| Memory Request | 15/512 = 0.03 | RED | 32Mi* | Memory request is 34x peak usage — extremely over-provisioned. |
| Memory Limit | 15/1024 = 0.01 | RED | 48Mi* | Memory limit is 68x peak usage — provides no meaningful constraint. |

*Minimum floor applied: CPU suggested never goes below 10m, Memory never below 32Mi.

**Near-Zero Advisory**: Usage is near-zero. Verify this workload is active and receiving traffic before downsizing. If it's intentionally idle, consider minimum viable settings (10m CPU / 32Mi memory).

**Overall**: RED - over-provisioned

---

### Example 9: Misconfigured (Request > Limit)

```
Workload: broken-deploy
Namespace: development

CPU Request: 1000m   CPU Limit: 500m
Memory Request: 1Gi  Memory Limit: 512Mi

CPU Peak: N/A (pod likely can't schedule)
Memory Peak: N/A
```

**Analysis**:
| Dimension | Ratio | Severity | Message |
|-----------|-------|----------|---------|
| CPU Request | N/A | RED | MISCONFIGURATION — CPU request (1000m) exceeds CPU limit (500m). Kubernetes will reject this pod spec. |
| CPU Limit | N/A | RED | MISCONFIGURATION — CPU limit (500m) is less than CPU request (1000m). Fix immediately. |
| Memory Request | N/A | RED | MISCONFIGURATION — Memory request (1Gi) exceeds memory limit (512Mi). Kubernetes will reject this pod spec. |
| Memory Limit | N/A | RED | MISCONFIGURATION — Memory limit (512Mi) is less than memory request (1Gi). Fix immediately. |

**Overall**: RED - misconfigured

---

### Example 10: Only Limits Set, No Requests

```
Workload: worker-pool
Namespace: production

CPU Request: null    CPU Limit: 2000m
Memory Request: null Memory Limit: 2Gi

CPU Median: 500m    CPU Peak: 1200m
Memory Median: 800Mi Memory Peak: 1.2Gi
```

**Analysis**:
| Dimension | Ratio | Severity | Suggested | Message |
|-----------|-------|----------|-----------|---------|
| CPU Request | N/A | RED | 1440m | No CPU request configured — scheduler has no capacity awareness. Under contention, gets no guaranteed CPU. Suggest setting request to ~1440m. |
| CPU Limit | 1200/2000 = 0.60 | GREEN | N/A | Well-sized — peak usage is 60% of limit. Good headroom for bursts. |
| Memory Request | N/A | RED | 1440Mi | No memory request configured. Under node pressure, this pod is evicted first. Suggest setting request to ~1440Mi. |
| Memory Limit | 1228/2048 = 0.60 | GREEN | N/A | Well-sized — peak usage is 60% of limit. Good headroom for bursts. |

**Overall**: RED (missing requests despite healthy limits)
**Note**: Limits are well-configured, but without requests, Kubernetes can't make informed scheduling decisions and the pod gets low eviction priority.

---

## 11. Severity Color Reference

| Color | Hex Code | Background (10% opacity) | Meaning |
|-------|----------|-------------------------|---------|
| GREEN | `#4caf50` | `rgba(76, 175, 80, 0.1)` | Healthy / well-sized |
| YELLOW | `#ff9800` | `rgba(255, 152, 0, 0.1)` | Improvement recommended |
| RED | `#ee3d48` | `rgba(238, 61, 72, 0.1)` | Immediate action needed |
| GRAY | `#b4b4be` | `rgba(180, 180, 190, 0.1)` | Insufficient data |

---

## Summary of Decision Thresholds

### Request Thresholds
```
         0%    10%    30%    50%    85%   100%        >100%
         |------|------|------|------|------|-----------|
         | RED  | RED  |YELLOW|     GREEN    |   RED    |
         |extreme|over |slight| optimal/tight| UNDER    |
```

### Limit Thresholds
```
         0%    15%    40%          80%    95%    100%
         |------|------|-----------|------|------|
         | RED  |YELLOW|   GREEN   |YELLOW| RED  |
         |over  |over  |  optimal  |tight |CRIT  |
```

### Minimum Suggested Value Floors
- CPU: 10m
- Memory: 32Mi

### Headroom Multipliers
- Requests: peak * 1.20 (20% headroom)
- Limits: peak * 1.50 (50% headroom)
