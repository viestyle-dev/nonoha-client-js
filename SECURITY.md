# Security Policy

## Reporting a Vulnerability

Please use GitHub's **Private Vulnerability Reporting**
(Security tab → "Report a vulnerability") on this repository.
Do not open public issues for security reports.

## Threat model

- **This library is a client for a nonoha-engine endpoint.** It opens
  WebSocket and HTTP connections to the engine gateway URL that the
  application passes in, over plain `ws://` / `http://`. Only connect
  to engines you trust, on networks you trust (the intended setup is a
  local engine on `127.0.0.1`).
- **Received data is parsed, not executed.** The library decodes the
  engine's binary port-value protocol into typed arrays and strings; it
  does not evaluate code from the wire. Graph definitions executed by
  the engine are outside this library's scope — see the nonoha-engine
  security policy for the engine-side threat model.

## Supported versions

Security fixes target the latest release.
