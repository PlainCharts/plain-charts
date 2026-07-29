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

## Watchlist alerts

Create an alert for an entire watchlist at once.

Click the bell icon next to a list in the **Watchlist** dropdown. The alert rules are the same as any other alert, but the condition is applied to every symbol in that list.

![Creating an alert on a watchlist](/images/watchlist-alert.jpg)

## Time alerts

Alerts come in two types, shown in the manager's **Price** and **Time** tabs.

- **Price alerts** — Monitor chart conditions.
- **Time alerts** — Act as in-app reminders.

![Creating a time alert](/images/time-alert.jpg)

Create a time alert by setting a time, date, and frequency such as daily.

Use them for recurring session reminders or one-time reminders to do something later.

## Managing alerts

The **Alert manager** keeps all alerts organized in a tree.

Click **⋯** to filter, customize the list, and run bulk actions:

- Restart or stop all alerts
- Delete inactive alerts
- Show active or inactive alerts only
- Filter by symbol or interval

![The alert manager menu](/images/alert-manager.jpg)

Use the button next to it to sort the tree.

## Alert log

The **Log** tab keeps a record of every alert that fires.

Click **⋯** to manage the log. You can clear it, filter by symbol or interval, show only specific event types, and customize the list.

![The alert log menu](/images/alert-log.jpg)

Available filters include:

- Price events
- Time events
- Watchlist events

A notification badge appears next to the **Alert manager** button on the right toolbar whenever a new alert has triggered.

## Defaults

Set the default alert line color, price label, and notification sound in **Settings → Global → Alerts**.

![Alert defaults in Settings](/images/alert-settings.jpg)

Configure email (SMTP) and Telegram delivery in **Settings → Global → Notifications**.

![Email and Telegram notification settings](/images/notifications.jpg)
