# SignalShift AI — UI/UX Specification

Version: 1.0 · Date: 16 October 2026 · Target: desktop Chrome MVP

## 1. Experience principles
Make the current question and analysis state obvious. Separate a concern from uncertainty and a technical failure. Explain the next useful action. Never imply that an enrolled voice establishes legal identity or that a passing sample proves honesty. Preserve the candidate's ability to pause or withdraw consent.

## 2. Information architecture
1. Create interview: title, question list, create button.
2. Interviewer lobby: invite link, candidate status, device checks, enrollment status.
3. Candidate lobby: privacy notice, consent, device preview, enrollment prompt.
4. Interview room: videos, current question, analysis panel, timeline, call controls.
5. Recheck panel: reason, prompt, capture progress, returned result, next action.
6. Session summary: question outcomes, reviewed/unresolved concerns, gaps, export.

## 3. Desktop layout
Design for a 1280×800 viewport while allowing scrolling at smaller laptop heights. On wide screens, use approximately two-thirds width for video/current question and one-third for analysis. Keep call controls fixed within the room container without hiding content.

```text
┌ Session title · Call connected · Analysis active ──────────┐
│ Candidate video       │ Speaker check                     │
│                       │ Synthetic-speech check             │
│ Interviewer thumbnail │ Last analyzed interval             │
│───────────────────────│────────────────────────────────────│
│ Current question      │ Question-linked timeline           │
│ Next question         │ Review / Recheck                   │
├ Mic · Camera · Pause analysis · End session ───────────────┤
└ Coverage and network status                               ┘
```

Below 900px, stack the panel beneath the video. Mobile joining may work through the SDK but is not a validated MVP promise. Do not block the demo merely because a smaller viewport is used; show a desktop recommendation when needed.

## 4. Screen specifications
### Create interview
Fields: session title (optional default), ordered question list with at least one question. Primary action: “Create interview.” On success, show “Copy candidate link” and “Enter interviewer room.” Never display provider secrets or internal speaker IDs as product content.

### Candidate consent and enrollment
Notice explains purpose, vendor destinations, what is captured, temporary handling, and limitations. Consent is an unchecked checkbox with a clear label, separate from browser permissions. Actions: “Agree and continue” and “Leave.”

Enrollment shows an ordinary introductory prompt, elapsed recording time, microphone activity, and “Stop and submit.” Target 20–30 seconds; show a reminder to speak continuously. An activity meter indicates sound level only, not speech validity. Actual API acceptance determines readiness. During enrollment display “Creating voice reference…” rather than a fabricated percent.

### Interview room
Two status indicators: call connection and analysis availability. They must not share a single green badge. The analysis panel has independent rows for “Speaker comparison” and “Synthetic speech.” Each result labels its interval; an old passing result must not look like a current check.

Question navigation has “Start question” and “Next question.” When an answer is flagged, show “Review needed” beside the question. Moving on does not clear the flag. The interviewer may continue while keeping it unresolved.

### Recheck
Show the observed reason and a fresh prompt. Buttons: “Start recheck,” “Cancel,” and after completion, “Repeat affected question” or “Continue with unresolved flag.” A passing recheck says “Current sample passed both checks. Earlier answer still needs review.” A failed/incomplete recheck offers another sample or continued human review, not automatic termination.

### Summary
List each question with capture coverage, result history, and disposition. Display unresolved issues first, then reviewed issues and remaining questions. “Export session summary” produces a sanitized JSON file. “Clear local summary” removes browser metadata; vendor enrollment deletion status must be described separately.

## 5. State language and visual treatment
| State | Label | Treatment |
|---|---|---|
| Both checks pass | Checks passed for 00:24–00:32 | Muted green icon plus text |
| Speaker mismatch | Voice differs from enrolled reference | Amber review badge |
| Synthetic classification | Possible synthetic speech detected | Amber/red concern with explanation |
| not_sure | Could not assess this sample reliably | Neutral/amber, recapture action |
| Processing | Analyzing 00:32–00:40 | Spinner with elapsed delay |
| API failure | Analysis unavailable | Neutral error, retry/status action |
| Muted/gap | No analysis for this interval | Gray gap on timeline |

Never use “Fraudster,” “Cheater,” “Identity proven,” or “100% genuine.” Avoid displaying similarity as a percentage. Raw scores, if exposed, belong in an expandable technical details section with their semantics.

## 6. Timeline behavior
Each row contains question label, capture start/end, returned outcome, and optional recheck link. Use capture time for positioning and response time only for latency details. Mark partial failures and unprocessed intervals explicitly. Result arrival can update a prior row without moving it to the current question.

The timeline represents sampled analysis, not an exact timestamp at which manipulation began. Vendor segment scores may later support more detailed display, but do not infer precise onset from a window verdict.

## 7. Accessibility and interaction
Target WCAG AA contrast, keyboard-accessible controls, visible focus, explicit labels, and minimum practical 44px touch targets. Never convey state by color alone. Announce important status changes politely through aria-live; do not announce every level-meter update. Modals trap focus and return it to their trigger. Support reduced motion. Do not claim WCAG conformance without testing.

## 8. Feedback and empty states
Empty timeline: “Results will appear after the first audio segment is analyzed.” No candidate: “Waiting for candidate.” No reference: “Voice reference required before monitoring.” Reconnecting: retain the timeline but mark capture paused. Ending: show cleanup progress and any vendor deletion failure accurately.

## 9. Visual style
Use a restrained navy/slate foundation, light surfaces, clear type hierarchy, and one primary accent. Use Tailwind tokens and shadcn/ui components for consistent spacing and states. Prioritize readable results over animated dashboards. No stock accuracy statistics, fake waveform evidence, or decorative risk gauges.

## 10. UI acceptance
A judge should identify the active question, which interval was checked, why an answer needs review, and the next action without reading a technical explanation. Validate keyboard access, permission denial, pending states, and overflow with realistic question text.
