# Demo runbook (recording the video)

Updated 14 Nov 2026 for the live instance's state today. Nothing here posts or submits anything.

## State of https://carry.ajkadri.dev right now (read from the live event log, 12:40Z)

| | Now |
|---|---|
| Reserve (Protected) | 0.969482 USDC |
| Pocket (phone) | 1.26 USDC (ceiling 20, one send up to 10) |
| Refill allowance | 0 |
| Last events | `payment_in` 0.499898 from Base, then `refill_skipped: no refill allowance left` |
| Pay page | five sources: USDC on Solana, Base, Arbitrum, Ethereum; USDT on Tron. Quote-tested only except Solana and Base (live payments). Cheapest real one: Base, minimum about 0.15 USDC |

Money events already in Home's Activity (Money tab): the Base payment, the skipped refill and a few red "blocked request" rows. Those red rows are my own unsigned outside checks of 13 and 14 Nov, refused as designed. They are real records; leave them, and say "refused requests" if they show.

## The first take: a clean split on the live instance (new spend 0.60 USDC)

### Why the order matters (read this once)
The engine ticks every 5 s. A refill goes to the oldest payment that has none; if there is no payment waiting, a **timer** may top the pocket up from the reserve, **once per 5-minute window** (windows start on the clock at :00, :05, :10 ...). So if you set an allowance *before* the payment lands, the timer takes it within 5 s from the reserve's existing money, and the payment then finds allowance 0 ("No refill this time"). Balances end up the same, but the story is wrong. To make the **payment** trigger the refill, use up the window's timer first, then set the real allowance, then pay, all inside the same 5-minute window. The payment must land (about 1 minute from Base) before the window ends.

Plan the numbers so the split reads cleanly: pay **0.60 USDC** on Base (arrives as about 0.5999 after fees), allowance **0.30**.

### Before you start (not recorded)
1. Home open and signed in on the laptop; phone paired (private window, 390 px wide). Phone shows 1.26.
2. Pay page open in a third tab: `/pay/demo`, "Pay with" **USDC on Base**, amount **0.6**, your own Base address as the refund address. Press **Get payment address** now (the address stays valid for 72 h) and have your wallet ready to send exactly **0.60 USDC on Base** to it. The page shows the fee (about 0.0002) and the minimum (about 0.15 USDC).
3. Check the state (read-only):
   ```
   ssh root@2.29.11.26 'cd /opt/carry && node --no-warnings -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"data/carry.db\",{readOnly:true});console.log(d.prepare(\"select key,value from kv where key in (\x27allowance_remaining\x27,\x27phone_ceiling\x27)\").all());console.log(d.prepare(\"select ts,kind,amount from events order by id desc limit 5\").all())"'
   ```
   Expect allowance 0. Check the clock: `date -u`. The window you use starts at the next :00, :05, :10 ... Start the next step within the first 20 seconds of a window, so that about 4 minutes remain.

### Burn the window's timer (not recorded, about 15 s)
4. Home, "Authorise total refills": type **0.01**, press **Set**. Within about 10 s Activity shows "Moved 0.01 to your pocket" and the phone shows 1.27. (This moves 0.01 USDC of your own reserve money; it is not new spend.) Reserve is now 0.959482, allowance 0.

### The take (recorded; the rest of the window is about 3.5 minutes, the payment needs about 1)
5. **Home, hero** (1440 px): "If your phone is lost tonight, at most **1.27** USDC is at risk", Protected **0.96**. Say: "The phone holds 1.27. Everything else is in a reserve it cannot see."
6. **Set the allowance on camera:** type **0.30**, press **Set**. Activity: "Refill allowance set to 0.30". The hero line now reads at most **1.57** at risk (pocket 1.27 plus the 0.30 you have authorised), Protected still 0.96. Say: "I authorise 0.30 of refills."
7. **Pay:** send **0.60 USDC on Base** to the deposit address. Show the pay page: "Waiting for your payment", then "Payment seen, settling…" and "Payment received" (about 1 minute). Also show the wallet's own confirmation and, if you like, the Base transaction on Basescan.
8. **What must appear, in order, on Home (about 5 to 10 s after "Payment received"):**
   - Activity (Money): "Payment received 0.60" (really 0.5999), then "Moved 0.30 to your pocket".
   - **Payday**: one line "Incoming 0.60" forking into **Pocket +0.30** and **Protected +0.30** (the exact pair is 0.3000 and about 0.2999; shown to two decimals).
   - Hero: at most **1.57** at risk (allowance now 0, so exactly the pocket), Protected about **1.26**. Pocket card 1.57.
9. **Phone** (reload or wait for its poll): pocket **1.57**, the pocket bar fuller, Payday with no reserve amount anywhere. Say: "The phone sees its pocket. It never sees the 1.26 behind it."
10. Optional, same take: on the phone send **500** to any account: red refusal "Blocked: this phone can send at most 10.00 USDC at a time." with the raw JSON underneath. Nothing moves.

### Expected numbers (use these to check the take)
| | Before step 4 | After step 4 | After step 8 |
|---|---|---|---|
| Pocket | 1.26 | 1.27 | **1.57** |
| Reserve (Protected) | 0.969482 | 0.959482 | about **1.2594** |
| Allowance | 0 | 0 | 0 |

(Reserve after = 0.959482 + about 0.59988 arriving − 0.30 refill. The arriving amount is whatever 1Click reports; read it from the `payment_in` row.)

### If it goes wrong
- **The payment lands after the window ended** (the next window's timer took the 0.30 first): balances are still right (pocket 1.57, reserve about 1.26), but Activity shows "Moved 0.30" before the payment and "No refill this time: no refill allowance left" after it. Do not re-record with the same payment; take the mock take below, or burn the next window and repeat only if you are willing to spend another 0.60.
- **Nothing happens after "Payment received":** wait one more tick (5 s). If still nothing, read the log (command in step 3); a `refill_*` row with a reason says why.
- **A `tick_warning` shows in System:** harmless (a platform hiccup, retried). A `tick_error` is not; tell me.

## Fallback: the same take in mock mode (no money, no windows)
1. `npm install && npm run demo` (prints the setup code). Home in one window, the phone in a private window at 390 px, pay page in a third.
2. Pair: Home, "Pair phone", open the pairing link in the private window, confirm the code on Home.
3. The mock starts with allowance **3.00**. Pay page: amount 5, any Solana address (or pick another source and a matching address), "Get payment address", "Mock: simulate this payment". Home: Payday Incoming 5.00 forking Pocket +3.00 and Protected +2.00; hero "at most 3.00 at risk"; Protected 2.00. Phone: 3.00. This is the state of the README hero and of the captures in `evidence/video/assets/`.
4. Phone, send 500: red refusal (10.00 limit). Home, Pre-approved bill: Name Rent, payee `d7041ab1063b3f017ae4d43857b225c2897b0d39682cbd2048c539a04b4805a4` (the mock landlord), amount 1.5, Save; phone, Pay on Rent: it flips to Paid.

## Cutaway assets (`evidence/video/assets/`)
- Problem scene: `mock-wallet-balance.png` (one month's pay), `mock-call-support.png`, `mock-approve-unlimited.png`.
- Why it matters: `article-guardian.png` and `article-guardian-phone-search.png` (Guardian, 5 Jan 2025), `article-gazette.png`, `article-icir.png`, `article-decrypt.png` (72 attacks in 2025, up 75%). Each has a teal box and a site/date bar added by me.
- Proof: `nearblocks-tx.png` (Ctf1jaTE…, the 0.25 USDC refill of 9 Nov; the reserve is not a party, caption on the image). Real Base payment: https://basescan.org/tx/0x9f8f403eeb7ba2ecdd3406c35a8f5b2ea761b3ed205a7fec04200382828fd93e. `npm run attack` (mock): 38 PASS, 0 FAIL.
- Mock-mode motion: `phone-scroll.mp4`, `phone-rent-paid.mp4`, `home-payday-split.mp4` (60 fps), stills `phone-refusal-crop.png`, `phone-refusal-fullscreen.png`, `home-summary-hero.png`, `home-payday-split.png`.

## Tick check (live instance, read-only)
Platform 503s used to hit every 4 h (14:00, 18:00, 22:00, 02:00 UTC). Since the redeploy of 13 Nov 11:47Z reads retry and log a soft `tick_warning` (System tab). Command:
```
ssh root@2.29.11.26 'cd /opt/carry && node --no-warnings -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"data/carry.db\",{readOnly:true});console.log(d.prepare(\"select ts,kind,ok from events where (kind like \x27tick_%\x27 or ok=0) and ts>=\x272026-11-13T11:47\x27 order by id\").all())"'
```
Result on 14 Nov 12:39Z for 13 Nov 14:00 and 18:00 and 14 Nov 02:00, 06:00, 10:00: no `tick_warning` and no `tick_error` in any of them.

## Before submitting
Repo is public. The owner posts the demo on X (@NEARProtocol, #NEARHackathon) and sends the link. Then the owner fills the OWNER-FILL fields in `evidence/submission-draft.json`, reads the full payload, and says yes. Nothing is submitted before that.
