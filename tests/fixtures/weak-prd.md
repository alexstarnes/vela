# Clipper — Product Requirements Document (v1)

**Author:** Jamie Ruiz, Product
**Status:** Draft for review
**Last updated:** February 2026

## Overview

Clipper is a bookmarking and read-later app for people who save more than they read. Today, most of our target users rely on a scattershot combination of browser bookmarks, Notes app entries, and Slack messages to themselves to keep track of articles, threads, and pages they mean to come back to. Clipper consolidates all of that into one clean, fast place to save, organize, and revisit content — links, articles, threads, and more.

We think there's a real opportunity here: people are drowning in tabs and links, and nothing on the market makes the actual reading part easier. Clipper's job is to make saving effortless and to make coming back to what you saved something you actually want to do, not another chore.

This document covers the v1 feature set, the core flows, and how we'll know if it's working.

## Goals

- Give people a single home for everything they want to read later
- Make saving a link so fast it becomes a habit
- Build a product people genuinely enjoy using, not just tolerate
- Build a robust foundation for a broader "personal knowledge" product down the road
- Get to a version we're proud to put in front of early users

## Target Users

Our primary audience is knowledge workers and lifelong learners who read a lot online — think newsletter subscribers, researchers, students, and generally curious people. Secondary audience includes professionals who need to keep track of articles for work, though we'll firm this up as we learn more from early usage. We're not explicitly going after power users of existing tools like Pocket or Instapaper, but we expect a fair amount of overlap in practice.

Broadly, if someone has ever said "I'll read that later" and then never did, they're a Clipper user.

## Features

### 1. Save a Link

**User story:** As a user, I want to save a link from anywhere I'm browsing so that I can come back to it later.

**Acceptance criteria:**
- User can save a link via the browser extension
- User can save a link via the mobile share sheet
- The save action should feel instant and require zero friction
- Saved links appear in the user's Clipper library, with title, source, and a thumbnail when available

### 2. Folders and Tags

**User story:** As a user, I want to organize my saved links into folders and tags so I can find things later.

Users should be able to create folders, nest folders, and apply multiple tags to a single link. The organization system should be flexible enough to support however people naturally think about their content — some people like folders, some like tags, some like both, and the product should get out of their way either way.

### 3. Full-Text Search

**User story:** As a user, I want to search across everything I've saved — titles, tags, folders, and the full text of saved articles — so I can find a specific link even if I don't remember exactly where I put it.

**Acceptance criteria:**
- Search returns relevant results quickly
- Search covers titles, tags, and article body text
- Search should be robust enough to handle typos, partial matches, and more

### 4. Dark Mode

**User story:** As a user, I want a beautiful dark mode so that Clipper feels great to use day or night.

Dark mode is a top priority for v1. Competitors treat it as an afterthought, but we've put real design time into getting it right — a full, considered dark theme, not just inverted colors. This will set us apart from every competitor in the space. Our superior UX will be our moat: if Clipper simply feels better to use than Pocket, Instapaper, or a Notes app, people will switch and stay. We're not planning to charge for it — dark mode should just be there, seamlessly, for everyone, on every screen.

### 5. Cross-Device Sync

**User story:** As a user, I want everything I save on one device to show up on my other devices so my library is always up to date, no matter where I am.

**Acceptance criteria:**
- When a user signs in with their email on a new device, their existing saved links, folders, and tags appear automatically
- Sync happens seamlessly in the background, with no action required from the user

### 6. Import Existing Bookmarks

**User story:** As a user, I want to import my existing browser bookmarks into Clipper so I don't have to start from zero.

Users can export a bookmarks file from their browser (Chrome, Safari, Firefox, etc.) and upload it into Clipper. Clipper parses the file and adds each bookmark to the user's library, preserving folder structure where possible. This should work smoothly regardless of how someone's bookmarks are organized.

## User Flows

### Importing Your Bookmarks

1. User goes to Settings > Import
2. User clicks "Import Bookmarks"
3. User selects their exported bookmarks HTML file from their computer
4. Clipper uploads and parses the file
5. User sees a progress indicator while the import runs
6. Once complete, user is taken to their library, where all imported bookmarks now appear alongside their existing folder structure
7. A success toast confirms the import worked and the user can start browsing their newly imported links right away

### Tagging a Saved Link

1. From the library view, user clicks the tag icon on a saved link
2. A modal opens with a text field for entering a new tag or selecting an existing one
3. User types a tag name and presses Enter
4. The tag is applied to the link and appears as a chip below the link title
5. User can repeat this to add more tags to the same link

## Success Metrics

We'll know Clipper is working when users tell us it feels like the easiest way to save and revisit things online. Specifically, we're looking for:

- Users should have a delightful experience from the very first save
- The app should feel fast and intuitive across every screen, not just the core save flow
- Engagement should improve meaningfully over the first few months as people build the saving habit
- Retention should be strong among people who complete onboarding
- We want people to genuinely love using Clipper, not just use it out of habit

## Timeline

Given the scope above, we're confident the full v1 — save, organize, search, dark mode, sync, and import — ships in six weeks, start to finish.

## Open Questions

- Do we need a web app at launch, or can we start with the extension and mobile share sheet?
- How much of the folder/tag system needs to exist on day one versus evolving after launch?
- Pricing is still TBD — we'll figure that out closer to launch based on how things go.
