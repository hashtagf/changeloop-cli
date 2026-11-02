# Research and validation

## Begin with the decision

Describe the people, their context and the problem before proposing a feature.
Treat team assumptions as hypotheses; learn from users and existing evidence.
Plan research around the important unanswered questions and update the plan as
learning progresses. [S33, S34]

## Choose a method

| Question | Useful method | Boundary |
|---|---|---|
| What are people trying to do? | Interviews, contextual observation | Reported preferences are not demonstrated task success |
| How do people group this content? | Card sorting | Does not establish real-interface findability; S31 |
| Can people find a destination? | Tree testing | Isolates hierarchy, excluding visual navigation; S32 |
| Where do people struggle, and why? | Qualitative usability sessions | Small samples inform iteration, not population rates; S35 |
| How well does the flow perform? | Quantitative task study | Needs controlled conditions, suitable sampling and uncertainty; S35 |
| What behavior occurs in production? | Analytics | Describes behavior; motivation usually needs further evidence |
| Does a change cause a measurable difference? | Properly designed randomized experiment | Requires sample/assignment rationale and guardrail metrics |
| Does implementation meet criteria? | Code inspection, automated and manual checks | Criterion checks are not user comprehension studies |

The last three rows are this skill's methodological recommendations, not a
claim that every product needs analytics or experimentation.

## Usability session protocol

Specify target participants, recruitment limits, device/input, scenario and
starting state. Use neutral outcome-based prompts, not instructions naming the
control being tested. Define success, partial success, failure and permitted
assistance before observing sessions. Think-aloud can affect timing, so state
the protocol and avoid mixing unlike measurements. Record observations and
interpretations separately. [S35, S36]

Choose sample size for the question, user diversity and uncertainty. A small
qualitative round can reveal problems; it is not proof all problems are found,
nor a substitute for quantitative sample planning. Agent walkthroughs are
simulations, not research with representative users. [S35; agent rule is local]

## Measures

Define completion using observable outcomes, not a vague impression. Report
counts and denominators; "4 of 5 participants completed" is more honest in a
small diagnostic study than an implied population-wide 80% success claim.
Partial success needs an explicit definition. Completion alone does not explain
causes; record recovery, errors and context alongside it. [S36]

Project recommendations: define timing boundaries, denominator for errors,
assistance rules, and relevant satisfaction questions. Compare equivalent tasks
and conditions. For larger estimates, report uncertainty and sampling limits.
Predefine the hypothesis, primary measure and guardrails for experiments; do
not stop at a favorable fluctuation or treat correlation as causation.

## Prioritize findings

Use this skill's operational severity scale:
- **Critical:** Blocks a critical task or can cause serious irreversible harm.
- **High:** Causes substantial failure or excludes users from a key workflow.
- **Medium:** Adds avoidable effort/confusion with a workable recovery path.
- **Low:** Local polish/consistency issue with limited demonstrated task impact.

Severity is not confidence. Label confidence high/medium/low with a reason.
Keep observed frequency, estimated reach and effort separate; do not manufacture
them from a screenshot. Fix verified task blockers before aesthetic preferences.

## Validation examples

**Weak:** "The form is confusing; make it cleaner."
**Actionable:** "At failed submission, the email error is only in a disappearing
toast. Keep the value, show a field-specific correction linked to the input,
and provide an error summary for this long form. Verify the keyboard path from
summary to field and successful resubmission. Current screen-reader behavior
is untested."

**Weak:** "Changing the button will increase conversion 20%."
**Actionable:** "The proposed label names the action more explicitly. Treat
improved completion as a hypothesis; compare completion and error/recovery
behavior under equivalent tasks before asserting an impact."
