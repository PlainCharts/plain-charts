---
layout: ../../../layouts/DocsLayout.astro
title: Hotkeys
---

# Hotkeys

Shortcuts follow the architecture.

Engine — navigation and zoom.
Drawings — create and edit objects.
Workspace — symbols, intervals, layouts.

## Engine layer

The rendering engine manages the canvas.

### Navigation

| Gesture                | Action              |
| ---------------------- | ------------------- |
| Drag chart             | Pan                 |
| Shift + Wheel          | Scroll horizontally |
| Double-click time axis | Jump to latest bars |


### Zoom

| Gesture                 | Action       |
| ----------------------- | ------------ |
| Wheel                   | Time zoom    |
| Ctrl + Wheel            | 2D zoom      |
| Drag price axis         | Price zoom   |
| Double-click price axis | Auto-fit     |
| Drag pane divider       | Resize panes |


### Touch

| Gesture         | Action      |
| --------------- | ----------- |
| One finger      | Pan         |
| Two fingers     | Pinch zoom  |
| Long press      | Crosshair   |
| Flick           | Kinetic pan |
| Drag price axis | Price zoom  |


## Drawing layer

Drawing tools build on top of the engine.

### Edit

| Shortcut        | Action             |
| --------------- | ------------------ |
| Ctrl+Z / Ctrl+Y | Undo / Redo        |
| Ctrl+C / Ctrl+V | Copy / Paste       |
| Ctrl+A          | Select all         |
| Ctrl+Drag       | Clone              |
| Arrow keys      | Nudge              |
| Shift+Drag      | Constrain movement |
| Delete          | Delete selection   |


### Create

| Shortcut       | Action         |
| -------------- | -------------- |
| Shift+Drag     | Measure        |
| Enter          | Finish drawing |
| Escape         | Cancel         |
| Ctrl/Alt + Key | Tool shortcut  |


## Workspace

Application commands.

| Shortcut  | Action          |
| --------- | --------------- |
| Letter    | Change symbol   |
| Number    | Change interval |
| Tab       | Next chart      |
| Alt+Enter | Maximize chart  |
| Alt+R     | Reset view      |


All shortcuts are commands.

Bindings are configurable in Settings → Hotkeys.
