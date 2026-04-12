# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `medusa-plugin-pennylane`, please report it privately rather than opening a public issue.

**Contact:** open a [private security advisory](https://github.com/pierre-b/medusa-pennylane/security/advisories/new) on GitHub.

Include:

- A description of the vulnerability and its impact
- Steps to reproduce (minimal, redact any real tokens)
- The affected plugin version and Medusa version
- Any suggested remediation, if you have one

You will receive an acknowledgement within 7 days. Confirmed vulnerabilities will be patched as quickly as reasonably possible; a CVE will be requested when appropriate, and a security advisory will be published with credit (unless you prefer to remain anonymous).

## Supported Versions

Only the latest minor version on npm receives security updates during this project's pre-1.0 phase.

## Scope

In scope:

- Code in this repository
- The published npm package `medusa-plugin-pennylane`
- GitHub Actions workflows in this repository

Out of scope:

- Vulnerabilities in Medusa core, Pennylane's API, Stripe, or any other upstream dependency (report those upstream)
- Vulnerabilities that require physical access to a developer's machine
- Issues affecting only abandoned forks
