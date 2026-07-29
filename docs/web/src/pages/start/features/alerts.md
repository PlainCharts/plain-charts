---
layout: ../../../layouts/DocsLayout.astro
title: Alerts
---

# Alerts

Get notified when the market meets a condition you set.

Create one two ways: right-click a drawing object and choose **Create alert**, or open the alert manager and click **+**.

![The alert dialog with its condition](/images/alert-dialog.jpg)

## Conditions

An alert fires when two objects satisfy a condition. A price-based alert watches a price object against another object or a value.

Pick the condition from the dropdown: crossing, crossing up or down, greater or less than, and moving up or down by points or percent.

## The dialog

The dialog is organized into sections:

- **General** — Name, what it applies to, **Trigger** (once, once per bar close, or once per minute), and **Expiration**.
- **Message** — The text to send. Use **placeholders** for the symbol, broker, price, and more.
- **Conditions** — The rule above.
- **Actions** — What happens when it fires.

## Actions

![Choosing an alert action](/images/alert-actions.jpg)

Actions can be combined. Send a toast with a sound, or fire a Telegram message and a webhook at once:

- Toast notification
- System notification
- Popup window
- Send email
- Telegram notification
- Play sound
- Webhook URL

## Defaults

Set the default alert line color, price label, and notification sound in **Settings → Global → Alerts**.

![Alert defaults in Settings](/images/alert-settings.jpg)

Configure email (SMTP) and Telegram delivery in **Settings → Global → Notifications**.

![Email and Telegram notification settings](/images/notifications.jpg)
