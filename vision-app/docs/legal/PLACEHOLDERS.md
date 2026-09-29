# Legal pages: placeholders and open questions

Pages: `public/legal/{terms,privacy,cancellation,accessibility,disclaimer}.html` (Hebrew, primary) and the same names in `public/legal/en/` (English). All pages carry **Version 2026-09-28 · Last updated 2026-09-29**. The version string must match the terms version the server records at sign-up (`2026-09-28`).

These drafts were written by an AI agent from `docs/research/business-legal-payments.md`. They are **not legal advice**. An Israeli lawyer must review them before launch.

## 1. Placeholders (12 distinct, 96 occurrences)

Every placeholder appears on the page as `<span class="ph">[[NAME]]</span>`, highlighted yellow on purpose. To fill one, replace that whole span with the value in every file under `public/legal/**`. When none remain, `grep -r "\[\[" public/legal` returns nothing.

| Placeholder | What to fill in | Where it appears (he + en) |
|---|---|---|
| `[[COMPANY_NAME]]` | Legal name of the business (company, or the licensed dealer's name) | Every page: footer (©). Also Terms §1 and §19, Privacy §1 and §15, Cancellation §9, Disclaimer §8 (contact blocks) |
| `[[COMPANY_ID]]` | Company number (ח״פ) or dealer number (ע״מ) | Terms §1 and §19, Privacy §1 and §15, Cancellation §9, Disclaimer §8 |
| `[[ADDRESS]]` | Postal address for notices, cancellations and accessibility requests | Terms §1 and §19, Privacy §1 and §15, Cancellation §1 (cancel by post) and §9, Accessibility §6, Disclaimer §8 |
| `[[CONTACT_EMAIL]]` | Support and legal e-mail. It is also the cancellation e-mail channel, so it must be monitored | Terms §1 and §19, Privacy §1, §11 and §15, Cancellation §1 and §9, Disclaimer §8 |
| `[[PHONE]]` | Phone number. It is also a cancellation channel under section 13D | Terms §1 and §19, Privacy §1 and §15, Cancellation §1 and §9, Disclaimer §8 |
| `[[PRIVACY_OFFICER]]` | Name or role of the privacy contact, or of the DPO if one is appointed | Privacy §1 |
| `[[HOSTING_PROVIDER]]` | Hosting provider's name and the country where data is stored | Privacy §8 |
| `[[EMAIL_PROVIDER]]` | Transactional e-mail provider's name and country | Privacy §8 |
| `[[ACCESSIBILITY_COORDINATOR]]` | Accessibility coordinator's name (רכז/ת נגישות) | Accessibility §6 |
| `[[ACCESSIBILITY_PHONE]]` | Accessibility coordinator's phone | Accessibility §6 |
| `[[ACCESSIBILITY_EMAIL]]` | Accessibility coordinator's e-mail | Accessibility §6 |
| `[[ACCESSIBILITY_REVIEW_DATE]]` | Date of the last real accessibility review of the site and app, for example the A10 axe/manual audit or an external audit | Accessibility §7 |

The Privacy Policy lists `[[HOSTING_PROVIDER]]` and `[[EMAIL_PROVIDER]]` as recipients. If either provider stores data outside Israel, also check that the Privacy §9 wording on transfers still holds.

## 2. Values stated as fact: founder to confirm

- **Prices:** ₪24.90 per month, ₪59.90 for 3 months, ₪179.90 for 12 months, all including 18% VAT (Terms §5). If a price changes, update both languages and `GET /api/plans` together.
- **Minimum age 18** (Terms §3, Privacy §13). The research allows 16 instead.
- **Courts:** Tel Aviv-Yafo (Terms §17).
- **30 days' notice** before a price change or a material change to the terms (Terms §8 and §18).
- **Invoice retention:** "generally 7 years" (Privacy §10). The accountant must confirm this.
- **No office open to the public** (Accessibility §5). If there is one, the physical accessibility arrangements must be described.

## 3. Engineering alignment: what the pages promise

Check each item against the server (A8) and the app (A7). Where they differ, change the code or the page.

1. **Monthly plan:** a reminder e-mail before every charge; an invoice showing the next charge date; an annual summary of charges in March; up to 7 days of retries after a failed charge, then paid features are locked; no charge for any period without access.
2. **3-month and 12-month plans do not auto-renew. This applies to Paddle (international) too.** The research recommended auto-renewal of all plans on Paddle. The pages follow the manager's fact sheet, which has no auto-renewal for any customer. Paddle must be configured to match, or the pages must change.
3. **Fixed-term notices:**
   - a separate written notice of the end date about 60 days before the end, and never later than 30 days before;
   - a reminder 7 days before the end;
   - an SMS 21 days before the end **if we hold a mobile number**. The server stores none today, so nothing is sent.
4. **14-day full refund:**
   - it counts from the first payment;
   - for a fixed-term renewal, it counts again from the renewal payment, because a renewal is a new transaction;
   - refunds go back to the original payment method within 7 business days.
5. **Early termination on request:** a user who writes or phones can end the plan within 3 business days and get a pro-rata refund for the unused period. The in-app button offers only "end of period", or "now" with a full refund within 14 days. This is the section 13D safety net, and it needs an admin or support procedure.
6. **Account deletion:** it cancels the subscription. It keeps only anonymised invoice records and a SHA-256 hash of the e-mail. The audit log and sessions are deleted.
7. **Hosting logs:** the privacy policy says hosting servers see IP address and browser type. Confirm whether request logs are kept, and for how long.
8. **Accessibility claims to verify (app side):**
   - large labelled buttons;
   - keyboard and screen-reader support;
   - a check can be stopped at any point;
   - colour-check results are also shown in text;
   - a step-by-step guide to the device's accessibility settings.

## 4. Open questions for the lawyer

1. **Exact current text of the Consumer Protection Law 5741-1981 sections below.** The research only had search extracts.
   - **13A (13א):** the fixed-term notice window of 60 to 30 days, the 21-day SMS, and the end date on invoices. Does a fixed-term plan that never auto-renews still need the end-of-term notice? We send it anyway.
   - **13B (13ב):** the periodic and annual statement of charges.
   - **13D (13ד):** the 3-business-day cancellation effect. Is "stop renewal, keep access to the end of the paid period" valid as the default? Is a pro-rata refund on request enough?
   - **14C (14ג) and 14C(c1):** the 4-month right for seniors, people with disabilities and new immigrants. Check the conditions (a transaction that involved a conversation) and the refund calculation. Also check the pre-contract disclosure list against the paywall and checkout.
2. **Medical-device wording:**
   - Is the intended-purpose statement (Terms §2, Disclaimer §1–2) enough to stay outside the Medical Equipment Law 5772-2012 (AMAR), the Optometry Law 5751-1991, EU MDR (MDCG 2019-11) and the FDA General Wellness policy (revised January 2026)?
   - The Disclaimer's optics explanation and its list of urgent symptoms: do they create any "diagnostic" impression?
3. **Standard Contracts Law:**
   - the limitation-of-liability cap of 12 months' fees (Terms §15);
   - the Tel Aviv jurisdiction clause, which keeps the consumer's right to sue at home (Terms §17);
   - the clause that the Hebrew version prevails (Terms §1).
4. **Privacy (Amendment 13):**
   - Is a DPO needed, given that eye data never reaches the server?
   - Does the section 11 notice wording suffice?
   - For how long may we keep the e-mail hash used for "one trial per e-mail"? The pages give no end date.
   - Do we need an EU representative under GDPR Art. 27?
   - Which security level under the Data Security Regulations 5777-2017 applies?
5. **Accessibility statement:** does it meet the current regulation 35 required contents? IS 5568 is now aligned with WCAG 2.1 or 2.0 AA; confirm which.
6. **Paddle as Merchant of Record:** do our refund promises conflict with Paddle's buyer terms? Should the terms name Paddle's legal entity?

## 5. Open questions for the accountant

1. **Business structure:** exempt dealer (עוסק פטור), licensed dealer (עוסק מורשה) or a company (בע״מ). This decides `[[COMPANY_NAME]]` and `[[COMPANY_ID]]` and the invoice types.
2. **VAT on sales to Paddle:** Paddle is the reseller and Merchant of Record. Is our supply to Paddle a zero-rated export of services, or subject to 18% VAT?
3. **Retention periods** for invoices and billing records, and whether anonymised copies satisfy the bookkeeping rules.
4. **PayPlus Invoice+:** the invoice/receipt type for each plan, and how refunds and credit notes are issued.
