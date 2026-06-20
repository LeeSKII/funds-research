# harvest-token — chrome-devtools MCP playbook

> **These are chrome-devtools MCP tool invocations executed by Claude** (the IDs below are the literal tool names), NOT Node calls or CLI commands. Run only when `core/auth.js` reports the token missing/expired (~14-day JWT). This is the **only** MCP step in the daily path.

> 🔴 **SPA hash pitfall (from CLAUDE.md):** morningstar.cn uses hash routing; the browser can serve a cached SPA state. Before loading a morningstar page, call `__navigate_page` to `about:blank` FIRST, then to the target URL, so Vue/React re-mounts and fetches fresh data (otherwise you read the previous page's state).

## Why MCP, not Node
The token lives in the browser session (localStorage or a request header). chrome-devtools MCP drives the real logged-in Chrome; Node cannot read browser state.

## Steps

1. **Open a logged-in session.**
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page` → `{type:"url", url:"https://www.morningstar.cn/#/screener"}`.
   - Confirm login via `mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot` (private data renders). If logged out → STOP, ask the user to log in.

2. **Read the token from localStorage.**
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script` with `function` = an arrow-function declaration (NOT arbitrary JS — the tool compiles the function body):
     ```js
     () => ({
       lsToken: localStorage.getItem('token'),
       lsKeys: Object.keys(localStorage).filter(k => /token|auth|jwt/i.test(k)),
     })
     ```
   - If `lsToken` is a 3-dot JWT (`xxx.yyy.zzz`) → `source = "localStorage"`, capture it.

3. **Fallback — read the token from a request header** (if localStorage has none).
   - Trigger a search in the page (or `__navigate_page` reload), then `mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_network_requests` with `resourceTypes:["fetch","xhr"]`.
   - Find the `POST /cn-api/v2/search/es` request; note its `reqid`.
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__get_network_request` with that `reqid` → read the `token` request header from the returned request object. `source = "header"`.

4. **Decode expiry** (to know when to re-harvest). `__evaluate_script`:
   ```js
   () => { try { const p = JSON.parse(atob(localStorage.getItem('token').split('.')[1])); return { exp: p.exp, iat: p.iat }; } catch (e) { return { error: String(e) }; } }
   ```
   (`exp`/`iat` are epoch-seconds if present.)

5. **Write `engine/secrets/token.json`** atomically (temp + rename). Shape:
   ```json
   { "token": "<jwt>", "exp": <epoch-seconds|null>, "source": "localStorage|header", "harvestedAt": "<ISO 8601>" }
   ```

6. **Verify** (Node, from `engine/`): `node -e "const {loadToken,isTokenExpired}=require('./core/auth'); const t=loadToken(); console.log('expired?', isTokenExpired(t))"` → expect `expired? false`.

7. **SECURITY.** Never print the token value in any output/log. Confirm `engine/.gitignore` excludes `secrets/*` (it does). `secrets/token.json` is local-only.

## When it fails
- No JWT anywhere + not logged in → ask the user to log in, then retry.
- Token present but every Node API call 401s → token may be IP/session-bound; record in MEMORY and escalate (Layer1-via-Node assumption violated — see Task 12 go/no-go).
