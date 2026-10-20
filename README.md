# start.soulshot.online

The web-first funnel: landing page, the quiz, personalizing, email, paywall and the
bridge to the app. Plain HTML, CSS and JS, no build step, same tokens and fonts as
`web/` (soulshot.online). The plan and the competitor decode are in
`docs/WEB_FUNNEL_PLAN.md`.

```
index.html        Landing: hero, the three sample players, how it works, plans, FAQ
quiz/index.html   The flow, one page
quiz/flow.js      The state machine: quiz → personalizing → email → code → paywall → success
quiz/questions.js GENERATED from src/config/quiz.ts + src/audio/voices.ts (do not edit)
funnel.css        Styles for the flow; site.css is a copy of web/site.css
voices/           The four delivery previews, same mp3s as the app
img/              Icons, the shot photos, the app captures, the Welcome orb clip
CNAME             start.soulshot.online
```

## The questions are the app's questions

`quiz/questions.js` is a bundle of the app's own `QUIZ_STEPS`, `visibleSteps`,
`canAdvance`, `deriveLane`, `toProfilePatch` and the voice list, transpiled and
loaded in the browser. Regenerate it after any change to the quiz:

```bash
node scripts/export-quiz.mjs
```

The web skips three steps (`WEB_SKIP` in flow.js): the prayer's voice and intentions
wait for the app, and the notification prompt is iOS-only. Everything else, including
the reflect copy and the commitment line, is word for word the app.

## What is wired and what is not (day 1–2 of the build)

Built: every screen, the quiz logic, the voice previews, the personalizing beats, the
15-second preview player (plays the chosen voice's preview until the generated shot
exists), the plan picker, the bridge page with a QR code on desktop, the draft in
`sessionStorage`, UTM capture, and a `track()` that queues funnel events in
`window.soulshotEvents` and forwards to `fbq` / `ttq` when the pixels exist.

Not wired (day 3, marked `TODO(day 3)` in flow.js): Clerk email-code sign-in, the
Supabase profile patch, the generated preview, RevenueCat Web Billing checkout, the
download email. On any real host those three stubs refuse with a message, so the page
cannot route someone past a price they never paid; on localhost or `file://` they
complete so the whole flow can be walked.

Testing in a browser console: `soulshotStart.profilePatch()` shows the patch the app
would write; `soulshotStart.reset()` clears the draft; `soulshotEvents` lists the events.

## Publishing

Served by GitHub Pages from the public repo `japcidro/soulshot-start` (branch `main`,
root) with the CNAME for `start.soulshot.online`. DNS: a CNAME record `start` →
`japcidro.github.io` at GoDaddy. Publish by copying this folder over:

```bash
scripts/publish-start.sh
```

Do not publish before day 3 is wired and the design critique and accessibility audit
have passed (the gate in `docs/WEB_FUNNEL_PLAN.md`).
