---
title: "Using SoundCloud's API Without an app"
description: "Exploring SoundCloud's API, browser session credentials, and the challenges of DataDome bot protection."
pubDate: 2025-09-21
canonicalSlug: "2025/09-21-soundcloud-api"
readingTime: "4 minute read"
---

> **⚠️ CAUTION:** This is a failure report, not a success story. No working bypass was demonstrated, and the code does little more than generate strings that look vaguely like the observed IDs. If you're looking for a ready-to-use solution, you're in the wrong place. If you'd like to watch me investigate a problem, lose my shit and make some questionable assumptions, and learn why things aren't always as simple as they look, proceed...

## Introduction

I use SoundCloud for pretty much everything I listen to. There's just one little annoyance: no Discord Rich Presence. Spotify has it, so why can't SoundCloud? 

It's hardly a life-changing problem, but it's the sort of thing that makes me want to build my own solution. Mostly out of curiosity. And, well, because I can :^)

The first step was figuring out how to access SoundCloud's API.

Unfortunately, getting API access isn't as straightforward as it used to be. SoundCloud seems to have discontinued its API credential request form (L SoundCloud for that). These days, you're left dealing with a stupid support bot that claims to create a ticket but, in my experience, that fucker never actually does.

So, is there another way to use the API? As it turns out, there's something worth looking into.

## Finding the Keys to the Kingdom
SoundCloud publishes its [API documentation here](https://developers.soundcloud.com/docs/api/explorer/open-api), but making authenticated requests to the endpoint I was investigating required both a client ID and an OAuth2 access token.

Since the SoundCloud website could make requests while I was logged in, I figured the browser must already have access to both. A quick look through DevTools confirmed it.

Inspecting a request revealed something like this:
```http
GET https://api-v2.soundcloud.com/me/play-history/tracks?client_id=[client_id]
Authorization: OAuth [token]
```
Bingo! There it was: the client ID and authorization token needed to make the request. My first instinct was to copy it as a cURL command and run it from the terminal.

The first request succeeded, returning 200 OK. Great. I could retrieve the data without much trouble, or so I thought.

Then the subsequent requests started returning 403 Forbidden. Of course they did!

I tried again, hoping the first success hadn't been a fluke and the second one a divine intervention. Nope. Same result: the first request worked, and every attempt after that failed.

Something else was going on.

## DataDome: Bot ~~protection~~

After some digging and looking through the requests, I noticed one header changing between attempts: `X-Datadome-ClientID`.

DataDome is a bot-protection service that helps websites identify automated or suspicious traffic. Its involvement suggested that reproducing the request might require more than copying the visible API credentials.

That would explain why copying the browser's credentials wasn't necessarily enough to reproduce its requests from the terminal. There appeared to be another piece of the puzzle, and this header was a reasonable place to start investigating.

Here are a few values I observed:
```text
xkVkxGvp5lkBiL0A_cuN6xmUlb_uXDhYQOA4PFrDc3f9sZKL7zvOVDnKDwKz2AipGh6HSCx65CnlJBpyXqjgTmUSkVV3Qi8Xueo8gnJTe_uc3~9F0onjLyw~rYJq63Cv
t86praf1JKTfbEmyKQ~Cx2~m1TzhwNjfLaahESKCK~mMHgu11VG~9aIu8s8INH_Fxuv~UguZncpZV47hHZ2dff99eXQrHOc0ivf5wfHihj5si4gpejjqIxjEZXhFQEMT
twFJ_~4ZCOeNfay_yUVMB5ED2RUUGKT~6onBslCMxWaPc2uV97WvV_ywK0_778z_~28zSWlBgkmSsCknLfc3pJeAaRHP0jUh0_A0ZU4ItdoqPeIG_T1p2AUBHihSFiMM
```
The values didn't look entirely random. They contained letters, numbers, and occasional separators such as ~ and _. There seemed to be a recognizable pattern, so naturally, I decided to try reproducing it.

Because apparently generating random strings is what we do when debugging APIs now. (*ahem*)

## The ~~Trial~~ Experiment
I wrote a small Python function to generate strings resembling the observed values:
```python
from random import randint

def regenerate_clientid() -> str:
    target_length = 128
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    separator_count = randint(6, 9)
    every = int(target_length / separator_count)
    separators = ["~", "_", "~_"]

    i = 0
    string = ""

    while i < 129:
        if i % every == 0 and i != 0:
            chosen = randint(0, len(separators) - 1)
            string += separators[chosen]
            i += len(separators[chosen])

        string += alphabet[randint(0, len(alphabet) - 1)]
        i += 1

    return string
```
The idea is shrimple: generate random alphanumeric characters and insert separators at intervals.

There are a few catches (big ones!), though:

* **separator_count** determines the approximate interval, not the actual number of separators.
* **target_length** isn't enforced. The loop uses a separate counter, so the output length can vary. Since the counter also advances when separators are inserted, those insertions affect both the output length and the positions of subsequent separators.
* The function **imitates the visible format** without reproducing DataDome's generation or validation process.

The last point is the important one. A string can look exactly right and still be completely invalid.

I had recreated the appearance of an identifier, not whatever made it acceptable to the server.

## Conclusion

So, what did I actually learn?

The first request worked, subsequent requests failed, and the URL and query parameters stayed the same. I also noticed that X-Datadome-ClientID changed between requests.

That made DataDome worth investigating, but it didn't prove the header caused the failures. Other factors, such as cookies, session state, request characteristics, or additional server-side checks, could have been involved.

I never isolated the cause, let alone demonstrated a working bypass.

It's tempting to notice a token's pattern and assume that reproducing it is enough. But its appearance tells you very little about how it's generated, what it's associated with, or how it's validated.

Modern anti-bot systems can consider much more than a single header. A request that works in a browser might fail in a terminal even when the visible credentials look identical.

And **TL;DR: Anyway, that was a fucking waste of an afternoon.**

There's a familiar cat-and-mouse dynamic here, similar in broad strokes to malware authors and antivirus/endpoint detection systems: one side develops ways to detect unwanted behavior, while the other tries to understand or work around those defenses.

The takeaway? Reproducing an HTTP request isn't necessarily the same as reproducing the context in which it's accepted.

Not quite the result I wanted, but hey, at least the strings looked convincing.

Thanks for reading! I'll get back to the lower-level stuff soon. (hopefully x_x)
