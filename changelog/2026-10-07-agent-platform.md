# Agent platform rollout notes, 6–7 October 2026

These records were previously embedded in the README and platform guide. They
describe checks and activation on the maintained host at that time, not current
service status or acceptance of a new installation. For current procedures, see
[platform verification and recovery](../docs/agent-platform.md#verification).

## VPN acceptance on 6 October

The maintained host passed simultaneous GB/NL egress, unprivileged DNS, failure
blocking, IPv6 blocking, certificate renewal and browser country switching on
6 October 2026. Repeat live account tests before claiming readiness for another
installation.

## Reliability corrections on 7 October

These records concern the platform guide's [audit corrections](../docs/agent-platform.md#audit-reliability-corrections),
[lifecycle recovery](../docs/agent-platform.md#lifecycle-failure-recovery) and
[input, frame and cleanup safeguards](../docs/agent-platform.md#input-frame-and-cleanup-safeguards).

The audit corrections were loaded on the maintained host on 7 October 2026 after isolated regression checks and an idle service restart. Runtime state and configuration were backed up first. Existing accumulated blank tabs are not automatically removed because they may be intentional.

The lifecycle and route-validation corrections were deployed on the maintained host on 7 October 2026 after a fresh runtime backup and a restart with zero active sessions. Live checks verified the updated schema and rejection of malformed requests on route variants without creating production state.

These subprocess/recovery corrections were deployed on the maintained host on 7 October 2026 after 33 platform tests, MCP packaging/contract checks, a runtime backup and an idle restart. Health and authenticated Proton readiness passed afterward. Signal and PID-reuse regressions use isolated fake helpers; live tunnel-failure acceptance was not repeated for this patch.

The input, iframe, download-deletion and networking-helper safeguards were deployed on the maintained host on 7 October 2026 with zero active sessions. Verification covered 40 platform tests (including eight mocked Python helper cases), 883 upstream unit tests with two existing skips, MCP packaging and contract checks, disposable native-browser reproductions, and real blocking/deletion of a disposable WireGuard namespace with no peers or host routes. Production health, updated API metadata and authenticated Proton readiness passed after helper installation and service restart. Live multi-country VPN failure/renewal acceptance was not repeated; no browser version or database schema changed.

The checkpoint/VPN lifecycle corrections were deployed on the maintained host on 7 October 2026 after 48 platform tests, MCP packaging/contract checks, skill validation and a disposable native-browser test with 20 overlapping checkpoint requests. An idle runtime backup passed SQLite integrity checking; gateway health and authenticated Proton readiness passed after restart. Renewal/disconnect races were verified with real disposable subprocesses and fake networking helpers. Live multi-country egress and tunnel-failure acceptance were not repeated for this patch. No browser, database schema or installed privileged helper changed.
