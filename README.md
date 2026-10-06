# Traces of ANU

Traces of ANU is a shared, spatial layer over campus. You walk through a small
loop of illustrated campus scenes — Kambri Lawn, Chifley Steps, Union Court,
Science Walk — and at any point you can leave a short trace: a tip, a memory,
a story, a spark of something odd. Other traces left by other people are
already sitting there, anchored to the exact spot someone left them, waiting
to be found. It's for anyone passing through ANU who'd rather stumble on what
someone else noticed about a place than read it off a noticeboard.

## The core experience

You don't pick a destination from a menu — you pan around a place (drag,
swipe, arrow keys) the way you'd glance around a street-view photo, and you
walk to the next place by finding the path out of this one, rendered right on
the ground where it would actually be. A trace from someone else appears as a
small mark where they left it; clicking it reads what they wrote, in their own
whimsical, cookie-assigned name and colour — nobody has an account, but nobody
is anonymous to the app either. Leave your own by clicking an empty spot: pick
a vibe (tip, memory, story, spark), write a line, and it's there — for you
immediately, and for anyone else looking at that scene within about a second,
no reload. Come back tomorrow, or after a redeploy, and it's still there.

That loop — explore, discover, leave, watch it reach someone else live, find
it again later — is the whole app right now. Four scenes, one shared log of
traces, no accounts, no feed.

## What "good" means here (first version)

A good version makes campus feel **socially lived-in**: you learn about a
place by bumping into what someone else left there, while still feeling like
you're walking through it, not scrolling past it. Two ideas shaped that.
Clay Shirky's **["Situated Software"](http://shirky.com/essays/situated-software/)**
(2004) argues for software built for a
known, small group and a particular place rather than for everyone — this app
is sized for a cohort wandering one campus, not a platform. Kleppmann et al.'s
**["Local-first software"](https://www.inkandswitch.com/essay/local-first/)**
(2019) argues persistence is a promise to the person who left something, not
an implementation detail — which is why "it's still there tomorrow" is tested
automatically here (`spec/traces.test.ts`), not just hoped for. Robin Sloan's
**["An App Can Be a Home-Cooked Meal"](https://www.robinsloan.com/notes/home-cooked-app/)**
(2020) is why this stays four scenes and one kind of thing (a trace), rather
than growing a feature for every idea that would also be nice.

What's enforced: the scene graph stays connected, a posted trace round-trips
and survives bad input, two visitors get different identities, a trace reaches
another open session within ~1s. What's judged, by a person, at a crit: whether
panning a place actually feels spatial rather than like a map with extra
steps, and whether discovering a trace feels like finding something rather
than reading a post.

## What this deliberately isn't

Not a message board or a feed with the nouns swapped — there's no timeline, no
likes, no profile page. Not a 3D world — the panoramas are flat, hand-drawn
stand-ins for real 360 photography, chosen so the spatial feeling didn't have
to wait on assets that weren't available yet. Freehand drawing, image uploads,
accounts, more than four scenes and long easter-egg trails are all left out of
this first slice on purpose, not forgotten.
