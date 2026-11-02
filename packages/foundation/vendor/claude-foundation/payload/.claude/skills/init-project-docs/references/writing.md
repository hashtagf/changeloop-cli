# Writing prose deliverables

Use this for human-facing prose: project docs, reports, pull request
descriptions, and commit messages. It governs style only. The owning skill
still decides content, evidence, and authority. Writing a message grants no
authority to create it. Drafting a commit message or a pull request
description does not authorize the commit, branch publication, or the pull
request.

## Choose the document mode first

Pick one mode per document before drafting. Ask whether the reader needs to
act or to understand, and whether they are learning or working:

| Reader | Mode | Shape |
|---|---|---|
| acts while learning | Tutorial | one guided path; every step shows a visible result |
| acts while working | How-to | steps toward one goal; assume competence; allow "if X, do Y" forks |
| understands while working | Reference | dry, complete facts that mirror the structure of the thing described |
| understands while learning | Explanation | one bounded topic with context, constraints, alternatives, and trade-offs |

Do not mix modes. A how-to does not argue, a reference does not teach, and a
tutorial does not carry full option tables. Split the material and link the
parts. Commit messages, pull request descriptions, and reports are briefings,
not Diátaxis documents; apply the sentence rules and the catalog to them.

## Write plain, specific, active sentences

- Name the actor: "the parser rejects the date", not "the date is rejected".
  Passive is fine only when the actor is unknown or irrelevant.
- Use the real symbol, file, flag, or command in code font instead of a
  description of it.
- Put one idea in each sentence. Split any sentence the reader must re-read.
- Put the condition before the instruction: "To reset the cache, run ...".
- Prefer the specific claim: "a column rename fails the build", not "schema
  changes can cause issues". If a sentence would fit unchanged in another
  project's docs, it says nothing about this one.
- State a number or a mechanism instead of a feeling.
- Call one thing by one name throughout the document.
- Keep articles and verbs. Terse means fewer ideas per sentence, not fewer
  words per idea.

## Remove AI-sounding patterns

Numbers are stable so a review can cite them. Apply the catalog to text you
are writing or were asked to edit; leave unrelated prose alone.

1. **Inflated vocabulary.** "delve", "robust", "seamless", "leverage",
   "utilize", "pivotal", "crucial", "showcase", "underscore", "landscape".
   Use the plain word ("use", "important") or delete it.
2. **Fancy copulas.** "serves as", "stands as", "boasts". Say "is" or "has".
3. **Em-dash chains.** Several em dashes in one paragraph, or one that splices
   two clauses. End the sentence or use a comma.
4. **Dramatic colons.** A mid-sentence colon staged as a reveal ("The fix was
   simple: ..."). Keep colons for lists and examples.
5. **Rule-of-three padding.** Triplets chosen for rhythm. Use the natural count.
6. **Hedging stacks.** "could potentially perhaps". Use one qualifier, or state
   the fact and its evidence.
7. **Empty summaries.** "In summary, this improves things." "The future looks
   bright." State the result or delete the sentence.
8. **"Not just X, but Y" framing.** State Y.
9. **Filler phrases.** "In order to" becomes "to"; "due to the fact that"
   becomes "because"; delete "it is important to note that".
10. **Superficial -ing tails.** "..., ensuring reliability". Delete them or
    state the concrete effect.
11. **Vague attribution.** "Experts agree", "it is widely known". Name the
    source or delete the claim.
12. **Synonym cycling.** Renaming one thing to avoid repetition. Repeat the name.
13. **Abstract metaphor nouns.** "north star", "flywheel", "substrate",
    "paradigm". Use the concrete word.
14. **Chat residue.** "Great question", "I hope this helps", "Certainly!".
    Delete it.
15. **Decorative formatting.** Bold on every term, emoji in headings, title-case
    headings, bold-label bullets that restate their line. Use sentence-case
    headings and plain prose.
16. **Over-compression.** Dropped articles, arrows, verbless fragments, and
    private abbreviations that make the reader decode. Write whole sentences.

Before:

> We leverage a robust caching layer — ensuring seamless performance — that
> serves as the backbone of the API. In summary: it's pivotal.

After:

> The API caches each product response in Redis for 60 seconds. Repeat
> requests inside that window skip the database.

The rewrite needs facts from the source. When a fact is unknown, say so or ask;
never invent a number to make a sentence concrete.

## Protected text

Never rewrite the following, even when it matches a catalog pattern:

- User quotes and recorded user decisions. Keep their wording verbatim.
- Parser-required headings and markers: the `Requirement:` and `Scenario:`
  headings, the `GIVEN`, `WHEN`, `THEN`, and `SHALL` keywords, their heading
  levels and case, and any other heading or token a tool parses.
- Schema keys, field names, identifiers, file paths, commands, flags, and code.
- Repository template headings, Conventional Commit types and scopes, and
  phrases a test pins.
- The document language the user chose. Do not translate it or switch a Thai
  document to English; write new text in that language and keep technical
  tokens unchanged.

## Deliverable notes

- **Docs.** One mode per file, and every claim grounded in code actually read.
- **Pull request description.** A reviewer briefing readable in about a
  minute: the problem, the resulting behavior, and the checks actually run.
  Link logs and tables instead of pasting them.
- **Commit message.** The subject states the change and the body states why.
  Format conventions belong to `git-workflow`.
- **Report.** State each evidence status exactly as executed, failed,
  unavailable, or proposed. Fluent wording never upgrades evidence.

Each of these is drafted text. Creating, publishing, or posting it is a
separate operation that needs its own explicit authority.

## Review pass

1. Confirm the reader and the mode.
2. Check the draft against each catalog number.
3. Diff protected text and confirm it is unchanged.
4. Read once as the target reader and cut sentences that do no work.
5. If a rule makes a sentence worse, fix the sentence another way or keep it.
