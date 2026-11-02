# Root cause

## Stop after two failed fixes

After two failed fixes on the same gate, stop editing. Each failure disproved a
belief; find the belief both fixes shared. Before any further fix:

1. Write the premise: the one assumption that, if true, explains every observed
   failure.
2. Write a falsifying experiment: an observation that would prove the premise
   wrong, with its predicted output quoted.
3. Run the experiment. Fix only after the premise survives it; if it fails,
   return to [reproduction](reproduction.md).

Examine how the failures distribute before choosing a premise: which inputs,
environments, orders, or times fail and which pass. A pattern names the
condition; a single sample does not.

Remove the condition rather than compensate for it. A retry, timeout increase,
sleep, or catch-all that makes the gate pass while the condition remains is
symptom suppression.

## Is the fix at the root?

- **Guard legitimacy.** A guard is a fix only when the state it handles is
  legitimate input the system must accept. A guard against state that should
  never exist hides the producer of that state; fix the producer. Removing an
  existing guard still requires the invariant proof in
  [cleanup](../../coding-discipline/references/cleanup.md).
- **Persisted state after a restart.** When a failure survives a restart or
  reappears after one, suspect persisted state first: files, caches, database
  rows, queues, and generated artifacts outlive the process.
- **Every instance in scope.** Search for the same defect pattern. Fix every
  instance inside the change's scope; report instances outside it as follow-up
  with their locations. Do not bundle cleanup.
- **Always-on signal.** When a cheap always-on signal, such as an assertion,
  invariant check, or log field at the first wrong boundary, would have caught
  the defect earlier, propose it with the fix.
