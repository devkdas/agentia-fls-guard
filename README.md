# Agentia FLS Guard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](package.json)
[![Agentia 0.122](https://img.shields.io/badge/agentia-0.122.0--alpha.1-blue.svg)](https://developer.copado.com/docs)

**FLS Guard** scans profiles for field and object grants, flagging
anything handed to high risk profiles before it ships.

Read only, always. Built for the **Agentia Headless Virtual Hackathon**
as an oclif plugin on top of the public `agentia` CLI.

---

## Table of Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Live Demo Workflow](#live-demo-workflow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hackathon Fit](#hackathon-fit)
- [License](#license)

---

## The Problem

New fields routinely ship with access granted to high risk profiles
like Guest User, and nobody notices until an audit or an incident.
Reviews today are manual, inconsistent, and skipped under deadline
pressure.

## Features

- **Org mode** — fetches profile content through the verified content
  command and scans every grant.
- **Offline file mode** — `--file` scans local Profile XML with zero
  CLI calls, perfect for pre commit use.
- **Risky profile matching** — configurable substring list defaulting
  to guest, with per grant risk flags.
- **Field plus object grants** — readable, editable, allowRead,
  modifyAll and viewAll all parsed.
- **Clean or flagged verdict** — counts plus capped grant samples in
  human and JSON output.
- **Compliance reports** — `fls report` audits up to 20 profiles in one
  run and exports CSV or JSON for auditors, with skipped profiles
  listed honestly instead of hidden.
- **Zero private imports** — only shells out to public `agentia`
  commands.

## Installation

### Prerequisites

- Node 18 or newer.
- Agentia CLI beta: `npm install -g @copado/agentia-cli@beta`
- Authenticated machine for org mode. File mode needs nothing.

### Install from source

```sh
git clone https://github.com/devkdas/agentia-fls-guard.git
cd agentia-fls-guard
npm install
npm run build
agentia plugins link .
```

Re-run `npm run build` after every change to the TypeScript files.

## Quick Start

### 1. Scan an org profile

```sh
agentia fls check --profile "Guest User" --source-credential-id a11 --source-org-id 00D
```

### 2. Scan a local file offline

```sh
agentia fls check --file ./Admin.profile-meta.xml --json
```

### 3. Custom risk list

```sh
agentia fls check --file ./Site.profile-meta.xml --risky guest --risky partner --json
```

### 4. Compliance report across profiles

```sh
agentia fls report --profile Admin --profile "Guest User" --source-credential-id a11 --source-org-id 00D --format csv --output ./fls-audit.csv --json
```

## Live Demo Workflow

Verified live on a synthetic Guest style profile:

```text
1. agentia fls check --file guest.xml --json
   -> flagged: 2 risky grants (Account.Secret__c readable, Account allowRead)
2. Same scan on a locked down profile -> clean with scanned counts
3. Org mode attempted live; heavy payloads can time out at the gateway,
   in which case file mode carries the demo deterministically
4. agentia fls report --profile Admin --source-credential-id ... --source-org-id ... --format csv --json
   -> per profile field plus object counts, risky grants piped, skips listed
```

## Command Reference

### `agentia fls check`

| Flag | Description |
|---|---|
| `-p, --profile <name>` | Profile API name for org mode |
| `-f, --file <path>` | Local Profile XML for offline mode |
| `--source-credential-id` | Org credential ID for org mode |
| `--source-org-id` | Org ID for org mode |
| `--pipeline-id` | Pipeline ID scoping gateway calls |
| `--risky <sub>` | Risky name substring, repeatable (default `guest`) |
| `-j, --json` | Machine readable JSON output |

One of `--profile` or `--file` is required. Org mode additionally
needs credential plus org IDs.

### `agentia fls report`

| Flag | Description |
|---|---|
| `-p, --profile <name>` | Profile API name, repeatable (at least one required, max 20) |
| `--source-credential-id` | Org credential ID |
| `--source-org-id` | Org ID |
| `--pipeline-id` | Pipeline ID scoping gateway calls |
| `--risky <sub>` | Risky name substring, repeatable (default `guest`) |
| `--format csv\|json` | Export file format (default `csv`) |
| `-o, --output <path>` | Output file path (default `./fls-audit-<stamp>.<format>`) |
| `-j, --json` | Machine readable JSON output |

Writes the audit file plus a JSON summary with per profile counts and
a `skipped` list naming every profile that failed or came back empty.
Read only, never changes permissions.

## Configuration

Risk list only. Matching is case insensitive substring on the profile
name, so `guest` catches Guest User plus site guest variants.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Gateway timeout on org fetch | Heavy profile payload | Retry, or export the XML and use file mode |
| Empty content | Member missing on that end | Verify the profile name first |
| No flags raised on a strict profile | Correct behavior | Clean verdict with counts is the proof |
| ESM auto-transpile warning | Linked ESM plugin notice | Benign, compiled output is used |

## How It Works

```text
agentia fls check
  -> content get (org mode) or local file read (offline mode)
  -> regex scan of fieldPermissions plus objectPermissions
  -> risky substring match per grant
  -> flagged / clean verdict plus JSON

agentia fls report
  -> content get per profile (up to 20)
  -> same scan plus risky match per profile
  -> CSV or JSON file plus skipped list
```

## Security

Read only by construction. Nothing is written to orgs or files. The
scanner reports grants, it never changes permissions.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript on Node 18+ |
| CLI Framework | oclif v4 (ESM, matching the host CLI) |
| Runtime calls | `node:child_process` to public `agentia` commands |

## Architecture

```text
Developer / Agent / CI gate
       |
agentia fls check --profile|--file
       |
FLS Guard (this plugin)
  |- fetcher  -> content get or file read
  |- scanner  -> field plus object grant parsing
  |- matcher  -> risky substring flags
  |- reporter -> multi profile CSV or JSON export
        |
Verdict plus grants plus JSON, report file for auditors
```

## Hackathon Fit

Strengthens security plus governance through a scan no other entry
performs, catching risky grants pre promotion every time instead of by
luck during audits.

## License

MIT License — see [LICENSE](LICENSE) for details.
