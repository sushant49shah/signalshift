PROJECT: SignalShift AI
TASK: Enhance the existing Candidate and Interviewer interfaces
TYPE: Existing project modification
PRIORITY: HIGH
GOAL: Complete a functional hackathon prototype

You are an experienced full-stack engineer specializing in
real-time applications, AI integrations, and modern SaaS interfaces.

I have already developed a working foundation for SignalShift AI,
an interview integrity platform that uses LiveKit for video
communication and DetectifAI for speaker verification and
synthetic-speech detection.

IMPORTANT:

THIS IS AN EXISTING PROJECT.

DO NOT CREATE A NEW WEBSITE.
DO NOT REBUILD THE APPLICATION FROM SCRATCH.
DO NOT REPLACE THE EXISTING DESIGN.
DO NOT REMOVE EXISTING FEATURES.
DO NOT BREAK THE CURRENT LIVEKIT OR DETECTIFAI INTEGRATION.

Your responsibility is to inspect the existing codebase,
identify what is already implemented, and add the missing
features described below.

====================================================
1. EXISTING APPLICATION
====================================================

The website currently contains three primary interfaces.

A. LANDING PAGE

Current elements:

- SignalShift AI branding.
- "Get started" button.
- Create interview form.
- Optional demo access code.
- Consent-first workflow explanation.
- Voice continuity information.
- Synthetic-speech detection information.
- Human review explanation.

Keep this page substantially unchanged.

B. INTERVIEWER INTERFACE

Current elements:

Header:
- SignalShift AI branding.
- Test audio navigation.
- Interviewer navigation.
- New interview navigation.

Interview management:
- Invite candidate section.
- Candidate consent status.
- Candidate enrollment status.

Interview room:
- Two-person video interface.
- LiveKit connection status.
- Local and remote video areas.
- Join call button.
- End session button.

Candidate answer section:
- Interview question input.
- Maximum answer recording duration.
- Start answer capture button.
- Recording status.
- Candidate consent and enrollment indicators.

C. CANDIDATE INTERFACE

Current elements:

- Consent disclosure.
- Consent checkbox.
- Agree and join call button.
- Decline and leave button.
- Two-person interview room.
- Camera and microphone connection.
- Candidate consent status.
- Voice enrollment status.
- Voice reference recording workflow.

These interfaces already exist.

Preserve their layout, styling, branding, colors,
typography, and component structure.

====================================================
2. FIRST TASK: INSPECT THE EXISTING CODEBASE
====================================================

Before implementing anything:

1. Inspect the existing frontend structure.
2. Identify the backend framework.
3. Locate the LiveKit integration.
4. Locate the DetectifAI API integration.
5. Identify how interview sessions are created.
6. Identify how candidate invitation links work.
7. Identify how consent is stored.
8. Identify how voice enrollment is performed.
9. Identify how candidate audio is captured.
10. Identify how verification results are currently stored.
11. Identify existing API endpoints and database models.

Do not assume missing functionality without checking.

Reuse existing functions and components wherever possible.

Do not create duplicate implementations.

====================================================
3. CANDIDATE INTERFACE ENHANCEMENTS
====================================================

GOAL:

Improve the existing candidate experience without
redesigning the interface.

------------------------------------
FEATURE 1: CONSENT WORKFLOW
------------------------------------

The existing candidate interface already contains
a consent disclosure and checkbox.

Keep the existing UI.

Ensure:

- Consent is required before recording.
- The candidate cannot begin enrollment without consent.
- Consent status is synchronized with the interviewer.
- Consent status persists throughout the session.
- Declining consent prevents recording and verification.
- Withdrawal of consent stops future audio collection.

Do not request microphone recording before the
candidate has provided consent.

Use the existing consent workflow wherever possible.

------------------------------------
FEATURE 2: VOICE ENROLLMENT
------------------------------------

The candidate currently records a 25-second voice
reference for enrollment.

Keep this existing enrollment duration unless
the API integration requires a change.

Improve the enrollment experience.

Display:

1. Enrollment instructions.
2. Microphone permission status.
3. Recording timer.
4. Recording progress.
5. Processing status.
6. Enrollment success or failure.
7. Retry option.

Suggested status labels:

- Waiting for Enrollment
- Recording Voice Reference
- Processing Voice Reference
- Voice Enrollment Successful
- Enrollment Failed

When enrollment succeeds:

- Save the reference identifier through the backend.
- Update the candidate interface.
- Update the interviewer interface.
- Enable answer verification.

If enrollment fails:

- Show an understandable error.
- Allow the candidate to retry.
- Do not continue to verification without a valid reference.

IMPORTANT:

Reuse the existing DetectifAI enrollment implementation.

------------------------------------
FEATURE 3: INTERVIEW EXPERIENCE
------------------------------------

Keep the existing two-person LiveKit interview room.

Do not replace LiveKit.

Do not implement another video-calling service.

Improve the candidate experience by adding
a compact interview information section.

Display:

- Current question number.
- Current interview question.
- Interview status.
- Answer recording status.
- Recording timer when applicable.
- Verification processing status.

Example:

Question 2 of 5

"Explain a recent project you worked on."

Status: Waiting for interviewer

When the interviewer starts capturing an answer,
display:

"Your answer is being recorded for verification."

When processing:

"Your answer is being verified."

After processing:

"Verification completed."

The candidate should not see raw API scores.

Do not display technical accusations or
automatically disqualify the candidate.

------------------------------------
FEATURE 4: ANSWER RECORDING STATUS
------------------------------------

The interviewer currently controls answer capture.

Preserve this behavior.

The interviewer starts and stops the recording.

Only the candidate's remote microphone track
should be analyzed.

Do not accidentally capture the interviewer's
microphone audio.

The candidate should receive a visible indicator
when answer recording is active.

Display:

- Recording started
- Recording in progress
- Recording completed
- Verification processing
- Verification completed
- Recording failed

The recording indicator must reflect the actual
recording state.

Do not show recording as active when capture
has not successfully started.

------------------------------------
FEATURE 5: AUDIO RETRY
------------------------------------

Implement proper handling for unusable recordings.

Examples:

- Recording too short.
- No speech detected.
- Microphone unavailable.
- Audio processing failed.
- Network interruption.
- API request failed.

When the recording is unusable:

Display a neutral message.

Example:

"The recording could not be verified.
Please try again."

Allow the interviewer to initiate another recording.

Do not classify technical failures as suspicious activity.

------------------------------------
FEATURE 6: FAIR RECHECK
------------------------------------

Add a Fair Recheck workflow.

This feature is important for demonstrating
responsible AI and social impact.

When an answer receives:

- Speaker mismatch
- Synthetic speech warning
- Inconclusive result
- Insufficient audio
- Verification failure

The interviewer should be able to request
another verification.

Candidate experience:

1. Display a notification.

   "Additional voice verification requested."

2. Explain that the candidate can provide
   another recording.

3. Allow the candidate to prepare.

4. Enable a new recording through the existing
   interview recording workflow.

5. Display recording and processing status.

6. Show a neutral completion message.

IMPORTANT:

- Preserve the original verification result.
- Store the recheck as a separate attempt.
- Associate both attempts with the same question.
- Never automatically reject the candidate.
- Allow the interviewer to review both results.

====================================================
4. INTERVIEWER INTERFACE ENHANCEMENTS
====================================================

GOAL:

Transform the existing interviewer interface
into a functional interview verification dashboard.

IMPORTANT:

Keep the existing two-column interview layout.

LEFT:
LiveKit interview room.

RIGHT:
Candidate answer recording controls.

Do not replace these sections.

Add the new verification features below the
existing interview controls or through clearly
organized tabs.

------------------------------------
FEATURE 1: INTERVIEW OVERVIEW
------------------------------------

Add a compact interview overview section.

Display:

- Session ID.
- Candidate identifier.
- Interview status.
- Candidate consent status.
- Voice enrollment status.
- Questions completed.
- Answers verified.
- Answers requiring review.

Example:

Interview Overview

Status: In Progress
Consent: Granted
Voice Enrollment: Complete

Questions Completed: 3
Verified Answers: 2
Requires Review: 1

Use actual session data.

Do not fabricate verification statistics.

------------------------------------
FEATURE 2: QUESTION MANAGEMENT
------------------------------------

The existing interface already contains an
"Interview question" text field.

Enhance it to support multiple questions.

Allow the interviewer to:

- Add a question.
- Edit a question.
- Select the current question.
- Move to the next question.
- View previously answered questions.

Each question must have a unique identifier.

Each recorded answer must be associated
with its corresponding question.

Suggested interface:

Interview Questions

Question 1
Tell me about yourself.
Status: Verified

Question 2
Explain your recent project.
Status: Review Required

Question 3
Describe a technical challenge.
Status: Pending

IMPORTANT:

Do not create an unnecessary AI question generator.

The interviewer should manually manage questions.

------------------------------------
FEATURE 3: QUESTION-LEVEL VERIFICATION
------------------------------------

After recording an answer:

1. Submit the candidate audio to the existing backend.
2. Perform speaker verification.
3. Perform synthetic-speech detection.
4. Receive the actual DetectifAI response.
5. Store the verification results.
6. Associate results with the correct question.
7. Update the interviewer dashboard.

Display:

Question Number
Question Text
Recording Duration
Speaker Verification
Synthetic Speech Detection
Overall Verification Status

Example:

Question 2

Speaker Verification:
Match

Synthetic Speech Detection:
No synthetic signal detected

Overall Status:
Passed

These are illustrative examples only.

Actual results must come from DetectifAI.

------------------------------------
FEATURE 4: DETAILED VERIFICATION PANEL
------------------------------------

Add a "View Details" action for each answer.

When clicked, display:

SPEAKER VERIFICATION

- Actual API verdict.
- Similarity score.
- Decision threshold.
- Processing status.

SYNTHETIC SPEECH DETECTION

- Actual API verdict.
- Detection score.
- Detection threshold.
- Available subsegment information.

PROCESSING INFORMATION

- Recording duration.
- Processing latency, if available.
- Request ID, if available.
- Model information, if available.

IMPORTANT:

Do not invent API fields.

Only display fields actually returned
by the existing integration.

Speaker similarity is not a percentage.

Do not convert it into a fabricated
confidence percentage.

Do not present a detection score as
proof of fraud.

------------------------------------
FEATURE 5: ANSWERS REQUIRING REVIEW
------------------------------------

Add a dedicated section:

"Requires Review"

Automatically include answers with:

- Speaker mismatch.
- Synthetic speech signals.
- Inconclusive verification.
- Verification errors requiring attention.

For each flagged answer, display:

- Question number.
- Question text.
- Reason for review.
- Verification status.
- Review status.

Provide buttons:

- View Evidence
- Request Recheck
- Mark Resolved
- Escalate for Manual Review

Do not automatically reject candidates.

------------------------------------
FEATURE 6: FAIR RECHECK CONTROLS
------------------------------------

Add a "Request Recheck" button
for answers requiring review.

When clicked:

1. Create a recheck request.
2. Associate it with the original question.
3. Notify the candidate.
4. Allow another recording.
5. Submit the new audio for verification.
6. Store the new API results.
7. Update the interviewer dashboard.

Display:

Original Verification
Recheck Verification

Example:

Original:
Speaker Verification: No Match
Speech Detection: Inconclusive

Recheck:
Speaker Verification: Match
Speech Detection: No synthetic signal detected

Allow the interviewer to compare the results.

Do not overwrite the original verification.

Prevent duplicate active recheck requests.

------------------------------------
FEATURE 7: HUMAN REVIEW DECISIONS
------------------------------------

Implement a human review system.

Separate:

A. AI Verification Results
B. Human Reviewer Decisions

The AI provides technical evidence.

The interviewer makes the final review decision.

Available reviewer decisions:

- Pending Review
- Concern Resolved
- Further Verification Required
- Escalated for Manual Review

Add an optional notes field.

Store:

- Question ID.
- Verification attempt ID.
- Reviewer decision.
- Reviewer notes.
- Review timestamp.

The human review decision must not alter
the original DetectifAI response.

------------------------------------
FEATURE 8: INTERVIEW INTEGRITY REPORT
------------------------------------

Add an "Interview Report" section.

The report should summarize:

INTERVIEW INFORMATION

- Session ID.
- Candidate identifier.
- Interview date.
- Interview duration.
- Total questions.

VERIFICATION SUMMARY

- Number of verified answers.
- Number requiring review.
- Number of inconclusive results.
- Number of rechecks performed.

QUESTION-LEVEL RESULTS

For every question:

- Question text.
- Speaker verification result.
- Synthetic speech detection result.
- Verification status.
- Recheck history.
- Human reviewer decision.

FINAL REVIEW

- Overall interview review status.
- Outstanding concerns.
- Reviewer notes.

Add a "Download Report" button.

For the prototype:

Use browser print functionality or
a lightweight PDF export.

Do not add unnecessary PDF infrastructure.

The report must clearly state:

"AI verification results are supporting signals
and do not independently establish candidate
identity, dishonesty, or misconduct."

====================================================
5. APPLICATION STATE AND BACKEND
====================================================

Reuse the existing backend.

Do not introduce a new database unless required.

Maintain a consistent data structure for:

Interview Session
Candidate Consent
Voice Enrollment
Interview Question
Recorded Answer
Verification Attempt
Recheck Request
Human Review Decision

Suggested logical relationships:

Interview Session
    |
    |-- Candidate Consent
    |
    |-- Voice Enrollment
    |
    |-- Questions
           |
           |-- Answer
                  |
                  |-- Verification Attempt 1
                  |
                  |-- Verification Attempt 2
                  |
                  |-- Reviewer Decision

Every verification attempt must retain:

- Its unique identifier.
- Associated question.
- Attempt number.
- API response.
- Verification status.
- Timestamp.

Preserve existing session synchronization.

Use the current LiveKit infrastructure
for interview communication.

Use the existing backend integration
for DetectifAI requests.

Never expose API credentials to the browser.

Ensure candidate and interviewer interfaces
receive consistent session updates.

====================================================
6. USER INTERFACE REQUIREMENTS
====================================================

IMPORTANT:

The current SignalShift AI design is already good.

DO NOT REDESIGN IT.

Maintain:

- Existing blue accent color.
- Existing light background.
- Existing white cards.
- Existing typography.
- Existing navigation.
- Existing button styling.
- Existing rounded corners.
- Existing spacing conventions.

New features must look like they belong
to the current application.

Avoid:

- Unnecessary gradients.
- Excessive animations.
- Large decorative illustrations.
- Generic AI chatbot-style interfaces.
- Unnecessary sidebars.
- Excessively colorful dashboards.

The goal is a professional recruitment
technology platform.

Keep the interview room as the main focus.

The new dashboard components should be
visually consistent with the existing interface.

====================================================
7. IMPLEMENTATION ORDER
====================================================

Time is limited.

Implement in this exact order.

PHASE 1: VERIFY EXISTING FUNCTIONALITY

Check:
- Consent.
- Voice enrollment.
- LiveKit connection.
- Audio capture.
- DetectifAI integration.

Fix only issues that prevent the core workflow.

PHASE 2: QUESTION MANAGEMENT

Implement:
- Multiple questions.
- Question selection.
- Answer-to-question association.

PHASE 3: VERIFICATION DASHBOARD

Implement:
- Question-level results.
- Speaker verification details.
- Deepfake detection details.
- Review status.

PHASE 4: FAIR RECHECK

Implement:
- Request recheck.
- Candidate notification.
- Additional recording.
- Recheck result history.

PHASE 5: HUMAN REVIEW

Implement:
- Reviewer decisions.
- Reviewer notes.
- Review history.

PHASE 6: INTERVIEW REPORT

Implement:
- Interview summary.
- Question-level results.
- Recheck history.
- Downloadable report.

PHASE 7: FINAL TESTING

Test the complete candidate-to-interviewer workflow.

Do not begin optional features until the
core functionality works.

====================================================
8. TESTING REQUIREMENTS
====================================================

Verify the following scenario:

1. Interviewer creates an interview.

2. Interviewer generates a candidate invitation.

3. Candidate opens the invitation link.

4. Candidate reads and accepts consent.

5. Candidate joins the LiveKit room.

6. Candidate records a voice reference.

7. DetectifAI enrollment succeeds.

8. Interviewer selects Question 1.

9. Interviewer records the candidate's answer.

10. The backend submits the audio to DetectifAI.

11. The actual verification results appear
    in the interviewer dashboard.

12. Interviewer moves to Question 2.

13. A second answer is recorded and verified.

14. Both questions retain separate results.

15. Interviewer requests a recheck for
    an answer requiring review.

16. Candidate receives the request.

17. Candidate provides another recording.

18. The new verification result appears
    alongside the original result.

19. Interviewer records a review decision.

20. Interviewer generates the final report.

If a live API test is unavailable,
explain the limitation.

Do not fabricate successful test results.

====================================================
9. FINAL DEVELOPMENT RULES
====================================================

1. Modify the existing project only.

2. Preserve all working functionality.

3. Reuse the existing LiveKit integration.

4. Reuse the existing DetectifAI integration.

5. Do not create duplicate recording systems.

6. Do not replace the current website design.

7. Do not add unnecessary dependencies.

8. Do not fabricate AI verification results.

9. Do not automatically reject candidates.

10. Prioritize functional completeness over
    visual enhancements.

11. Handle errors gracefully.

12. Keep the code maintainable.

13. Avoid unnecessary complexity.

14. Complete the highest-priority features first.

15. Test each feature before moving to the next.

====================================================
10. EXPECTED FINAL OUTPUT
====================================================

After implementation, provide:

1. Features successfully implemented.

2. Existing functionality preserved.

3. Files modified.

4. Backend endpoints added or changed.

5. Any required environment variables.

6. Features that could not be completed.

7. Known limitations.

8. Instructions for testing the workflow.

Do not claim completion without verification.

FINAL GOAL:

Extend the existing SignalShift AI website into
a complete interview verification prototype where:

- Candidates consent and enroll their voices.
- Interviews take place through LiveKit.
- Candidate answers are recorded and verified.
- DetectifAI returns real verification results.
- Interviewers review results question by question.
- Candidates can complete fair rechecks.
- Human reviewers make final decisions.
- Interview reports summarize the evidence.

Preserve the existing design and architecture.

Build on what already exists.