# Demo runbook (recording the video)

Mock mode unless a step says live. Pocket starts at 3.00, reserve 2.00 (same state as the README hero).

## Setup (once)
1. `npm install && npm run demo` (prints the Home URL and the one-time console code). Use a fresh Chrome window for Home and a private window at 390 px width for the phone.
2. Pair: Home, "Pair a phone", open the pairing link in the private window, confirm the code on Home.
3. Assets for cutaways are in `evidence/video/assets/`.

## Scenes (about 90 s)
1. **Problem (10 s):** `mock-wallet-balance.png`, `mock-call-support.png`, `mock-approve-unlimited.png`; then one article cutaway (Guardian, Decrypt).
2. **Get paid (15 s):** pay page `/pay/demo`, amount 5, "Payment in". Home shows the split and the Payday summary.
3. **Phone (15 s):** `/phone` shows the pocket only, no reserve anywhere.
4. **The attack (20 s):** on the phone send 500: red refusal. Say the limit is the pocket plus authorised refills.
5. **Bills (10 s):** Rent, Pay, flips to Paid.
6. **Proof (20 s):** `npm run attack` (38 PASS), then NearBlocks tx Ctf1jaTE… (a real refill; the reserve account is not a party).

## Tick check (live instance)
Platform 503s used to hit about every 4 h (14:00, 18:00, 22:00, 02:00 UTC). Since the redeploy of 13 Nov 11:47Z, reads retry and log a soft `tick_warning`. After a window:
```
ssh root@2.29.11.26 'cd /opt/carry && node --no-warnings -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"data/carry.db\",{readOnly:true});console.log(d.prepare(\"select ts,kind,ok from events where kind like \x27tick_%\x27 order by id desc limit 10\").all())"'
```
A `tick_warning` with ok=1 is fine; a `tick_error` is not.

## Before submitting
Repo public (it is), demo post on X by the owner (@NEARProtocol, #NEARHackathon), then the owner confirms `evidence/submission-draft.json`.
