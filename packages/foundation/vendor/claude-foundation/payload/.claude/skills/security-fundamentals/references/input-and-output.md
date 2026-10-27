# Input and Output Handling

Injection = attacker-controlled data read as instructions by a downstream interpreter (SQL, shell, HTML/JS, LDAP). Two defenses: **validate on the way in** (is this the shape I expect?) and **encode/parameterize on the way out** (keep data on the data side). Not interchangeable — you need both.

## Principle 2 (from SKILL.md): Validate input at the boundary — canonicalize *before* you check

**Rule:** Validate every untrusted input where it enters, against an allow-list of what is permitted, *after* reducing it to a single canonical form. Reject what does not match; never try to sanitize hostile input into safe input.

**Why:** A check on a non-canonical input is bypassable — `../`, `..%2f`, `..%252f` are the same path wearing disguises. **Canonicalize first, then validate**: decode, normalize Unicode, resolve the path, lowercase the host, *then* compare. Allow-list over deny-list always: a deny-list enumerates attacks you thought of; the attacker only needs the one you didn't.

**How to apply:**
- Validate at the boundary, once, into a typed value — then the rest of the code works with a value it can trust. This is [[programming-fundamentals]] "parse, don't validate": the output of the boundary is a `Email`, a `SafePath`, a `UserId`, not a raw `string` you re-check everywhere.
- Canonicalize before comparing: URL-decode (until stable), Unicode-normalize (NFC), resolve `..` and symlinks for paths, lowercase hosts. Then check.
- Use allow-lists for format (regex anchored with `^...$`), range (numeric bounds), length (cap it — unbounded input is a DoS vector), and set membership (one of an enum).
- Validation is not output encoding (principle 3). Validating that an input is a well-formed name does **not** make it safe to drop into HTML or SQL — that is the sink's job. Do both.
- For structured input, validate against a schema (zod, pydantic, JSON Schema) and reject unknown fields rather than ignoring them.

**Example:**
```python
# Bad — checks the raw input, attacker sends an encoded form to slip past
def get_file(name: str):
    if ".." in name:                      # deny-list, pre-canonicalization
        raise Forbidden()
    return open(f"/data/{name}")          # name = "%2e%2e%2fsecret" decodes later → escape

# Good — canonicalize, then validate against the real boundary
import os
BASE = "/data"
def get_file(name: str):
    if not re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", name):   # allow-list, anchored
        raise BadRequest()
    full = os.path.realpath(os.path.join(BASE, name))     # canonicalize (resolves .. and symlinks)
    if os.path.commonpath([BASE, full]) != BASE:          # confinement check on canonical form
        raise Forbidden()
    return open(full)
```

## Principle 3 (from SKILL.md): Output encoding is contextual — escape for the sink, never "for safety"

**Rule:** Encode data for the specific place it is going — HTML body, HTML attribute, JavaScript, URL, SQL, shell, LDAP — at the moment it goes there. For queries and commands, don't escape at all: parameterize. There is no such thing as generically "sanitized" data.

**Why:** Injection = attacker-controlled data interpreted as code by a downstream parser (SQL, shell, HTML/JS, LDAP). HTML-escaping a value then dropping it in SQL does nothing — contexts have different metacharacters. "I sanitized it" is meaningless without "for what sink." For SQL and shell, the only robust answer is not to build the string at all — one missed escape is a full compromise.

**How to apply:**
- SQL: parameterize. `db.query("... WHERE id = $1", [id])`, never `"... WHERE id = " + id`. Identifiers that can't be parameters (table/column names) must come from an allow-list, never from user input.
- OS commands: pass an argument array to `execFile`/`spawn`/`subprocess.run([...])`, never a string to a shell. If you find yourself reaching for `shell=True` or `exec(cmd)`, stop — restructure so there is no shell.
- HTML: escape contextually (`<`, `>`, `&`, `"`, `'`) and remember the context within HTML differs — body text, attribute value, inside a `<script>`, inside a URL attribute, and inside CSS each need different encoding. Use the framework's auto-escaping (React, Jinja2 autoescape, Razor) and treat any "raw"/`dangerouslySetInnerHTML`/`mark_safe` as a red flag requiring justification.
- URLs: `encodeURIComponent` for query/path segments. LDAP, XML, CSV (formula injection), and shell each have their own escaping; reach for a vetted encoder for that sink, not a hand-rolled regex.
- Encode at the sink, late — not early and stored. Storing pre-escaped data causes double-encoding bugs and means the same value can't be safely reused in a different context.

**Example:**
```ts
// Bad — string-built SQL and a shell command, both injectable
db.query(`SELECT * FROM users WHERE email = '${email}'`)   // ' OR '1'='1
exec(`convert ${filename} out.png`)                        // ; rm -rf /

// Good — parameterized query; argument array, no shell
db.query('SELECT * FROM users WHERE email = $1', [email])
execFile('convert', ['--', filename, 'out.png'])           // argv defeats shell injection; `--` (or rejecting a leading `-`) stops the filename being parsed as a flag

// HTML: let the framework escape; raw insertion is the exception that needs a reason
element.textContent = userComment            // safe — text node, not parsed as HTML
element.innerHTML = userComment              // XSS — userComment = "<img src=x onerror=...>"
```

## Validation: at the boundary, allow-list, canonical-first

### Canonicalize, *then* check

A check on a non-canonical form is bypassable — the attacker picks an encoding that passes your check but decodes into the dangerous form downstream.

```
../../etc/passwd          # raw
..%2f..%2fetc%2fpasswd    # URL-encoded
..%252f..                 # double-encoded (decoded once by proxy, again by app)
....//                     # nested — strip-once "../" → "../"
..%c0%af                   # overlong UTF-8 encoding of ../ (decodes past naive filters)
```

Order: **decode until stable → Unicode-normalize (NFC) → resolve (`..`, symlinks, case for hosts) → THEN compare against the allow-list.** For paths, resolve to an absolute real path and confirm it is under the intended base directory (`commonpath`/`startsWith` on the *resolved* path, not the input).

### Allow-list, not deny-list

| Goal | Do this | Not that |
|---|---|---|
| Username | `^[a-z0-9_]{3,32}$` (anchored) | strip out characters you think are bad |
| File extension | one of `{".png", ".jpg"}` | reject `.exe`, `.sh`, … (you'll miss `.svg`) |
| Sort column | `column in {"name","created_at"}` | escape the column name into SQL |
| Redirect target | one of a known internal path set | "must start with our domain" (`evil.com?x=ourdomain.com`) |
| Numeric input | parse to int + range check | regex for "looks numeric" |

A deny-list enumerates attacks you thought of; the attacker only needs the one you didn't. Anchor every regex with `^...$`. Cap length on everything — unbounded input is a DoS vector (huge body, ReDoS, billion-laughs XML).

### Parse, don't validate

Validate once at the edge into a *typed* value, then the rest of the code can't forget. This is the [[programming-fundamentals]] instinct: the boundary returns an `Email`, a `SafePath`, a `PositiveInt` — not a `string` everyone re-checks (and someone eventually doesn't).

```ts
// Boundary returns a branded type; downstream can't pass a raw string
type Email = string & { readonly __brand: 'Email' }
function parseEmail(raw: unknown): Email {
  if (typeof raw !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) || raw.length > 254)
    throw new BadRequest('email')
  return raw.toLowerCase() as Email
}
```

Use a schema validator for structured input (zod, pydantic, JSON Schema) and **reject unknown fields** rather than silently dropping them — silently ignoring extra fields is how mass-assignment bugs hide (see authn-authz.md).

## Output: encode for the sink, or don't build the string at all

### SQL — parameterize, never concatenate

```ts
// Injectable
db.query(`SELECT * FROM users WHERE email = '${email}' AND active = ${active}`)
//   email = "x' OR '1'='1"  → returns every row

// Safe — value travels in a separate channel the parser never treats as SQL
db.query('SELECT * FROM users WHERE email = $1 AND active = $2', [email, active])
```

Parameters cover *values*. They cannot parameterize **identifiers** (table/column names) or **keywords** (`ASC`/`DESC`). Those must come from a server-side allow-list:

```ts
const SORT = { name: 'name', date: 'created_at' } as const   // allow-list maps input → real column
const col = SORT[req.query.sort] ?? 'created_at'             // unknown → safe default
db.query(`SELECT * FROM users ORDER BY ${col} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}`)
```

ORMs parameterize automatically — until you reach for a raw-SQL escape hatch (`db.raw`, `text()`, string-interpolated `WHERE`). Those are the lines to scrutinize.

### OS commands — argument array, no shell

```python
# Injectable: a shell parses the string, so ; | $() & all become operators
os.system(f"convert {filename} out.png")        # filename = "x.png; rm -rf /"
subprocess.run(f"convert {filename} out.png", shell=True)   # same hole

# Safe from SHELL injection: no shell, filename is one opaque argument.
# Still pass `--` (or reject a leading `-`) so it can't be parsed as a flag by the tool itself
subprocess.run(["convert", filename, "out.png"])            # shell=False is the default
```

If you think you need a shell, you almost always don't — pipe in code, or pass a fixed command with the untrusted part as an argument. `shell=True`, `os.system`, backticks, and `eval`/`exec` on anything attacker-influenced are red flags.

### HTML/JS — contextual escaping; the context within HTML matters

Escaping is per-context. The same value needs different treatment in each place:

| Context | Example sink | Encoding needed |
|---|---|---|
| HTML body | `<p>HERE</p>` | `< > & " '` → entities |
| HTML attribute | `<div title="HERE">` | entity-encode + always quote the attribute |
| JS string | `<script>var x = "HERE"</script>` | JS string escaping (or better: pass via `JSON.stringify`/data attribute) |
| URL in `href`/`src` | `<a href="HERE">` | URL-encode + validate scheme (`javascript:` is XSS) |
| CSS value | `<div style="width:HERE">` | CSS escaping (rare; avoid) |

Let the framework escape by default (React, Vue, Angular, Jinja2 autoescape, Razor). The dangerous opt-outs — `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `mark_safe`, `| safe`, `Html.Raw` — each needs a written reason; if the content is user-derived, run it through DOMPurify with an allow-list of tags/attributes.

```ts
el.textContent = comment    // safe: a text node, never parsed as markup
el.innerHTML  = comment     // XSS: comment = '<img src=x onerror=alert(document.cookie)>'
```

Defense in depth for XSS: a `Content-Security-Policy` that disallows inline script turns many injection bugs from exploitable into inert. It's a backstop, not a substitute for encoding.

### Other sinks, same rule

- **URL building** — `encodeURIComponent` each user-supplied path/query segment; don't string-concat into a URL.
- **LDAP** — escape `( ) * \ NUL` per RFC 4515; use the driver's escaping function, not a hand-rolled one.
- **CSV / spreadsheets** — formula injection: a cell starting with `= + - @` is executed by Excel/Sheets. Prefix with `'` or reject.
- **Headers / log lines** — strip CR/LF from any user value put into an HTTP header (response splitting) or a log line (log forging).
- **Redirects** — validate the target against an allow-list of internal paths; never `redirect(req.query.next)` raw (open redirect → phishing).

## The injection classes, with the fix in one line each

| Class | What it is | Fix |
|---|---|---|
| SQL injection | user value parsed as SQL | parameterize; allow-list identifiers |
| Command injection | user value parsed by a shell | argument array, no `shell=True` |
| XSS (stored/reflected/DOM) | user value parsed as HTML/JS | contextual escaping + CSP; avoid raw-HTML sinks |
| Path traversal | user value escapes a directory | canonicalize + confine to a base dir |
| SSRF | user value becomes a URL the server fetches | allow-list hosts; block internal/metadata IPs; no redirects |
| Insecure deserialization | attacker controls the object graph | don't deserialize untrusted data into live objects; use data-only formats (JSON) + schema, never `pickle`/`Marshal`/Java native |
| XXE | user XML references external entities | disable external entities / DTDs in the parser |
| ReDoS | user input triggers catastrophic backtracking | linear-time regex, input length cap, timeout |
| Template injection | user value is part of the template, not the data | never build templates from user input; pass it as a variable |

### SSRF deserves a note

Server-Side Request Forgery: the server fetches a user-supplied URL and the attacker points it at `http://169.254.169.254/` (cloud metadata) or `http://localhost:6379/` (internal Redis). Validating the URL string isn't enough — DNS rebinding and redirects defeat it. Defenses, layered: allow-list destination hosts; resolve the hostname and reject private/loopback/link-local IPs *on the resolved address*; disable redirects; use a dedicated egress proxy with no internal access.

## Checklist for an input-handling diff

1. Is every untrusted input identified at the point it enters (body, query, header, path, upload name, queue message, deserialized field)?
2. Is each one canonicalized **before** any check, then validated against an anchored allow-list (format, range, length, set)?
3. Does the boundary produce a typed value the rest of the code trusts, rather than a raw string re-checked downstream?
4. Is every SQL built with parameters (identifiers from an allow-list), every subprocess called with an argument array (no shell)?
5. Is every value bound for HTML/URL/LDAP/CSV/headers encoded for *that* sink, and is every raw-HTML opt-out justified and sanitized?
6. For any server-side fetch of a user URL: host allow-list, resolved-IP check, no redirects?
7. Is untrusted data ever deserialized into live objects (pickle/native)? If so, replace with a data-only format plus schema validation.
