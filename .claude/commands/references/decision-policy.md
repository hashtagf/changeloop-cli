# Structured decision policy

Only deterministic recovery may be followed automatically. When an `advance`
action has `recovery.type: AUTO_RECOVER`, execute its one offered route within
current authority, explain the repair in plain language, and continue with its
exact `resume` command.

Every other `ASK_USER`, including one emitted by a blocked operation, requires
an explicit user answer. Present honest alternatives, recommend one with a
reason, and preserve reject, inconclusive, or pause whenever valid. Never infer
approval from silence or from the ability to invoke an authority command.

The agent creates requests, responses, flags, and provenance after the human
decision. Users never assemble harness commands or JSON.
