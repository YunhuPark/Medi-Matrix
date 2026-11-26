# Local triage simulator

Run from the repository root with the existing backend dependencies:

```sh
python triage_mock_server/main.py
```

The launcher binds `127.0.0.1:8001` without reload or proxy-header trust. The
existing backend default, `http://localhost:8001/api/triage/webhook`, remains
supported. The receiver also rejects non-loopback/unknown peers, non-local Host
headers, forwarded ingress headers, and browser requests from other origins.
Call it through the backend rather than directly from the frontend origin.
Request fields and patient-derived results are not printed to its console.

The legacy backend sender accepts only an unset/empty `TRIAGE_API_URL` or the
exact `http://localhost:8001/api/triage/webhook` and
`http://127.0.0.1:8001/api/triage/webhook` URLs. It always connects to literal
`127.0.0.1`, ignores environment proxy/CA settings for this local HTTP call,
does not follow redirects, and rejects non-2xx responses. Other configured URLs
return a generic503 before creating an outbound client. An unreviewed remote
URL must not be used to forward medical fields. This guard does not affect the
separate Supabase auth/storage clients or enable any remote receiver.

This is an unauthenticated deterministic simulator. Use synthetic inputs only;
it does not access EMR data and its output is not a clinical prediction. Do not
expose it through tunnels, containers with published ports, or reverse proxies.
A local program or a deliberately configured proxy that hides its forwarding
headers can still call it. Remote integration needs separately reviewed sender
authentication/signature verification, replay protection and TLS; loopback and
Host checks do not provide those guarantees. No new secret or remote receiver
has been provisioned by this change. Existing collected logs are not deleted.

Regression checks (no real network, patient data, or external service calls):

```sh
cd backend
python -m pytest tests/test_triage_mock_security.py -q
```
