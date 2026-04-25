---
name: continue-development
description: Spec-first continuation workflow for software projects. Use when the user asks Codex to continue development, pick up a handoff, implement remaining work, stabilize a repo, or drive a project from current state to verified completion. Enforces dated specs, verifiable task breakdowns, coordinator/executor execution, run tracking in `.ai/runs`, and tests for every new change.
---

# Continue Development

## Core Rule

Do not start implementation from vague intent. First establish the current spec,
then turn it into verifiable tasks, then execute and verify until the task list is
done or a real blocker is documented.

## Workflow

1. **Create or update the spec**
   - Look for `.ai/SPEC.md`, `SPEC.md`, README-linked specs, issue docs, and handoff notes.
   - If no spec exists, create `.ai/SPEC.md`.
   - Keep concrete dates in specs and run notes. Use the current calendar date for "today"; do not rely on relative dates in persisted docs.
   - Update the spec to reflect the current implementation before planning changes.

2. **Create a run record**
   - Create `.ai/runs/` if missing.
   - Add a run note named with an ISO-like timestamp and short slug, for example:
     `.ai/runs/2026-04-25-continue-development.md`.
   - Record: date, request, starting branch/commit, assumptions, task list, verification plan, commands run, results, blockers, and final status.
   - Keep the run note current as work proceeds, not only at the end.

3. **Split the spec into verifiable tasks**
   - Update or create `.ai/WORKLIST.md`.
   - Each task must have a verification method:
     - unit test
     - integration/e2e test
     - Playwright/browser click path
     - API/CLI command with expected output
     - explicit manual check only when automation is impractical
   - Avoid tasks like "improve X" without a measurable done condition.
   - For app/workspace projects, include environment bootstrap tasks when absent:
     - install `git`
     - install GitHub CLI `gh`
     - initialize a local git repository in the app folder when none exists
     - ensure shells and development commands start from the app folder as `cwd`

4. **Run coordinator/executor mode**
   - Coordinator responsibilities:
     - maintain the spec, worklist, and run note
     - choose the next highest-value task
     - define acceptance checks before implementation
     - review diffs and verification results
   - Executor responsibilities:
     - implement one bounded task at a time
     - add or update tests with the change
     - run the task-specific verification
     - report changed files, commands, and residual risks
   - If subagents are explicitly available or authorized by the user, use them
     for executor tasks with disjoint write scopes. Otherwise run both roles
     locally and keep the coordinator/executor distinction in the run note.

5. **Add tests for every new change**
   - Prefer unit tests for pure logic and regression-prone behavior.
   - Add integration/API tests when behavior crosses service boundaries.
   - Add Playwright tests or scripted browser smoke checks for UI flows and click paths.
   - If a change cannot be automated reasonably, document the reason and the
     manual verification steps in `.ai/runs/<run>.md`.

6. **Verify continuously**
   - Run the smallest relevant test after each bounded change.
   - Run broader suites before finalizing when time and environment allow.
   - Do not mark a task complete until verification has run and its result is recorded.
   - If tests fail for unrelated reasons, capture evidence and isolate the failure.

7. **Finish cleanly**
   - Update `.ai/SPEC.md`, `.ai/WORKLIST.md`, and the run note with final state.
   - Check `git status --short`.
   - Summarize implementation, verification, and residual risks.
   - Commit/push/tag only if the user asks or the active task explicitly requires it.

## Run Note Template

Use this structure for `.ai/runs/<date>-<slug>.md`:

```markdown
# Run: <slug>

Date: YYYY-MM-DD
Branch: <branch>
Start commit: <sha>
Request: <one-line user request>

## Assumptions

- <assumption>

## Spec Updates

- <files updated or created>

## Tasks

- [ ] <task> — verify with <test/command/click path>

## Execution Log

### YYYY-MM-DD HH:MM <timezone>

- Changed: <files>
- Ran: `<command>`
- Result: <pass/fail/notes>

## Final Status

- Completed: <items>
- Not completed: <items and blockers>
- Residual risks: <risks>
```

## Quality Bar

- Preserve user changes; never revert unrelated dirty work.
- Prefer small, reviewable patches.
- Keep specs and docs synchronized with the actual implementation.
- Treat "works manually" as insufficient when an automated test is practical.
- Start commands from the app/project folder unless the task explicitly requires
  repository-root or infrastructure-root context.
- Record enough evidence that another agent can resume without guessing.
