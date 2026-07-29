---
layout: ../../../layouts/DocsLayout.astro
title: Object tree
---

# Object tree

Every drawing you place appears in the **object tree**, a sorting system that gives your chart objects structure through layers, folders, and subfolders.

![The object tree](/images/object-tree.jpg)

The tree nests four levels:

```
FILE            a symbol
 └─ LAYER       a working surface, tabs down the left edge
     └─ FOLDER  named groups, nestable
         └─ OBJECT   one drawing
```

The tree holds references to objects, not the drawings themselves. A drawing is hidden if it, a parent folder, or its layer is hidden.

Hiding never overwrites an object's own properties. Hide a layer and everything in it disappears, but each object keeps its settings, even hidden objects nested in a folder. Show the layer again and they return exactly as they were.

That makes folders and layers flexible working surfaces. Use a folder like a layer: set hide, show, and lock inside it, then hide the whole folder. Its state is preserved for next time.

Hide a whole layer and draw on a fresh one to run a different analysis on the same chart, without opening another tab. Hide it later, or overlap one layer with another.

For more, see [The object tree](/docs/concepts/object-tree).
