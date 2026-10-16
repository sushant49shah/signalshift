# SignalShift AI — Implementation Roadmap

Version: 1.0 · Date: 16 October 2026 · Baseline: five hours from implementation start

## 1. Delivery strategy
Build the highest-risk integrations first, then the workflow that makes the project distinctive. The five-hour schedule is a target, not a completion promise. It does not assume time spent brainstorming/documenting remains available. Confirm the actual submission deadline before starting and compress optional scope accordingly.

The critical path is: credentials and quotas → API proof → remote candidate audio → valid windows → result normalization → question-linked review → recheck → deployment/demo.

## 2. First five hours
| Elapsed time | Work | Exit evidence |
|---|---|---|
| 00:00–00:45 | Bootstrap app; verify provider accounts; inspect enrollment/OpenAPI schemas; real enrollment/combined request; minimal two-browser LiveKit track experiment; deploy skeleton | Genuine API response, accessible app, candidate track can be identified |
| 00:45–01:45 | Build room creation/join, scoped tokens, consent, reference recording, two-person video and basic questions | Two devices can join and establish a valid reference |
| 01:45–03:00 | Capture remote PCM, encode complete WAVs, bounded queue, server analysis route, normalize partial responses, timestamped timeline | Real candidate segments return both checks; errors remain visible |
| 03:00–04:00 | Answer review states, recheck capture, explicit dispositions, basic summary, cleanup, critical authorization checks | Complete concern/recovery workflow with retained original evidence |
| 04:00–05:00 | Run P0 tests, fix blockers, verify deployment limits, rehearse real demo, finish five slides and submission | Working accessible link, honest demo, correctly ordered deck |

Security controls are built alongside their endpoints, not postponed to the last hour. Deploy early to discover microphone, upload, and function limits before the final checkpoint.

## 3. Go/no-go decisions
### At 45 minutes
Need actual DetectifAI request success and evidence that LiveKit exposes the candidate track. If API credentials/schema fail, debug with a small request before UI work. If remote track capture fails, stop decorative work and solve that integration. A local microphone diagnostic can isolate faults but does not fulfill the video-call analysis requirement.

### At 2 hours
Need real two-person call and enrollment. If behind, remove custom layouts, animated meters, question editing sophistication, and export before dropping core integration.

### At 3 hours
Need real segment analysis with correct uncertainty behavior. If provider latency is high, shorten backlog, show delay/gaps, and consider per-answer capture as a clearly disclosed reduced-frequency mode. Never label delayed or sampled checks continuous coverage.

### At 4 hours
Freeze new features. Prioritize deployment, P0 defects, explanation of actual behavior, and submission. A missing feature stays documented as missing; do not replace it with silent simulation.

## 4. Work packages
| Package | Responsibility | Dependency |
|---|---|---|
| App/media | UI, room flow, candidate-track capture | LiveKit credentials |
| API/domain | Enrollment, combined check adapter, normalization, session bindings | DetectifAI access |
| Validation/presentation | Consented test inputs, two-device checks, slide narrative, submission | Running increments |

These are work areas for the existing team, not assumptions about team size or automatic delegation. AI-assisted implementation still requires team members to understand and explain the product. Disclose tools on the DetectifAI slide as required.

## 5. Scope ladder
**Must deliver:** video call, consent, real enrollment, actual candidate-audio checks, clear incomplete states, question-linked concerns, recheck, accessible deployment.

**Keep simple:** predefined questions/prompts, one candidate/interviewer, desktop Chrome, session-only metadata, readable fixed layout.

**Cut first:** waveform animation, score charts, PDF report export, themes, account dashboards, analytics, transcription, email invitations, editable branding.

**Do not claim:** video manipulation detection, exact attack-onset timestamps, guaranteed liveness, legal identity, instant response, zero vendor retention, production readiness, or automatic cheating detection.

## 6. Submission package
Prototype link must open without account login. Judges may create a fresh demo session; this does not mean API endpoints are unauthenticated. Verify on a clean browser and separate device.

Exactly five slides:
1. **Problem:** one interviewer, one mid-interview impersonation concern, affected answer.
2. **Solution:** live call → check → review → recovery.
3. **DetectifAI:** both APIs, integration point, decision logic, actual tools used.
4. **Impact:** what the workflow enables; measured demo observations only, no invented fraud-reduction statistics.
5. **Scale:** plausible customer/adoption hypothesis, costs to validate, and specific Day 2 plan.

Include a short demo script and permitted input provenance. Do not contact judges outside official sessions. All team members should explain the use case, API role, limitations, and their contribution.

## 7. Day 2 plan: up to nine hours, conditional on qualification
| Time | Improvement | Expected evidence |
|---|---|---|
| First 2h | Address actual judge feedback and Day 1 failures | Reproduced issues fixed |
| Next 2h | Harden reconnect, queue/backpressure, silence and partial-result handling | Expanded failure tests |
| Next 2h | Add shared session store for consent revocation/cleanup and stronger limits if warranted | Server-enforced lifecycle tests |
| Next 1.5h | Evaluate more permitted audio conditions; improve uncertainty explanations | Small, clearly scoped results table |
| Final 1.5h | Rehearse, update deck, regression-test deployed version | Reliable final demonstration |

Prefer deeper DetectifAI integration and measured reliability over adding unrelated AI features. Do not promise video deepfake detection on Day 2 without a validated provider and adequate implementation time.

## 8. Post-hackathon roadmap
1. Interview actual recruiters/candidates and validate whether answer-level review solves a meaningful problem.
2. Confirm permission/commercial terms for DetectifAI use after the event; hackathon access is not ongoing production authorization.
3. Add authenticated tenants, durable revocation, role-based records, reliable deletion jobs, and retention controls.
4. Evaluate accuracy and false-positive behavior on representative consented audio; define limitations and human escalation.
5. Review privacy, accessibility, security, and consequential-use risks before a real hiring pilot.
6. Measure per-interview provider cost, latency, room usage, and support burden before pricing.

## 9. Definition of done
All P0 tests executed and passing or prominently disclosed as unmet; no secret leakage; real two-device media and API demonstration; correct review/recheck behavior; known gaps visible; five-slide deck correct; prototype link verified; no fabricated results or unsupported performance claims.

These seven documents are the implementation baseline. No application code, deployment, test completion, provider account configuration, or submission is implied by their creation.
