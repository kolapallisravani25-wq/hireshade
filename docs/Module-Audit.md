# HireShade Module Audit

Status legend: ✅ Working, ⚠️ Partial, ❌ Broken, ⏳ Pending

| Area | Module | Status | Notes | Priority |
|---|---|---:|---|---:|
| Infrastructure | VPS | ✅ | New VPS active | High |
| Infrastructure | API service | ✅ | `hireshade-api.service` running on port 4000 | High |
| Infrastructure | PostgreSQL | ✅ | HireShade DB active | High |
| Infrastructure | Nginx | ⚠️ | Admin asset routing fixed; full config audit pending | High |
| Admin | Admin login | ✅ | Admin recovered and login works | High |
| Admin | Admin service | ❌ | Running manually from `/root/scribeshade-admin`; needs systemd | Critical |
| Admin | Branding | ❌ | Still shows ScribeShade | Medium |
| Web | Authentication | ⏳ | Needs end-to-end verification | Critical |
| Web | Dashboard | ⏳ | Needs verification | High |
| Web | Resume Studio | ⏳ | Needs verification | High |
| Web | ATS Analysis | ⏳ | Needs verification | High |
| Web | AI Projects | ⏳ | Needs verification | High |
| Web | Question Bank | ⏳ | Needs verification | Medium |
| Web | Credits | ⏳ | Needs deduction/addition verification | Critical |
| Web | Billing/Razorpay | ⏳ | Needs payment verification | Critical |
| Web | Documents | ⏳ | Needs upload/download verification | High |
| Sessions | Session creation | ⏳ | Needs web + desktop verification | Critical |
| Sessions | Transcript | ⏳ | Needs STT verification | Critical |
| Sessions | AI answer generation | ⏳ | Needs OpenRouter verification | Critical |
| Desktop | Tauri app | ⚠️ | Exists, needs build/test | Critical |
| Desktop | Floating window | ⏳ | Needs verification | Critical |
| Desktop | Clerk auth | ⏳ | Needs verification | Critical |
| Desktop | Deep links | ⏳ | Needs verification | High |
| Data | Old DB discovery | ✅ | ScribeShade DB confirmed in Docker | Critical |
| Data | Migration | ⏳ | Must be done after full production audit | Critical |
