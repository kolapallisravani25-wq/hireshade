# HireShade Bug Tracker

| ID | Severity | Area | Issue | Status | Next Action |
|---|---|---|---|---|---|
| HS-001 | Critical | Admin | Admin runs manually as root from `/root/scribeshade-admin` | Open | Move to `/opt/hireshade/admin`, create systemd service |
| HS-002 | High | Admin | Admin still branded as ScribeShade | Open | Rebrand metadata, title, favicon, labels |
| HS-003 | High | Desktop | Desktop package/folder still named `craft-vita` | Open | Rename only after build baseline is validated |
| HS-004 | Medium | Desktop | Old ScribeShade icon asset exists | Open | Replace icons after branding audit |
| HS-005 | Critical | Data | Old and new DB schemas differ | Open | Build schema-aware migration plan |
| HS-006 | Critical | Data | New DB already has live data but final plan is clean + migrate old data | Open | Backup before cleanup |
| HS-007 | High | Infra | GitHub repository just initialized; deployment flow not yet automated | Open | Add deployment guide and scripts |
| HS-008 | Critical | Payments | Razorpay/credits flow not yet verified end-to-end | Open | Test purchase, ledger, balance update |
| HS-009 | Critical | AI | OpenRouter/AI generation flow not yet verified end-to-end | Open | Test prompt, answer generation, credit deduction |
| HS-010 | Critical | Desktop | Desktop session flow not yet verified | Open | Build/test launcher + floating session |
