/* SoulShot — start.soulshot.online, the flow engine.
 *
 * One page, one state machine: quiz → personalizing → email → code → paywall
 * → success. The questions, the reflect copy, the lane rules and the voice list
 * come from questions.js, which scripts/export-quiz.mjs generates from the
 * app's own src/config/quiz.ts, so what the web asks is what the app asks.
 *
 * Nothing here talks to a server yet. The three stubs marked TODO(day 3) are
 * where Clerk (email code), Supabase (the profile patch) and RevenueCat Web
 * Billing (checkout) plug in. Until then the paywall refuses to "buy" on any
 * real host, so an early publish cannot route people past a price they never
 * paid.
 */
(function () {
  'use strict'

  var Q = window.SOULSHOT_QUIZ
  var stage = document.getElementById('stage')
  if (!Q) {
    stage.textContent = 'The questions did not load. Refresh the page, or get the app and answer there.'
    return
  }

  // ---- Configuration -----------------------------------------------------

  var APP_STORE = 'https://apps.apple.com/app/id6813150517'
  var SITE = 'https://soulshot.online/'
  var SUPPORT = 'hello@soulshot.online'

  /** The two store plans, at store prices. Day 3 reads these from RevenueCat instead. */
  var PLANS = [
    { id: 'weekly', label: 'Weekly', price: 5.99, period: 'week', trialDays: 0, perDay: 5.99 / 7 },
    { id: 'yearly', label: 'Yearly', price: 59.99, period: 'year', trialDays: 3, perDay: 59.99 / 365 },
  ]
  var DEFAULT_PLAN = 'weekly'

  /**
   * Steps the web does not ask. The prayer's voice and intentions wait for
   * the app (both live under Profile, and the first prayer works without
   * them); the notification step is an iOS permission prompt.
   */
  var WEB_SKIP = { prayer_voice: true, prayer_over: true, notify: true }

  /** Same pacing as the app's PersonalizingScreen. */
  var LINE_MS = 2250
  var PREVIEW_SECONDS = 15
  var DRAFT_KEY = 'soulshot.start.v1'

  /** Steps whose answer lives under a different key than the step. */
  var ANSWER_KEY = { lift: 'lift_moments', prayer_when: 'prayer_moments', faith: 'faith_bg', name: 'first_name', goal: 'goal_text' }

  var MOMENT_BADGE = { waking_up: 'Morning', commute: 'Commute', midday: 'Midday', before_sleep: 'Tonight' }
  var LANE_PHOTO = { motivation: '../img/motivation.jpg', manifestation: '../img/manifestation.jpg', prayer: '../img/prayer.jpg' }

  /** The question heading's id, so fields and chip groups can name it. */
  var PROMPT_ID = 'prompt'

  /** Inline SVG for the few icons. Declared here because the first render reads it. */
  var ICON = {
    play: '<svg class="ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><svg class="ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
    apple: '<svg viewBox="0 0 165 40" aria-hidden="true"><path d="M30.8 21.2c0-3.6 3-5.4 3.1-5.5-1.7-2.5-4.3-2.8-5.3-2.8-2.2-.2-4.4 1.3-5.5 1.3-1.1 0-2.9-1.3-4.8-1.3-2.4 0-4.7 1.4-6 3.6-2.6 4.5-.7 11.1 1.8 14.7 1.2 1.8 2.7 3.8 4.6 3.7 1.8-.1 2.5-1.2 4.8-1.2 2.2 0 2.9 1.2 4.8 1.1 2 0 3.2-1.8 4.4-3.6 1.4-2 2-4 2-4.1-.1 0-3.9-1.5-3.9-5.9zM27.2 10.5c1-1.2 1.7-2.9 1.5-4.5-1.4.1-3.2 1-4.2 2.2-.9 1.1-1.7 2.8-1.5 4.4 1.6.1 3.2-.8 4.2-2.1z"/><text x="42" y="29" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="22" font-weight="600" fill="currentColor">Pay</text></svg>',
  }

  /** A dev host: file://, localhost, or a LAN address. The stubs only complete there. */
  var DEV = location.protocol === 'file:' || /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(location.hostname)

  // ---- State -------------------------------------------------------------

  var state = {
    view: 'quiz',
    step: Q.FIRST_STEP,
    answers: clone(Q.EMPTY_ANSWERS),
    email: '',
    plan: DEFAULT_PLAN,
    /** The generated first shot's preview, once day 3 makes one. */
    previewUrl: null,
    utm: {},
    started: false,
  }
  var preview = document.getElementById('preview')
  var timers = []

  load()
  captureUtm()
  render()

  // ---- Small helpers -----------------------------------------------------

  function clone(o) { return JSON.parse(JSON.stringify(o)) }

  function h(tag, attrs, children) {
    var el = document.createElement(tag)
    attrs = attrs || {}
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]
      if (v === null || v === undefined || v === false) return
      if (k === 'class') el.className = v
      else if (k === 'text') el.textContent = v
      else if (k === 'html') el.innerHTML = v // only ever our own SVG markup
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v)
      else if (k === 'hidden') el.hidden = Boolean(v)
      else el.setAttribute(k, v === true ? '' : v)
    })
    ;(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
    return el
  }


  function name() { return state.answers.first_name.trim() }

  /** Up to ~40 characters of their words, at a word boundary. */
  function clip(s, max) {
    max = max || 40
    s = String(s || '').trim()
    if (s.length <= max) return s
    var cut = s.slice(0, max).replace(/\s+\S*$/, '')
    return (cut || s.slice(0, max)) + '…'
  }

  function money(n) { return '$' + n.toFixed(2) }
  function perDay(plan) { return Math.round(plan.perDay * 100) + '¢ a day' }
  function dateIn(days) {
    var d = new Date(Date.now() + days * 864e5)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  }

  function save() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state)) } catch (e) { /* private mode */ }
  }
  function load() {
    try {
      var raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      var saved = JSON.parse(raw)
      // Lay the draft over the empty answers so a new question never reads undefined.
      state.answers = Object.assign(clone(Q.EMPTY_ANSWERS), saved.answers || {})
      state.email = saved.email || ''
      state.plan = saved.plan || DEFAULT_PLAN
      state.utm = saved.utm || {}
      state.started = Boolean(saved.started)
      state.previewUrl = saved.previewUrl || null
      var view = saved.view
      if (view === 'personalizing') view = 'quiz'
      if (view === 'code') view = 'email'
      state.view = view || 'quiz'
      state.step = Q.QUIZ_STEPS[saved.step] && !WEB_SKIP[saved.step] ? saved.step : Q.FIRST_STEP
    } catch (e) { /* a bad draft is just a fresh start */ }
  }

  function captureUtm() {
    var params = new URLSearchParams(location.search)
    var got = false
    params.forEach(function (v, k) {
      if (/^utm_/.test(k) || k === 'fbclid' || k === 'ttclid') { state.utm[k] = v; got = true }
    })
    if (got) save()
  }

  /**
   * Funnel events. The pixel tags (Meta, TikTok) are added on day 5; until
   * then every event sits in window.soulshotEvents, which is also handy in
   * the console while testing.
   */
  function track(event, props) {
    var row = Object.assign({ event: event, at: Date.now() }, props || {})
    ;(window.soulshotEvents = window.soulshotEvents || []).push(row)
    if (typeof window.fbq === 'function') window.fbq('trackCustom', event, props || {})
    if (window.ttq && typeof window.ttq.track === 'function') window.ttq.track(event, props || {})
  }

  function clearTimers() { timers.forEach(clearTimeout); timers = [] }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)) }

  function stopPreview() {
    preview.pause()
    preview.currentTime = 0
    preview.volume = 1
    preview.onended = preview.ontimeupdate = null
    document.querySelectorAll('.playing').forEach(function (el) { el.classList.remove('playing') })
    document.querySelectorAll('.voice .visually-hidden').forEach(function (el) { el.textContent = '' })
    document.querySelectorAll('.card .play').forEach(function (b) { b.setAttribute('aria-label', 'Play the preview') })
  }

  // ---- The web's view of the quiz ---------------------------------------

  function webSteps() {
    return Q.visibleSteps(state.answers).filter(function (k) { return !WEB_SKIP[k] })
  }
  function stepAfter(k) { var s = webSteps(); return s[s.indexOf(k) + 1] || null }
  function stepBefore(k) { var s = webSteps(); return s[s.indexOf(k) - 1] || null }
  function questionNumber(k) {
    return webSteps().filter(function (s) { return Q.isQuestion(s) }).indexOf(k) + 1
  }

  /** 0–100. The quiz runs to 84; the rest of the stations take the last ticks. */
  function progress() {
    var fixed = { personalizing: 88, email: 92, code: 95, paywall: 100, success: 100 }
    if (state.view !== 'quiz') return fixed[state.view] || 0
    var s = webSteps()
    return Math.round(((s.indexOf(state.step) + 1) / s.length) * 84)
  }

  function go(view, step) {
    clearTimers()
    stopPreview()
    state.view = view
    if (step) state.step = step
    save()
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' })
    render()
  }

  function setAnswer(key, value) { state.answers[key] = value; save() }

  function advance() {
    var step = state.step
    if (!Q.canAdvance(state.answers, step)) return
    if (Q.isQuestion(step)) track('quiz_q' + questionNumber(step) + '_answered', { step: step })
    var next = stepAfter(step)
    if (next) go('quiz', next)
    else { track('quiz_complete'); go('personalizing') }
  }

  // ---- Rendering ---------------------------------------------------------

  function render() {
    stage.innerHTML = ''
    stage.classList.remove('center')
    document.getElementById('fill').style.width = progress() + '%'
    document.getElementById('progress').setAttribute('aria-valuenow', String(progress()))

    var back = document.getElementById('back')
    var brand = document.getElementById('brand')
    var bar = document.getElementById('progress')
    var showBack = state.view === 'quiz' || state.view === 'email' || state.view === 'code'
    back.hidden = !showBack
    bar.hidden = state.view === 'paywall' || state.view === 'success'
    brand.hidden = !bar.hidden
    back.onclick = function () {
      if (state.view === 'code') return go('email')
      if (state.view === 'email') return go('quiz', webSteps().slice(-1)[0])
      var prev = stepBefore(state.step)
      if (prev) go('quiz', prev)
      else location.href = '../'
    }

    switch (state.view) {
      case 'quiz': renderStep(); break
      case 'personalizing': renderPersonalizing(); break
      case 'email': renderEmail(); break
      case 'code': renderCode(); break
      case 'paywall': renderPaywall(); break
      case 'success': renderSuccess(); break
    }
    focusPrompt()
  }

  /**
   * Each screen is a new page to a screen reader, so focus moves to its
   * heading (or to its field, when the screen has one). Without this, focus
   * falls back to <body> on every step and the question is never announced.
   */
  function focusPrompt() {
    if (stage.querySelector('[data-autofocus]')) return
    var head = stage.querySelector('h1')
    if (!head) return
    head.setAttribute('tabindex', '-1')
    head.focus({ preventScroll: true })
  }


  function renderStep() {
    if (!state.started) { state.started = true; save(); track('onboarding_start', { utm: state.utm }) }
    var key = state.step
    var step = Q.QUIZ_STEPS[key]
    var a = state.answers
    var nm = name()

    if (step.kind === 'reflect') return renderReflect(step)
    if (step.kind === 'commit') return renderCommit(step)

    var head = h('div', {}, [
      step.eyebrow ? h('div', { class: 'eyebrow', text: step.eyebrow }) : null,
      h('h1', { class: 'prompt', id: PROMPT_ID, text: step.prompt(nm) }),
      step.hint ? h('p', { class: 'hint', text: step.hint(nm) }) : null,
    ])
    var body = h('div', {})
    var cta = h('button', { class: 'cta ghost', type: 'button', text: 'Continue', onclick: advance })
    var refresh = function () { cta.disabled = !Q.canAdvance(a, key) }

    if (step.kind === 'single' || step.kind === 'multi') {
      var akey = ANSWER_KEY[key] || key
      var textKey = key === 'season' ? 'season_text' : key + '_text'
      var chips = h('div', { class: 'chips', role: 'group', 'aria-labelledby': PROMPT_ID })
      var other = h('input', {
        class: 'field other', type: 'text', placeholder: step.placeholder || '', maxlength: '120', autocomplete: 'off',
        'aria-label': step.placeholder || 'In your own words',
        value: a[textKey] || '', hidden: true,
        oninput: function (e) { setAnswer(textKey, e.target.value); refresh() },
        onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); advance() } },
      })
      var picked = function (v) { return step.kind === 'multi' ? a[akey].indexOf(v) >= 0 : a[akey] === v }
      var paint = function () {
        chips.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', picked(c.dataset.value) ? 'true' : 'false') })
        var wantsOther = picked('other')
        other.hidden = !wantsOther
        refresh()
      }
      step.options.forEach(function (opt) {
        chips.appendChild(h('button', {
          class: 'chip', type: 'button', text: opt.label, 'data-value': opt.value, 'aria-pressed': 'false',
          onclick: function () {
            if (step.kind === 'multi') {
              var list = a[akey].slice()
              var i = list.indexOf(opt.value)
              if (i >= 0) list.splice(i, 1)
              else if (opt.value === 'all') list = ['all']
              else if (key === 'lift' && list.length >= Q.MAX_MOMENTS) return // "Pick up to three": a fourth tap does nothing
              else { list = list.filter(function (v) { return v !== 'all' }); list.push(opt.value) }
              setAnswer(akey, list)
            } else {
              setAnswer(akey, a[akey] === opt.value ? null : opt.value)
            }
            paint()
            if (opt.value === 'other' && picked('other')) other.focus()
          },
        }))
      })
      body.appendChild(chips)
      body.appendChild(other)
      paint()
    }

    if (step.kind === 'text') {
      var field
      var textKeyT = ANSWER_KEY[key] || key + '_text'
      if (key === 'goal') {
        field = h('textarea', { class: 'field', rows: '3', placeholder: step.placeholder || '', maxlength: '240', 'aria-labelledby': PROMPT_ID, 'data-autofocus': '' })
        field.value = a[textKeyT] || ''
        var starters = h('div', { class: 'starters', role: 'group', 'aria-label': 'Ways to start' })
        ;(step.starters || []).forEach(function (s) {
          starters.appendChild(h('button', { class: 'chip', type: 'button', text: s, onclick: function () {
            field.value = s; setAnswer(textKeyT, s); refresh(); field.focus()
            field.setSelectionRange(field.value.length, field.value.length)
          } }))
        })
        body.appendChild(starters)
      } else {
        field = h('input', { class: 'field', type: 'text', placeholder: step.placeholder || '', maxlength: '40', autocomplete: key === 'name' ? 'given-name' : 'off', autocapitalize: 'words', 'aria-labelledby': PROMPT_ID, 'data-autofocus': '' })
        field.value = a[textKeyT] || ''
      }
      field.addEventListener('input', function (e) { setAnswer(textKeyT, e.target.value); refresh() })
      field.addEventListener('keydown', function (e) { if (e.key === 'Enter' && field.tagName !== 'TEXTAREA') { e.preventDefault(); advance() } })
      body.appendChild(field)
      later(function () { field.focus({ preventScroll: true }) }, 380)
    }

    if (step.kind === 'voice') {
      var list = h('div', { class: 'voices', role: 'group', 'aria-labelledby': PROMPT_ID })
      Q.VOICE_PRESETS.forEach(function (v) {
        var status = h('span', { class: 'visually-hidden' })
        var row = h('button', { class: 'voice', type: 'button', 'aria-pressed': a.voice_id === v.id ? 'true' : 'false' }, [
          h('span', { class: 'disc ' + (v.disc || ''), html: ICON.play }),
          h('span', {}, [h('b', { text: v.label }), h('small', { text: v.description }), status]),
        ])
        var sayPlaying = function (on) { status.textContent = on ? ' Playing the sample.' : '' }
        row.addEventListener('click', function () {
          setAnswer('voice_id', v.id)
          list.querySelectorAll('.voice').forEach(function (r) { r.setAttribute('aria-pressed', r === row ? 'true' : 'false') })
          cta.textContent = 'Sounds right'
          refresh()
          if (row.classList.contains('playing')) { stopPreview(); return }
          stopPreview()
          if (!v.preview) return
          preview.src = '../' + v.preview
          preview.volume = 1
          row.classList.add('playing'); sayPlaying(true)
          preview.onended = function () { row.classList.remove('playing'); sayPlaying(false) }
          preview.play().catch(function () { row.classList.remove('playing'); sayPlaying(false) })
        })
        list.appendChild(row)
      })
      body.appendChild(list)
      if (a.voice_id) cta.textContent = 'Sounds right'
    }

    refresh()
    stage.appendChild(head)
    stage.appendChild(body)
    stage.appendChild(h('div', { class: 'actions' }, [cta]))
  }

  function renderReflect(step) {
    var m = step.mirror(state.answers)
    stage.appendChild(h('div', { class: 'reflect' }, [
      h('div', { class: 'orb xl', 'aria-hidden': 'true' }),
      h('h1', { class: 'prompt', id: PROMPT_ID, text: m.title }),
      m.quote ? h('p', { class: 'quote', text: '“' + m.quote + '”' }) : null,
      h('p', { class: 'hint', text: m.body }),
    ]))
    stage.appendChild(h('div', { class: 'actions' }, [
      h('button', { class: 'cta', type: 'button', text: step.cta || 'Continue', onclick: advance }),
    ]))
  }

  function renderCommit(step) {
    var m = step.mirror(state.answers)
    stage.appendChild(h('div', { class: 'commit' }, [
      h('h1', { class: 'prompt', id: PROMPT_ID, text: m.title }),
      h('p', { class: 'hint', text: m.body }),
      h('div', { class: 'orb md', 'aria-hidden': 'true' }),
    ]))
    stage.appendChild(h('div', { class: 'actions' }, [
      h('button', { class: 'cta', type: 'button', text: step.cta || 'Yes, I can', onclick: function () {
        setAnswer('committed', true)
        advance()
      } }),
    ]))
  }

  function personalizingLines() {
    var a = state.answers
    var goal = a.goal_text.trim()
    var struggles = Q.listStruggles(a.struggles, a.struggles_text)
    var preset = Q.presetFor(a.voice_id)
    var voice = preset ? preset.label : ''
    return [
      goal ? 'Reading what you wrote about “' + clip(goal) + '”…' : 'Reading what you’re carrying…',
      struggles ? 'Choosing words for ' + struggles.toLowerCase() + '…' : 'Choosing your words…',
      voice ? 'Tuning Sol to ' + (/^the /i.test(voice) ? voice.toLowerCase() : 'a ' + voice.toLowerCase()) + '…' : 'Finding your voice…',
      goal ? 'Sol will start with: “You said ‘' + clip(goal) + '’.”' : 'Almost there…',
    ]
  }

  function renderPersonalizing() {
    stage.classList.add('center')
    track('personalizing_view')
    var ring = h('div', { class: 'ring', 'aria-hidden': 'true' }, [h('span', { class: 'orb' })])
    var lines = personalizingLines()
    var beats = h('div', { class: 'beats', role: 'list' })
    var rows = lines.map(function (text) {
      var row = h('div', { class: 'beat', role: 'listitem' }, [h('i', { html: ICON.check }), h('span', { text: text })])
      beats.appendChild(row)
      return row
    })
    var status = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' })
    var wrap = h('div', {}, [
      h('h1', { class: 'visually-hidden', id: PROMPT_ID, text: 'Writing your first shot' }),
      ring, beats, h('p', { class: 'sub', style: 'margin-top:28px', text: 'About ten seconds.' }), status,
    ])
    stage.appendChild(wrap)

    var total = lines.length * LINE_MS
    var start = Date.now()
    var tick = function () {
      var p = Math.min(1, (Date.now() - start) / total)
      ring.style.setProperty('--p', (p * 100).toFixed(1) + '%')
      if (p < 1) timers.push(setTimeout(tick, 80))
    }
    tick()
    rows.forEach(function (row, i) {
      later(function () { row.classList.add('on'); status.textContent = lines[i] }, i * LINE_MS)
      later(function () { row.classList.remove('on'); row.classList.add('done') }, (i + 1) * LINE_MS - 300)
    })
    later(function () { go('email') }, total + 400)
  }

  function renderEmail() {
    var nm = name()
    var field = h('input', {
      class: 'field', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com', value: state.email,
      'aria-labelledby': PROMPT_ID, 'data-autofocus': '', 'aria-describedby': 'email-note',
      oninput: function (e) { state.email = e.target.value.trim(); save(); refresh() },
      onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); submit() } },
    })
    var err = h('p', { class: 'err', id: 'email-err', role: 'alert', hidden: true })
    var cta = h('button', { class: 'cta', type: 'button', text: 'Save my answers', onclick: submit })
    function valid() { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email) }
    function refresh() { cta.disabled = !valid() }
    function submit() {
      if (!valid()) return
      cta.disabled = true
      requestCode(state.email).then(function () {
        track('email_submitted')
        go('code')
      }).catch(function (e) {
        err.textContent = e && e.message ? e.message : 'That did not go through. Try again in a moment.'
        err.hidden = false
        field.setAttribute('aria-invalid', 'true')
        field.setAttribute('aria-describedby', 'email-err email-note')
        cta.disabled = false
      })
    }
    refresh()
    stage.appendChild(h('div', {}, [
      h('div', { class: 'eyebrow', text: 'Almost there' }),
      h('h1', { class: 'prompt', id: PROMPT_ID, text: nm ? 'Where should your first shot go, ' + nm + '?' : 'Where should your first shot go?' }),
      h('p', { class: 'hint', id: 'email-note', text: 'This is also how you’ll sign in on your iPhone. No password.' }),
      field,
      err,
    ]))
    stage.appendChild(h('div', { class: 'actions' }, [
      cta,
      h('p', { class: 'sub', text: 'Your answers are saved to this email, so the app already knows you.' }),
    ]))
    later(function () { field.focus({ preventScroll: true }) }, 380)
  }

  function renderCode() {
    var boxes = []
    var input = h('input', {
      class: 'visually-hidden', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '6', 'aria-label': 'Six-digit code',
      'data-autofocus': '', 'aria-describedby': 'code-err',
      onfocus: function () { row.classList.add('focused') }, onblur: function () { row.classList.remove('focused') },
    })
    var row = h('div', { class: 'code', 'aria-hidden': 'true', onclick: function () { input.focus() } })
    for (var i = 0; i < 6; i++) { var s = h('span', {}); boxes.push(s); row.appendChild(s) }
    var err = h('p', { class: 'err', id: 'code-err', role: 'alert', hidden: true })
    var cta = h('button', { class: 'cta', type: 'button', text: 'Continue', disabled: true, onclick: submit })
    var busy = false
    function paint(andSubmit) {
      var v = input.value.replace(/\D/g, '').slice(0, 6)
      input.value = v
      boxes.forEach(function (b, i) { b.textContent = v[i] || ''; b.classList.toggle('cursor', i === v.length) })
      cta.disabled = v.length !== 6 || busy
      if (andSubmit && v.length === 6) submit()
    }
    function submit() {
      if (input.value.length !== 6 || busy) return
      busy = true
      cta.disabled = true
      verifyCode(state.email, input.value).then(function () {
        track('account_created')
        go('paywall')
      }).catch(function (e) {
        busy = false
        err.textContent = e && e.message ? e.message : 'That code did not match. Check the email and try again.'
        err.hidden = false
        input.value = ''
        paint(false)
      })
    }
    input.addEventListener('input', function () { paint(true) })
    stage.appendChild(h('div', {}, [
      h('div', { class: 'eyebrow', text: 'Almost there' }),
      h('h1', { class: 'prompt', id: PROMPT_ID, text: 'Check your email.' }),
      h('p', { class: 'hint', text: 'We sent a 6-digit code to ' + state.email + '. It expires in ten minutes.' }),
      input, row, err,
      h('p', { class: 'hint', style: 'margin-top:4px' }, [h('button', { class: 'linkish', type: 'button', text: 'Use a different email', onclick: function () { go('email') } })]),
    ]))
    stage.appendChild(h('div', { class: 'actions' }, [cta]))
    later(function () { input.focus({ preventScroll: true }); paint(false) }, 380)
  }

  function renderPaywall() {
    track('paywall_view', { plan: state.plan })
    var a = state.answers
    var nm = name()
    var preset = Q.presetFor(a.voice_id)
    var voiceLabel = preset ? preset.label : ''
    var lane = Q.deriveShotLane(a)
    var first = Q.primaryMoment(a.lift_moments)
    var goal = a.goal_text.trim()
    var praying = a.prays !== 'not_for_me' && a.prayer_moments.length > 0

    var hint = voiceLabel
      ? 'About a minute, in a ' + voiceLabel.toLowerCase().replace(/^the /, '') + '. Hear the first fifteen seconds; the rest unlocks below.'
      : 'About a minute. Written from what you told me. Hear the first fifteen seconds; the rest unlocks below.'

    var card = h('div', { class: 'card', style: 'background-image:url(' + (LANE_PHOTO[lane] || LANE_PHOTO.motivation) + ')' }, [
      first ? h('span', { class: 'badge', text: MOMENT_BADGE[first] }) : null,
      h('span', { class: 'preview-chip', text: '0:15 preview' }),
      h('div', { class: 'title', text: goal ? 'You said ‘' + clip(goal, 48) + '’.' : 'Your first shot.' }),
      h('span', { class: 'dur', text: '0:00 / 0:15' }),
      h('button', { class: 'play', type: 'button', 'aria-label': 'Play the preview', html: ICON.play, onclick: togglePreview }),
      h('div', { class: 'track' }, [h('i')]),
    ])
    function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
    function togglePreview() {
      if (card.classList.contains('playing')) { stopPreview(); return }
      var btn = card.querySelector('.play')
      var src = state.previewUrl || (preset && preset.preview ? '../' + preset.preview : null)
      if (!src) return
      stopPreview()
      track('preview_play')
      preview.src = src
      preview.volume = 1
      card.classList.add('playing'); btn.setAttribute('aria-label', 'Pause the preview')
      var fill = card.querySelector('.track i'), dur = card.querySelector('.dur')
      preview.ontimeupdate = function () {
        var t = preview.currentTime
        fill.style.width = Math.min(100, (t / PREVIEW_SECONDS) * 100) + '%'
        dur.textContent = fmt(Math.min(t, PREVIEW_SECONDS)) + ' / 0:15'
        if (t >= PREVIEW_SECONDS - 1.2) preview.volume = Math.max(0, (PREVIEW_SECONDS - t) / 1.2)
        if (t >= PREVIEW_SECONDS) { stopPreview(); fill.style.width = '100%'; dur.textContent = 'The rest is yours below' }
      }
      preview.onended = function () { card.classList.remove('playing') }
      preview.play().catch(function () { card.classList.remove('playing') })
    }

    var checks = h('div', { class: 'checks' }, [
      voiceLabel
        ? 'A shot every day at the moment you chose, in a ' + voiceLabel.toLowerCase().replace(/^the /, '') + (praying ? ', and a prayer over your day' : '')
        : 'A shot every day at the moment you chose, in the voice you picked',
      'Sol remembers what you tell it, and writes from it',
    ].map(function (t) { return h('div', {}, [h('i', { html: ICON.check }), h('span', { text: t })]) }))

    var plans = h('div', { class: 'plans', role: 'group', 'aria-label': 'Plans' })
    var fine = h('p', { class: 'fine' })
    var cta = h('button', { class: 'cta', type: 'button', onclick: checkout })
    var applePay = h('button', { class: 'cta pay', type: 'button', 'aria-label': 'Pay with Apple Pay', html: ICON.apple, onclick: checkout, hidden: !window.ApplePaySession })
    var err = h('p', { class: 'err', role: 'alert', hidden: true })
    function plan() { return PLANS.filter(function (p) { return p.id === state.plan })[0] || PLANS[0] }
    function paintPlan() {
      plans.querySelectorAll('.plan').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.id === state.plan ? 'true' : 'false') })
      var p = plan()
      cta.textContent = p.trialDays ? 'Start my ' + p.trialDays + ' free days' : 'Unlock my first shot'
      fine.textContent = p.trialDays
        ? 'Today $0. ' + dateIn(p.trialDays) + ': ' + money(p.price) + ', then ' + money(p.price) + ' a ' + p.period + ' until cancelled. Cancel any time before, from the link in your receipt.'
        : 'Billed today, ' + money(p.price) + ', then ' + money(p.price) + ' a ' + p.period + ' until cancelled. Cancel any time from the link in your receipt.'
    }
    PLANS.forEach(function (p) {
      plans.appendChild(h('button', { class: 'plan', type: 'button', 'data-id': p.id, 'aria-pressed': 'false', onclick: function () {
        state.plan = p.id; save(); track('plan_selected', { plan: p.id }); paintPlan()
      } }, [
        h('span', {}, [
          h('b', { text: p.label }),
          h('small', { text: money(p.price) + ' a ' + p.period + (p.trialDays ? ', first ' + p.trialDays + ' days free' : ', cancel any time') }),
        ]),
        h('span', { class: 'tag', text: (p.trialDays ? '' : 'about ') + perDay(p) }),
      ]))
    })
    paintPlan()

    function checkout() {
      cta.disabled = true; applePay.disabled = true; err.hidden = true
      track('checkout_start', { plan: state.plan })
      purchase(plan()).then(function () {
        track('purchase', { plan: state.plan })
        go('success')
      }).catch(function (e) {
        err.textContent = e && e.message ? e.message : 'That did not go through. Nothing was charged. Try again in a moment.'
        err.hidden = false
        cta.disabled = false; applePay.disabled = false
      })
    }

    stage.appendChild(h('div', {}, [
      h('h1', { class: 'prompt', id: PROMPT_ID, text: nm ? 'Your first shot is ready, ' + nm + '.' : 'Your first shot is ready.' }),
      h('p', { class: 'hint', text: hint }),
      card, checks, plans,
    ]))
    stage.appendChild(h('div', { class: 'actions' }, [
      applePay, cta, fine, err,
      h('div', { class: 'links' }, [
        h('a', { href: SITE + 'terms/', target: '_blank', rel: 'noopener' }, ['Terms', h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' })]),
        h('a', { href: SITE + 'privacy/', target: '_blank', rel: 'noopener' }, ['Privacy', h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' })]),
        h('a', { href: APP_STORE, text: 'Already subscribed? Get the app' }),
      ]),
    ]))
  }

  function renderSuccess() {
    track('download_page_view')
    stage.classList.add('center')
    var nm = name()
    var preset = Q.presetFor(state.answers.voice_id)
    var first = Q.primaryMoment(state.answers.lift_moments)
    var when = { waking_up: 'at 7 am', commute: 'at 8:15 am', midday: 'at 12:30 pm', before_sleep: 'at 9 pm' }[first] || 'in the morning'
    var qr = h('div', { class: 'qr', 'aria-label': 'QR code for the App Store' })
    if (typeof window.qrcode === 'function') {
      try { var q = window.qrcode(0, 'M'); q.addData(APP_STORE); q.make(); qr.innerHTML = q.createSvgTag({ scalable: true, margin: 0 }) } catch (e) { qr.hidden = true }
    } else qr.hidden = true

    stage.appendChild(h('div', {}, [
      h('div', { class: 'orb md', 'aria-hidden': 'true' }),
      h('h1', { class: 'prompt', id: PROMPT_ID, style: 'text-align:center;margin-top:24px', text: nm ? 'Paid. Your shot is waiting in the app, ' + nm + '.' : 'Paid. Your shot is waiting in the app.' }),
      h('div', { class: 'steps-list' }, [
        h('div', { class: 'step' }, [h('i', { text: '1' }), h('span', {}, [h('b', { text: 'Get SoulShot on the App Store' }), h('small', { text: 'One tap on this phone. On a laptop, point your camera at the code.' })])]),
        h('div', { class: 'step' }, [h('i', { text: '2' }), h('span', {}, [h('b', { text: 'Sign in with ' + (state.email || 'the same email') }), h('small', { text: 'Same six-digit code, no password. Your answers and your plan are already there.' })])]),
        h('div', { class: 'step' }, [h('i', { text: '3' }), h('span', {}, [h('b', { text: 'Press play' }), h('small', { text: (preset ? preset.label : 'Sol') + ' reads your first shot. Tomorrow’s arrives ' + when + '.' })])]),
      ]),
      qr,
    ]))
    stage.appendChild(h('div', { class: 'actions' }, [
      h('a', { class: 'cta', href: APP_STORE, text: 'Download on the App Store', onclick: function () { track('app_store_click') } }),
      h('p', { class: 'sub', text: 'We emailed you this link too.' }),
    ]))
  }

  // ---- Services (stubs until day 3) ---------------------------------------

  /** TODO(day 3): Clerk — signUp/signIn with email_code; this only validates the shape. */
  function requestCode(email) {
    return new Promise(function (resolve, reject) {
      if (DEV) return setTimeout(resolve, 500)
      reject(new Error('Sign-in isn’t open yet. Email ' + SUPPORT + ' and we’ll let you know the day it is.'))
    })
  }

  /** TODO(day 3): Clerk attemptEmailAddressVerification, then the Supabase profile patch with toProfilePatch(). */
  function verifyCode(email, code) {
    return new Promise(function (resolve, reject) {
      if (DEV) return setTimeout(resolve, 500)
      reject(new Error('Sign-in isn’t open yet.'))
    })
  }

  /** TODO(day 3): RevenueCat Web Billing (purchases-js) with app_user_id = the Clerk id. */
  function purchase(plan) {
    return new Promise(function (resolve, reject) {
      if (DEV) return setTimeout(resolve, 700)
      reject(new Error('Checkout isn’t open yet. Nothing was charged. Email ' + SUPPORT + ' to be told the day it is.'))
    })
  }

  // The profile patch the app writes, for day 3 and for anyone testing in the console.
  window.soulshotStart = {
    state: state,
    profilePatch: function () { return Q.toProfilePatch(state.answers, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') },
    reset: function () { try { sessionStorage.removeItem(DRAFT_KEY) } catch (e) {} location.reload() },
  }
})()
