# Content, learning and discovery

Original illustrative layouts for adaptation, not validated production designs.
Read [the selection guide](index.md) before choosing a pattern. Boxes indicate
content groups and priority, not fixed pixel geometry or implementation components.
Use [the shared specification](specification.md) for accessibility, states and tokens.

## E01: Article or documentation

**Task:** Read a focused explanation and find related steps.

**Wide layout:**

```text
Title + summary | Table of contents
Main content | Contextual examples
Related tasks | Feedback/updated context
```

**Compact behavior:** Collapse secondary navigation; keep content and headings readable.

**Applicable states:** Missing anchor; outdated guidance; unavailable example.

**Avoid / adapt:** Avoid interrupting reading with competing promotion.

**Acceptance example:** Check headings, anchors, code/content wrapping and task-relevant related links.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## E02: Knowledge base

**Task:** Find answers by search or topic.

**Wide layout:**

```text
Help search | Popular tasks
Topic categories | Recent/important updates
Answer detail routes | Contact support
```

**Compact behavior:** Put search and task routes first; stack categories.

**Applicable states:** No matches; ambiguous query; obsolete answer.

**Avoid / adapt:** Avoid confusing search popularity with user importance.

**Acceptance example:** Check synonyms, result relevance and route to human help.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## E03: Search results

**Task:** Choose a relevant destination from a query.

**Wide layout:**

```text
Query + result count | Filters/sort
Results with distinguishing context
Pagination | Query suggestions
```

**Compact behavior:** Keep query and active filters; stack contextual snippets.

**Applicable states:** Loading; no results; partial results; query error.

**Avoid / adapt:** Avoid snippets that imply facts absent from the destination.

**Acceptance example:** Check result identity, applied scope and recovery from zero results.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## E04: Course learning

**Task:** Continue learning and complete meaningful activities.

**Wide layout:**

```text
Course outline | Current lesson
Lesson content + activity | Progress
Next/previous | Help and completion status
```

**Compact behavior:** Prioritize current lesson; provide an outline drawer or section.

**Applicable states:** Not started; in progress; submitted; feedback; sync failure.

**Avoid / adapt:** Avoid equating page views with learning mastery.

**Acceptance example:** Check resumption, activity feedback and accessible learning media.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.

## E05: Community discussion

**Task:** Read a thread and contribute with context.

**Wide layout:**

```text
Topic title + context | Follow
Posts + chronology | Reply composer
Guidelines | Moderation/related discussion
```

**Compact behavior:** Use a single readable thread; preserve draft while navigating.

**Applicable states:** Empty thread; pending reply; failed posting; moderated content.

**Avoid / adapt:** Avoid silently losing drafts or misrepresenting posting status.

**Acceptance example:** Check reply context, draft recovery and clear moderation state.

**Customize:** Substitute real content, labels and permission rules; apply existing
tokens and the actual data model. Record why this structure serves the user task.
