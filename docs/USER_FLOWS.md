# User Flow Map

## Roles
- **Admin** — finance/ops. Sees everything; manages users, settings, matching.
- **Level 1 (cardholder)** — staff with an AMEX card in their name.
- **Level 2 (assigned user)** — staff without a card who sometimes borrows one.

## Flow 1 — Happy path: charge → receipt → reconciled

```
Staff buys supplies with AMEX
        │
Admin imports AMEX CSV (Phase 2: auto-sync)
        │
Transaction created → status: outstanding
        │
Reminder engine emails the cardholder:
  amount · merchant · date · [Upload receipt] · [Someone else used my card]
        │
Cardholder taps link → app (or Jotform URL with charge prefilled)
        │
Takes photo → fills date/amount/vendor/category → Submit
        │
Receipt saved locally → forwarded to Jotform → matcher runs
        │
Score ≥ threshold → transaction status: likely
        │
Admin dashboard → "Likely matches needing review" → side-by-side compare
        │
Admin confirms → status: matched → leaves outstanding list
        │
Admin archives (or bulk-archives matched) → archive/reconciled section
        (admin can undo at any point; undo returns it to outstanding)
```

## Flow 2 — Card lent to a Level 2 user

```
Charge appears on Maria's (level1) card, but Jake (level2) used it
        │
Maria gets the reminder email → taps "Someone else used my card"
        │
Signed link opens reassignment page → picks Jake (active users only)
        │
Transaction.assigned_user_id = Jake → audit logged
        │
All future reminders go to Jake (Maria stops receiving them)
        │
Jake gets reminder → submits receipt → normal matching flow
```

## Flow 3 — Receipt submitted with no known charge (receipt-first)

```
Staff submits receipt before the CSV import contains the charge
        │
Receipt stored, matcher finds nothing → receipt sits unmatched (visible to admin)
        │
Next CSV import creates the charge → matcher re-runs on import
        │
→ likely match suggested → admin confirms
```

## Flow 4 — Charge that will never have a receipt

```
Admin (or cardholder via email link "not mine / dispute") flags charge
        │
Admin marks status: ignored (reason logged) → leaves outstanding, reminders stop
```

## Flow 5 — Escalation

```
Charge outstanding 7+ days with no receipt
        │
Admin receives escalation email (charge, responsible user, days outstanding)
        │
Periodic reminders continue to the user until matched/ignored/archived
```

## Screen map (mobile app)

```
Login ──► Home (role-aware)
            ├── Submit Receipt (camera / library / fields / optional charge link)
            ├── My Outstanding Charges ──► Charge Detail
            │       (level1: own card · level2: assigned · admin: all + filters)
            │       Charge Detail: full data · candidate receipts · confirm match ·
            │                      assign to user · ignore · archive · undo
            ├── My Submitted Receipts
            └── Admin (admins only)
                  ├── Dashboard (totals · by-user · oldest · likely matches · recent)
                  ├── User Management (add/edit/deactivate/roles/cardholder info)
                  └── Settings (Jotform key+form · CSV import · reminder schedule ·
                                email templates · SMS placeholder)
```
