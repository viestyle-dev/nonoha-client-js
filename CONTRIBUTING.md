# Contributing to nonoha-client-js

Thank you for considering a contribution! This document covers how to
make changes to this repository (pull requests and issues). For
development setup and usage, see the [README](README.md).

## Issues

- Bug reports and feature requests: open an issue describing the
  behavior you see and the behavior you expect.
- Security issues: do **not** open a public issue — see
  [SECURITY.md](SECURITY.md).

## Contributor License Agreement (CLA)

Your first pull request triggers a bot comment. Reply with:

> I have read the CLA Document and I hereby sign the CLA

— that's it. The signature covers all your future contributions.

Why a CLA? Parts of nonoha are dual-licensed to fund development
(nonoha-engine is AGPL-3.0-only + commercial; this library is
Apache-2.0). You keep your copyright; you grant VIE a license that
includes relicensing. See [CLA.md](CLA.md) for the full text.

*Corporate contributors: if your employer requires a corporate
agreement, contact VIE before submitting.*

## Pull request flow

1. Fork the repository and create a branch.
2. Make your change and add tests.
3. Ensure `npm run build` and `npm test` pass.
4. Open a pull request.

## Coding guidelines for changes

- Comments are written in English.
- This library stays dependency-free at runtime (no React, no runtime
  packages) so it can be used from any framework or as an IIFE bundle.
