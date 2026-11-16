---
title: Tool Radar, our web fetcher
audience: everyone
summary: What our automated fetcher is, what it reads, and how to block it from your site.
position: 60
---
# What it is

Tool Radar is the part of {{brandName}} that keeps our courses up to date. It does two jobs:

- **Finding new tools.** It reads public feeds and listings for newly released AI and creative tools, then reads a few public pages on a tool's own website (for example the home, pricing and terms pages) to note what the tool does, what it costs and what age it is for.
- **Watching tools we already teach.** It re-reads the public terms, pricing and help pages our guides rely on, so that we notice when something changes.

What it finds goes to our staff. It may be used to draft a course, and every draft is reviewed by a person before anything is published.

# How it behaves

- It identifies itself with the User-Agent shown on this page, which links back here.
- It follows robots.txt.
- It reads public pages only. It does not sign in, fill in forms or go behind a paywall.
- It reads text. It does not download images, video or files.
- It reads a handful of pages per site and keeps its request rate low.
- It does not collect information about people.

# What we do with what it reads

We keep the facts we need to describe a tool accurately (name, price, minimum age, what it does) together with the address of the page each fact came from, so a person can check it. We do not republish your pages.

# If something looks wrong

If you think a fetcher using this name is misbehaving on your site, block it using the lines above and tell us through the [help centre](/help). Please include your site's address and the times of the requests.
