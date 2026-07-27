---
layout: ../../../layouts/DocsLayout.astro
title: Commands
---

# Commands

One app action, defined once, fired from many triggers.

## Action and trigger are different things

"Reset the chart view" is one action. A hotkey, a menu item, and the assistant are three ways to ask for it.

```
                    'pane.resetView'      the action, defined once
                          ▲
        ┌─────────────────┼─────────────────┐
     hotkey             menu            assistant
    (Alt+R)         (right-click)     (run_command)
        └──── each resolves the name; none owns the logic ────┘
```

A command is a named action with a handler. A trigger is an edge that looks the name up and calls it. Reached three ways, the same action runs the same code.

## The registry

Every command registers under a stable dotted id — `pane.resetView`, `study.add`, `alert.add`.

The registry (`src/commands/registry.js`) is a small map with three operations:

```
registerCommand({ id, title, handler, ... })   a module adds an action
executeCommand(id, args)                        a trigger fires it
listCommands()                                  enumerate them, for Settings
```

Same plug socket as the tool, study, and broker registries. Things register by id. The core never names a specific command.

## Triggers are edges

A trigger holds no logic. It resolves an id and executes it.

- **Hotkeys** — a keypress becomes a chord, looks up the bound command, and runs it. The dispatcher (`src/edit/hotkeys.js`) holds no actions.
- **Menus** — a menu item calls `executeCommand('pane.resetView', { pane })` instead of doing the work inline.
- **The assistant** — an AI tool call is checked against [policy](/docs/architecture/assistant), then dispatches to the same command a menu would.

Add a command once and all three reach it.

## Rebindable keys

A key is just an edge that names a command, so the binding is data, not code.

Each command carries a default chord. A user override resolves on top of it, and the dispatcher builds its lookup from the resolved bindings — so a rebind takes effect live. Assigning a chord already in use moves it. One chord maps to one command.

See [Hotkeys](/docs/resources/hotkeys) for the full list.

## The assistant tracks the app

The assistant reaches the app through this registry, not a parallel set of handlers.

Ask it to add a study, and the request lands on the very command the menu and hotkey use. Nothing to keep in sync. A command that exists is one it can drive, subject to policy.

## Interface actions, not execution

The registry unifies interface actions. It does not carry orders.

Commands that act inside a chart window — panes, studies, drawings — share a real handler. Commands that touch a broker run in a separate process, the [data host](/docs/architecture/data-host), so they cannot share a function. They share only the command's id and metadata across the boundary.

Order execution never flows through the registry. It goes straight to the data host, gated and confirmed. Unifying the interface does not weaken the execution boundary.
