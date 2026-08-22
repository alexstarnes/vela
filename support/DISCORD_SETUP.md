# Discord setup — reference

Non-secret identifiers and a map of where every credential lives. **Secrets are deliberately absent
from this file** — it is committed; they are not.

---

## Identifiers (not secret, safe in git)


| Name                        | Value                 | Used for                                                      |
| --------------------------- | --------------------- | ------------------------------------------------------------- |
| Operator user ID            | `705628720722870343`  | `alert()` @mention; the approval allowlist                    |
| Guild (server) ID           | `1540558085121384479` | Per-guild slash command registration (instant vs. ~1h global) |
| Bot client / application ID | `1540559162059005994` | OAuth, command registration                                   |


### Channel IDs — fill these in

Developer Mode is already on. Right-click each channel → Copy Channel ID.


| Channel      | ID  | Purpose                                       |
| ------------ | --- | --------------------------------------------- |
| `#build-log` | `1540558189475401778`  | Build progress during Phases 0–8              |
| `#approvals` | `1540558222694424662`  | Phase 5 — approval requests with buttons      |
| `#activity`  | `1540558246765662339`  | Task lifecycle events                         |
| `#errors`    | `1540558272904568902`  | Agent errors, budget warnings, loop detection |


---



## Where each credential lives


| Credential                | Location                     | In git?          |
| ------------------------- | ---------------------------- | ---------------- |
| Webhook URL               | `.env` → `BUILD_WEBHOOK`     | **No**           |
| Bot token                 | `.env` → `DISCORD_BOT_TOKEN` | **No**           |
| User / guild / client IDs | `.env` **and** this file     | Yes (not secret) |




### Why `.env` and not the encrypted secrets path

`src/lib/security/secrets.ts` (AES-256-GCM, keyed by `GITHUB_TOKEN_ENCRYPTION_KEY`) exists for
**per-user, per-connection** tokens — GitHub OAuth tokens, one row per connection, rotated
independently. A single static service credential does not benefit from that machinery, and routing
it through the encrypted store creates a key-management dependency for one value that must be
available at process start anyway.

`.env` is correct here, with two conditions:

1. `.env` **is gitignored.** Verify, do not assume.
2. **The helper must not blanket-forward the web app's environment into spawned CLI processes.**
  Phase 0.3 of the completion plan already checks this for `ANTHROPIC_API_KEY`; the same inspection
   covers `DISCORD_BOT_TOKEN`. If the helper *does* forward wholesale, that is a finding worth
   fixing on its own merits — switch it to an explicit allowlist of variables it passes through.

---



## ⚠ Permissions correction

The initially generated OAuth URL used `permissions=2147567616`, which decodes to:

```
2147483648  Use Application Commands
     65536  Read Message History
     16384  Embed Links
      2048  Send Messages
```

`VIEW_CHANNEL` **(1024) is missing.** Without it the bot may not see the channels it is meant to
post in. Corrected value: `2147568640`.

```
https://discord.com/oauth2/authorize?client_id=1540559162059005994&permissions=2147568640&integration_type=0&scope=bot+applications.commands
```

Re-authorizing with the corrected URL updates permissions in place — no need to remove the bot
first. Alternatively, grant the bot access per-channel in each channel's permission settings.

---



## Rotation


| When                                                  | What                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot token exposed anywhere (chat, logs, a screenshot) | Developer Portal → Bot → Reset Token. Invalidates the old one immediately.                                                                                                                                                   |
| Webhook URL exposed                                   | Server Settings → Integrations → Webhooks → delete and recreate. A webhook URL is post-only to one channel, so the blast radius is message spam in `#build-log` — low severity, still worth rotating once the build is done. |


**The webhook URL currently in use was shared in a chat transcript.** Rotate it after Phase 8. The
bot token was correctly never pasted anywhere — keep it that way.

---



## Verifying before kickoff

```bash
# 1. Webhook reaches the channel
source .env
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"content":"webhook test"}' "$BUILD_WEBHOOK" && echo " → posted"

# 2. Mention actually pushes to your phone.
#    Lock your desktop or quit Discord first — Discord withholds mobile push
#    while you are active on desktop (Settings → Notifications → Push Notification
#    Inactive Timeout; set it to 1 minute).
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"content":"<@705628720722870343> mention test"}' "$BUILD_WEBHOOK"

# 3. .env is not tracked
git check-ignore -v .env || echo "!! .env IS NOT IGNORED — fix before continuing"
```

Test 2 is the one that matters. If it does not reach your phone, the unattended build has no way to
reach you, and every escalation in the kickoff rules is silent.