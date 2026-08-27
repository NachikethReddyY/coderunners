---
version: 1
name: codecast-generation
description: Generate one validated Codecast bundle without mutating the learner's live project.
trigger:
  type: manual
inputs:
  - selected-project-root
  - project-goal
  - diagnostic-answers
steps:
  - id: check-host
    kind: analysis
    target: local-host-health
    purpose: Confirm the loopback host, project permission, Codex SDK, and bundle storage are available.
    readOnly: true
  - id: author-draft
    kind: skill
    target: codex-sdk
    purpose: Author canonical cues, anchored events, one protected seam, progressive hints, and behavioral checks with no invented timestamps.
    readOnly: true
  - id: validate-draft
    kind: analysis
    target: coderunners-contracts
    purpose: Validate the structured draft and run at most one bounded repair using only returned validation errors.
    readOnly: true
  - id: persist-bundle
    kind: write
    target: local-host-job-data
    purpose: Persist the validated draft and terminal job state outside the learner project.
    readOnly: false
  - id: present-brief
    kind: analysis
    target: studio-generation-brief
    purpose: Present a concise result, proof state, and recovery action to the learner.
    readOnly: true
capabilities:
  - read files under the explicitly selected project root
  - run a server-side Codex SDK thread with injected project context
  - validate against @coderunners/contracts
  - write job and generated-bundle data outside the learner project
  - retry one failed structured draft with concrete validation errors
checkpoint:
  required: false
  reason: Generation reads the selected project and writes only isolated CodeRunners data; applying generated changes to learner files is outside this workflow.
proof:
  - The job reaches succeeded with a contract-valid draft pointer.
  - The learner project is byte-for-byte unchanged by generation.
  - Failure or interruption preserves the last durable job state and exposes one useful retry action.
failurePolicy:
  maxRetries: 1
  onFailure: stop
stopCondition: Stop after a valid draft is persisted and briefed, or persist a failed or interrupted job with a concrete recovery reason.
---

# Codecast generation

The learner starts this loop after selecting a project and describing the outcome. The Local Host owns execution and durable status; the browser only starts the job and reads progress. Codex authors semantic cues and anchors, never media timestamps. The workflow cannot write generated solutions or demo patches into the selected project.

