# Structured decision policy

Only deterministic recovery may be followed automatically. When an `advance`
action has `recovery.type: AUTO_RECOVER`, execute its one offered route within
current authority, explain the repair in plain language, and continue with its
exact `resume` command.

Advance v6 performs known sandbox-sync recovery itself. For a retained recovery
decision, explain the cause and attempted work, the offered choices and their
consequences. Record the explicit answer with `advance --decision`, its exact
`--decision-fingerprint`, a `--decision-ref`, and the chosen approach as `--reason`.
The harness retains the target and prior answers. A retry is not permission to
waive evidence. A wait must name its owner and condition.
Do not repeat a failed route or ask the same question after restart; read the
current action and reuse an unchanged recorded decision. Pausing preserves work.

Every other `ASK_USER`, including one emitted by a blocked operation, requires
an explicit user answer. Present honest alternatives, recommend one with a
reason, and preserve reject, inconclusive, or pause whenever valid. Never infer
approval from silence or from the ability to invoke an authority command.

The agent creates requests, responses, flags, and provenance after the human
decision. Users never assemble harness commands or JSON.

## Wording for the user

Use the language of the user's current request even when tools, specs, or skills
use English. Lead with what is done and what the user will see or be able to do.
Ask only for the missing product choice or authority in a short, natural sentence.
Reuse approval already given for that scope.

Keep CLI invocations, flags, placeholders, change IDs, task IDs, skill names,
and machine labels such as `needs input` out of routine replies. Show them only
when the user requests diagnostics. Link the packet for detail; approval must
not require reading a command or an implementation inventory. Translate design
jargon into visible effects: "semantic color tokens" means consistent colors,
"44px touch targets" means buttons easy to tap on a phone. Mention numerical
criteria only when they are part of the user's decision.

For example, a Thai approval request for an unbuilt todo-page design:
"เตรียมแนวทางปรับหน้ารายการงานแล้วครับ จะจัดหน้าให้เรียบง่าย ใช้งานบนมือถือสะดวก
และเปลี่ยนโหมดสว่าง–มืดตามเครื่อง คุณต้องการให้ผมเริ่มทำตามแนวทางนี้ไหมครับ?"
This wording is a user decision; the approval command stays with the agent.

Describe verification limits by their practical effect: checking source files
does not confirm how the page looks in a browser. Repair agent-owned omissions
before asking for approval; surface a warning only when it changes the user's
choice, explaining the affected behavior and proposed resolution in ordinary
words. A "missing error state" warning is not itself a user decision.

For human review or acceptance, present the concrete scope, findings, and exact
verdict to be recorded; ask for the user's decision only if it is missing.
Permission to run a command is not a human review verdict. Never turn an
agent-authored response into a human pass without the user's explicit adoption
of that verdict. Reuse an explicit answer for the same unchanged scope/verdict.
After confirmation, the agent runs the offered `authority dispatch` and
`authority record` routes as applicable, verifies the result, and resumes.
Human ownership of the decision does not require human CLI execution.

Claim a host permission block only when a tool returned an actual denial; retain
the denied action and stated reason. If the host offers a permission approval
flow, request it there and execute after approval. A hard deny remains binding:
do not bypass it, weaken settings, or ask the user to execute the blocked command
with a shell escape such as `!`. Report the real boundary and preserve the
agent-owned resume route; never invent a session permission restriction.
