# Offline Synchronization Plan

This document outlines the offline synchronization architecture for the Gym Management SaaS platform, focusing on the edge agent's ability to operate independently and sync with the cloud.

## Consistency Model
- **Edge as eventually consistent replica**: The edge agent maintains a local snapshot of eligibility data and queues events for upload.
- **Cloud as source of truth**: The cloud services are the authoritative source for membership, payments, and configuration.
- **Sync protocol**: Eventual consistency with conflict detection and resolution mechanisms.
- **Data ownership**:
  - Edge: local event queue, eligibility cache, device state, sync metadata.
  - Cloud: master membership data, financial transactions, configuration, master event log.
## Synchronization Protocol
- **Initiation**:
  - Edge-triggered: when connectivity is available and there are events to upload or eligibility updates pending.
  - Cloud-triggered: rare, for pushing urgent configuration changes (via push notification to edge agent).
- **Batch processing**:
  - Events grouped by type and time window for efficiency.
  - Maximum batch size configurable (e.g., 1000 events) to manage memory and transmission time.
  - Each batch assigned a unique batch ID for idempotency and tracking.
- **Data exchange**:
  - Edge → Cloud: biometric events, access decisions, device health metrics.
  - Cloud → Edge: eligibility snapshots, configuration updates, blocklists, notification overrides.
- **Idempotency**:
  - Each event from edge includes a unique event ID (UUID) and organization ID.
  - Cloud maintains an inbox of processed event IDs per organization to prevent duplicate processing.
  - Edge includes the last successfully synced cursor (timestamp or transaction ID) to resume from where it left off.
- **Acknowledgment**:
  - Cloud responds to each batch with a sync receipt containing:
    - Number of events processed
    - Number of duplicates ignored
    - Any errors encountered
    - Next recommended cursor for edge
## Conflict Detection and Resolution
### Types of Conflicts
1. **Duplicate Events**: Same event (device_id, event_time, member_id) received more than once.
2. **Eligibility Mismatch**: Edge granted access based on local eligibility, but cloud shows member was ineligible at event time.
3. **Clock Skew**: Edge device time significantly differs from cloud time, causing ordering issues.
4. **State Divergence**: Edge and cloud have different versions of member eligibility or configuration.

### Detection Mechanisms
- **Duplicate detection**: Unique constraint on (device_id, event_time, member_id) in cloud database with second-level precision.
- **Eligibility mismatch**: During sync, cloud checks eligibility at event time against edge's decision.
- **Clock skew**: Edge reports its clock in sync request; cloud compares with its own time and rejects if beyond threshold (e.g., 5 minutes).
- **Sequence gaps**: Edge uploads events with increasing sequence numbers per device; cloud detects gaps.

### Resolution Strategies
- **Duplicates**: Automatically ignored by cloud; edge may retain until acknowledged.
- **Eligibility mismatch**:
  - If edge granted access but cloud says ineligible: treat as security event, log, and optionally notify.
  - If edge denied access but cloud says eligible: no action needed (err on side of denial), but log for investigation.
- **Clock skew**: 
  - Edge adjusts its clock via NTP if skew is consistent.
  - For one-off events, cloud may adjust event time using known skew if within limits.
- **State divergence**:
  - Eligibility: cloud wins; edge updates eligibility cache on next sync.
## Handling Offline Scenarios
### Scenario 1: Edge Agent Offline at Event Time
- Event captured by device and stored in edge agent's local queue (SQLite).
- Edge agent timestamps event with local clock.
- When connectivity restored, event uploaded with original timestamp.
- Cloud validates eligibility at event time using historical data.

### Scenario 2: Membership Change While Offline
- Member renews membership or adds package while edge agent is offline.
- Edge agent continues to use last known eligibility snapshot.
- Upon sync, cloud sends updated eligibility snapshot.
- Edge agent updates local cache and adjusts future access decisions.
- Past events processed during outage are validated against eligibility at event time (which may have been incorrect).

### Scenario 3: Device Clock Drift
- Edge agent uses NTP to synchronize with internet time servers when available.
- If no internet, edge agent relies on its internal clock but logs drift relative to cloud during sync.
- Cloud may reject events with timestamps too far in past/future (configurable window, e.g., ±15 minutes).

### Scenario 4: Network Flapping (Intermittent Connectivity)
- Edge agent attempts sync on each connectivity detection.
- Uses exponential backoff for failed attempts to avoid overwhelming network.
- Local queue grows until connectivity stabilizes.

### Scenario 5: Local Storage Failure (Edge Agent)
- Edge agent uses SQLite with journaling mode WAL for crash safety.
- On startup, checks database integrity and recovers if needed.
- Regular backups of eligibility cache and queue to local storage (rotating backups).
- If database corrupted, edge agent can reinitialize eligibility cache from cloud (requires connectivity).

### Scenario 6: Partial Synchronization (Interrupted Sync)
- Sync process is atomic at batch level: either entire batch processed or none.
- If sync interrupted mid-batch, cloud does not acknowledge, edge retries entire batch.
- Edge tracks last successfully synced batch and resumes from next.

### Scenario 7: Conflicting Updates from Multiple Edge Agents
- Rare, as each gym location has its own edge agent.
- If same member visits multiple branches while offline at each:
  - Each edge agent makes independent access decisions based on local eligibility.
  - Cloud detects eligibility mismatches per event and logs.
  - No automatic correction; audit trail shows discrepancies.

### Scenario 8: Cloud Downtime During Sync Window
- Edge agent retries with exponential backoff.
- After max retries, alerts local administrator via edge agent UI or local alarm.
- Continues to operate using last known eligibility and queues events.

### Scenario 9: Malicious or Corrupted Data from Device
- Edge agent validates event format and ranges (e.g., timestamp not in future, device ID known).
- Discards invalid events locally and logs.
- Cloud performs similar validation and discards invalid batches.
  - Configuration: cloud wins; edge overwrites local config.
  - In case of conflicting updates (rare), last-write-wins based on timestamp.
  - Edge marks events as synced only after receiving successful acknowledgment.
- **Error handling**:
  - Transient errors (network, temporary cloud unavailability): retry with exponential backoff.
  - Persistent errors (invalid data, schema mismatch): alert and require manual intervention.
## Data Retention and Pruning
- **Edge agent**:
  - Events: retained locally until acknowledged by cloud, then deleted after grace period (e.g., 24 hours).
  - Eligibility cache: entries expired after configurable time (e.g., 4 hours) to force resync.
  - Sync metadata: last sync cursor retained indefinitely to enable incremental sync.
- **Cloud**:
  - Events: retained permanently for audit and compliance.
## Security Considerations
- **Communication security**:
  - All edge-cloud communication over mutual TLS (mTLS).
  - Edge agent and cloud authenticate each other using certificates.
  - Certificate pinning to prevent man-in-the-middle attacks.
- **Data integrity**:
  - Events signed by edge agent using organization-specific key (optional, for high security).
  - Cloud verifies signature before processing.
  - Alternatively, rely on mTLS channel security.
- **Replay protection**:
## Performance and Scalability
- **Sync frequency**:
  - Typical: every 5 minutes when there is activity.
  - Adjustable based on connectivity cost and data volume.
  - Immediate sync for high-priority events (e.g., security alerts) if needed.
- **Bandwidth usage**:
  - Average: < 50 kbps per edge agent (mostly eligibility snapshots and small event batches).
  - Peak: up to 5 Mbps during bulk sync after extended outage (for large gym).
## Monitoring and Alerting
- **Metrics**:
  - Sync lag: time since last successful synchronization.
  - Queue depth: number of events waiting to be uploaded.
  - Sync success rate: percentage of successful sync attempts.
  - Average batch size and sync duration.
- **Alerting**:
  - High sync lag (> 15 minutes): possible connectivity issue.
  - Repeated sync failures: persistent network or cloud issue.
  - Unexpectedly large batches: possible device misbehavior or burst of events.
## Implementation Details
- **Edge agent components**:
  - Sync manager: orchestrates sync cycles, handles retries and backoff.
  - Outbox queue: SQLite table storing events to be uploaded.
  - Inbox tracking: SQLite table of processed event IDs from cloud (for cloud-to-edge messages).
  - Eligibility cache: SQLite table of member eligibility with expiration timestamps.
  - Health reporter: collects and sends metrics to cloud.
- **Cloud components**:
  - Sync ingest API: REST endpoint for receiving batches from edge agents.
  - Eligibility export service: generates eligibility snapshots for organizations.
  - Conflict detector: analyzes sync batches for eligibility mismatches and duplicates.
  - Sync status tracker: stores last sync time, status, and metrics per edge agent.
- **Data formats**:
  - JSON for all HTTP payloads.
  - Protobuf considered for internal edge-agent communication if performance critical.
  - SQLite schemas versioned with migration scripts.

## Testing and Validation
- **Unit testing**:
  - Sync manager: batch formation, idempotency, retry logic.
  - Conflict detection: eligibility mismatch, duplicate detection.
- **Integration testing**:
  - End-to-end sync: edge offline → event collection → sync → cloud processing → acknowledgment.
  - Conflict scenarios: inject eligibility mismatches, duplicates, clock skew.
- **Chaos testing**:
  - Network latency and packet loss injection.
  - Sudden disconnect during sync.
  - Cloud service restarts during edge upload.
- **Field testing**:
  - Pilot deployment with intentional offline periods.
  - Validation of event accuracy and conflict resolution.
  - Measurement of sync bandwidth and battery impact (if on battery-backed hardware).

--- 

*Document Version: 1.0*
*Last Updated: 2026-09-01*
  - Sync eligibility mismatches: potential security or data drift issue.
- **Logging**:
  - Structured logs for all sync activities, errors, and warnings.
  - Local logs rotated and retained for debugging.
  - Optional remote logging to cloud for diagnostics.
- **Latency**:
  - Sync latency: time from event to cloud receipt depends on sync interval and network.
  - For real-time access decisions, edge acts locally; sync is for audit and central reporting.
- **Scalability**:
  - Horizontal: add more edge agents per location for redundancy.
  - Vertical: upgrade edge agent hardware for higher device counts or complex rules.
  - Each batch includes a nonce or timestamp to prevent replay attacks.
  - Cloud tracks recent nonces per edge agent to detect replays.
- **Access control**:
  - Edge agent can only sync with its assigned organization's cloud endpoints.
  - Cloud validates that incoming events belong to the edge agent's organization.
- **Secure storage**:
  - Edge agent uses encrypted SQLite (SQLCipher) for local queue and eligibility cache.
  - Encryption key derived from device-specific secret and organization provisioning data.
  - Eligibility snapshots: retained for debugging and reconciliation (e.g., 30 days).
  - Sync logs: retained for operational monitoring (e.g., 90 days).
  - Sequence violations: detect gaps in event sequencing and request retransmission if needed.