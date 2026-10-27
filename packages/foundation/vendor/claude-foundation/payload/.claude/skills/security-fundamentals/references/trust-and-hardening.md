# Trust Boundaries, Least Privilege, and Supply Chain

Moved from `SKILL.md` — principles 1, 6, and 7's full detail: naming the trust boundary, least-privilege/fail-closed defaults, and dependency/supply-chain hygiene.

## Principle 1 (from SKILL.md): Draw the trust boundary before you write the code

**Rule:** Before the first line, name who can reach this code and what they control. Every input that crosses from a less-trusted zone to a more-trusted one is a boundary, and the boundary is where defenses live.

**Why:** Security is a property of the *path*, not a function — you can't defend what you haven't located. Most injection and access-control bugs aren't "check written wrong" but "never realized this value came from the user." For each untrusted input, ask: who can send this, what can they control, and what's the blast radius if it's hostile? No STRIDE workshop needed — just ask the question before trusting the value.

**How to apply:**
- Mark every input as trusted or untrusted at the point it enters. Treat "from another internal service" as untrusted unless that service is itself authenticated and authorized — internal does not mean safe (server-side request forgery and confused-deputy bugs live here).
- For each untrusted input, write one sentence: *what can the caller control, and what is the blast radius if it is hostile?* A filename controls a path (traversal). A redirect URL controls where the browser goes (open redirect). A user id in the body controls whose data you fetch (IDOR).
- Distinguish authenticated from anonymous reachability. An endpoint reachable before login has a strictly larger attack surface than one behind auth.
- Watch the indirect boundaries: deserialization (the object graph is attacker-controlled), template rendering (the template string may be), regular expressions over user input (catastrophic backtracking — ReDoS), and any value that later becomes part of a command, query, path, or URL.

**Example:**
```ts
// The boundary is invisible until you name it.
// This handler trusts THREE untrusted inputs without realizing it:
app.get('/files/:name', async (req, res) => {
  const path = `./uploads/${req.params.name}`        // name → path traversal (../../etc/passwd)
  const userId = req.query.userId                     // userId → IDOR (whose files?)
  const next = req.query.redirect                     // redirect → open redirect
  res.sendFile(path)
})

// Boundary named, each input's blast radius noted, defenses placed (see principles 2-4):
//  - name: canonicalize + confine to uploads dir (traversal)
//  - userId: ignore it; derive identity from the session (authz, principle 4)
//  - redirect: allow-list of internal paths only (open redirect)
```

## Principle 6 (from SKILL.md): Least privilege and secure defaults — fail closed

**Rule:** Every actor — a token, a DB user, a service account, a file, a CORS policy — gets the minimum scope it needs and nothing more. The default state, and the state on error, is the restrictive one.

**Why:** Least privilege turns a compromise into an incident instead of a catastrophe — blast radius is bounded by what you granted. Granting broad access "to be safe" makes every small breach total. Failing closed is the same instinct on the unhappy path: when an auth check throws, deny; insecure defaults (debug in prod, `cors: *` with credentials, default admin passwords, verbose errors to clients) are vulnerabilities shipped on purpose.

**How to apply:**
- Scope tokens, API keys, and OAuth grants to the narrowest set of actions and resources. A read job gets a read-only token. A webhook verifier needs no write scope.
- The application's DB user is not the schema owner. Grant only the DML it needs; keep DDL and superuser for migrations run separately. One injection then can't reshape the database.
- File and process permissions: least privilege on what you write (no world-writable), run services as a non-root user, drop capabilities you don't need.
- Fail closed: a thrown authz check denies; a missing required config refuses to start rather than defaulting to permissive; an unparseable token is rejected. Never `catch { return true }` on a security decision (see `team-silent-failure-hunter` territory).
- Secure defaults in config: CORS to an explicit origin allow-list (not `*` with credentials), cookies secure by default, TLS required, debug/verbose errors off in production, no default credentials. Send generic error messages to clients; keep the detail in server logs.

**Example:**
```ts
// Bad — broad scope, open defaults, fails open
const db = connect({ user: 'postgres' })              // superuser runs the web app
app.use(cors({ origin: '*', credentials: true }))     // any site can make credentialed calls
function canAccess(u, r) {
  try { return policy.check(u, r) }
  catch { return true }                               // fails OPEN — error → access granted
}

// Good — least privilege, explicit allow-list, fails closed
const db = connect({ user: 'app_rw' })                // SELECT/INSERT/UPDATE on app tables only
app.use(cors({ origin: ['https://app.example.com'], credentials: true }))
function canAccess(u, r) {
  try { return policy.check(u, r) }
  catch (e) { log.error(e); return false }            // fails CLOSED — error → denied
}
```

## Principle 7 (from SKILL.md): Dependencies and the supply chain — pin, patch, minimize

**Rule:** Treat every dependency as code you ship and are responsible for. Pin versions with a lockfile, watch for known vulnerabilities, and import as little as you can get away with.

**Why:** A CVE in a transitive dep is as exploitable as one in your own code — unpatched known vulnerabilities are a perennial OWASP top entry. The supply chain is an attack surface: typosquatted names, malicious updates, compromised maintainers, `postinstall` scripts that exfiltrate your env. Every package = trust extended to its whole dependency tree and everyone who can publish to it.

**How to apply:**
- Commit the lockfile (`package-lock.json`, `poetry.lock`, `Cargo.lock`; in Go, `go.mod` pins and `go.sum` verifies) and build from it (`npm ci`, not `npm install`) so the exact resolved tree is reproducible and a surprise version can't appear between builds.
- Run a vulnerability scanner in CI (`npm audit`, `pip-audit`, `osv-scanner`, Dependabot/Renovate) and treat a high-severity advisory in a reachable path as a blocker, not a someday.
- Minimize: prefer the standard library or a small, well-maintained package over a sprawling one. A left-pad-sized dependency is a left-pad-sized risk. Audit a new dependency's own tree before adding it.
- Pin and review updates. Auto-merging dependency bumps without a lockfile-diff review is how a compromised release lands. Be especially wary of install-time scripts (`postinstall`) from packages you don't control.
- Don't run untrusted code with your privileges: avoid `eval` of remote content, sandbox plugins, and verify integrity (subresource integrity for CDN scripts, checksums for downloaded binaries).

**Example:**
```jsonc
// Bad — floating ranges, no lockfile discipline; "install" re-resolves every build
// package.json
{ "dependencies": { "leftpad-clone": "^2.0.0" } }   // ^ silently pulls a malicious 2.4.0
// CI: npm install            ← may resolve a different tree than you tested

// Good — lockfile committed, reproducible install, scanned in CI
// CI:
//   npm ci                   ← builds the exact locked tree, fails on lockfile drift
//   npm audit --audit-level=high   ← high-severity CVE in a reachable dep blocks the build
```
